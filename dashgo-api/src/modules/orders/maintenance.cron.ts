import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import * as Sentry from '@sentry/node';
import { In, LessThanOrEqual, Not, Repository } from 'typeorm';
import { Order, Product, Rental } from '../../entities';
import { OrderStatus, PaymentMethod, UserRole } from '../../entities/enums';
import { RentalStatus } from '../../entities/rental.entity';
import { SubscriptionStatus } from '../../entities/subscription.entity';
import { todayIsoDay } from '../../common/delivery-day';
import { SubscriptionService } from '../subscription/subscription.service';
import { OrdersService } from './orders.service';

/**
 * Mantenimiento automático del bebedero.
 *
 * Antes el cliente tenía que tocar "Solicitar mantenimiento" cuando el contador
 * de 90 días vencía; nadie lo tocaba y la visita nunca se hacía. Desde
 * 2026-10-02 (regla del dueño) el SISTEMA genera la orden de la visita solo:
 *
 *  1. SÓLO para suscriptores cuyo plan está vivo y ACTIVE — un plan en
 *     `past_due` no recibe visita gratis. Y sólo para bebederos ACTIVE de un
 *     producto con `requiresMaintenance` cuyo dueño no tiene apagado el contador.
 *  2. El MISMO día (de Nueva York) en que vence el contador, como una orden con
 *     `scheduledDeliveryDate = hoy`: así cae directo en "Pendientes" de la ruta
 *     (buckets de la ruta de reparto) sin que el admin tenga que programarla.
 *  3. En el primer deploy, todo bebedero que YA estaba vencido recibe su orden
 *     (programada para hoy); por eso además de las 8:00 AM corre una vez al
 *     arrancar.
 *
 * Idempotencia: la orden queda enlazada en `rentals.maintenance_order_id`. Un
 * corrido posterior que ve una visita abierta no crea otra. Si esa orden se
 * CANCELÓ, la visita no ocurrió y el bebedero sigue vencido: se regenera.
 * `resetMaintenanceForUser` limpia el enlace cuando la visita se entrega. Un
 * mantenimiento abierto que NO está enlazado (pedido a mano por el cliente, o
 * creado por un corrido que se cayó antes de enlazar) se adopta en vez de
 * duplicarlo.
 *
 * El cron vive en OrdersModule (que ya importa RentalsModule y
 * SubscriptionModule) porque necesita OrdersService; SubscriptionModule nunca
 * importa Orders/Rentals, así el grafo de módulos sigue siendo acíclico. No
 * hace ninguna llamada a Stripe: la orden es de $0 y en efectivo.
 */

/** Demora del corrido de arranque: que la app termine de levantar primero. */
const BOOT_DELAY_MS = 30_000;

/**
 * Horario de negocio del corrido de arranque: de las 7:00 a las 19:59 de Nueva
 * York. Un deploy cae a cualquier hora, y cada visita que crea el sistema le
 * manda al cliente un push (y WhatsApp) de "mantenimiento programado": a las
 * 22:00 serían avisos de madrugada para una visita "de hoy" que ya no va a
 * ocurrir. Fuera de la ventana el corrido de arranque se omite y lo cubre el
 * cron de las 8:00 AM.
 */
const BOOT_WINDOW_START_HOUR = 7;
const BOOT_WINDOW_END_HOUR = 20; // exclusivo: 19:59 entra, 20:00 no

/**
 * ¿Es hora de negocio (7:00–19:59) en `timeZone` para este instante?
 *
 * La hora se saca con la zona FIJADA en el propio Intl —nunca con
 * `process.env.TZ` ni `getHours()`, que dependen de la máquina: dentro de Jest
 * `TZ` no hace nada y el test pasaba en la Mac (UTC-4) y fallaba en el CI (UTC).
 * El `% 24` cubre el runtime que formatea la medianoche como "24" con
 * `hour12: false`; sin él esa hora saldría fuera de rango por el motivo
 * equivocado.
 */
export function isWithinBootWindow(
  now: Date,
  timeZone = 'America/New_York',
): boolean {
  const hourText = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    hour12: false,
  })
    .formatToParts(now)
    .find((p) => p.type === 'hour')?.value;

  const hour = Number(hourText) % 24;
  return hour >= BOOT_WINDOW_START_HOUR && hour < BOOT_WINDOW_END_HOUR;
}

/**
 * Margen para la consulta a la base. "Vence hoy" se decide por DÍA de Nueva York
 * (ver abajo), y un bebedero que vence a las 23:00 de hoy debe recibir su visita
 * a las 8:00 AM aunque su instante todavía no haya llegado. 36 h cubre de sobra
 * el resto del día (máximo 25 h con el cambio de horario); el filtro exacto es el
 * de `todayIsoDay`, esto sólo acota las filas que se traen.
 */
const DUE_HORIZON_MS = 36 * 60 * 60 * 1000;

export interface MaintenanceRunSummary {
  /** Usuarios con al menos un bebedero que vence hoy o ya venció. */
  candidates: number;
  /** Órdenes de visita creadas. */
  created: number;
  /**
   * Candidatos descartados: plan no activo, o ya tienen una visita abierta
   * (enlazada, o un mantenimiento abierto sin enlazar que se adoptó).
   */
  skipped: number;
  /** Candidatos cuya orden no se pudo crear (se reintentan en el próximo corrido). */
  failed: number;
}

@Injectable()
export class MaintenanceCron implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(MaintenanceCron.name);
  private bootTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Guarda de reentrada: el corrido de arranque y las 8:00 AM pueden coincidir, y
   * dos corridas simultáneas crearían dos visitas para el mismo usuario antes de
   * que la primera alcance a dejar el enlace en el bebedero.
   */
  private running = false;

  constructor(
    @InjectRepository(Product) private readonly products: Repository<Product>,
    @InjectRepository(Rental) private readonly rentals: Repository<Rental>,
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    private readonly ordersService: OrdersService,
    private readonly subscriptions: SubscriptionService,
  ) {}

  /**
   * Corrido de arranque en segundo plano: cubre el primer deploy (bebederos ya
   * vencidos) y cualquier día en que la app estuvo caída a las 8:00. Es
   * idempotente, así que correrlo en cada boot es seguro, y no bloquea que la
   * app quede lista. Sólo ejecuta en horario de negocio (ver `isWithinBootWindow`).
   */
  onApplicationBootstrap(): void {
    this.bootTimer = setTimeout(() => void this.runOnBoot(), BOOT_DELAY_MS);
    this.bootTimer.unref?.();
  }

  /**
   * Disparo del corrido de arranque. La hora se mira AL DISPARAR (30 s después
   * del boot), no al arrancar: es el momento en que de verdad se crearían las
   * órdenes y se avisaría a los clientes.
   */
  private async runOnBoot(): Promise<void> {
    if (!isWithinBootWindow(new Date())) {
      this.logger.log(
        'Mantenimiento automático: corrido de arranque omitido por estar fuera del horario de negocio (7:00–19:59 NY) — lo cubre el cron de las 8:00 AM',
      );
      return;
    }
    await this.runDaily();
  }

  onModuleDestroy(): void {
    if (this.bootTimer) clearTimeout(this.bootTimer);
  }

  @Cron('0 8 * * *', { timeZone: 'America/New_York' })
  async runDaily(): Promise<void> {
    if (this.running) {
      this.logger.warn(
        'Mantenimiento automático: ya hay un corrido en curso — se descarta este disparo',
      );
      return;
    }
    this.running = true;
    try {
      await this.generateDueMaintenanceOrders();
    } catch (err) {
      this.logger.error(
        `Mantenimiento automático falló: ${(err as Error).message}`,
      );
    } finally {
      this.running = false;
    }
  }

  /**
   * Genera la orden de visita de cada suscriptor con bebedero vencido. Nunca
   * aborta el lote por un usuario: los errores se cuentan en `failed`.
   *
   * `now` es parámetro sólo para poder fijar el instante en los tests.
   */
  async generateDueMaintenanceOrders(
    now: Date = new Date(),
  ): Promise<MaintenanceRunSummary> {
    const summary: MaintenanceRunSummary = {
      candidates: 0,
      created: 0,
      skipped: 0,
      failed: 0,
    };

    const maintenanceProduct = await this.products.findOne({
      where: { isMaintenanceService: true, isAvailable: true },
    });
    if (!maintenanceProduct) {
      this.logger.warn(
        'Mantenimiento automático: no hay producto de mantenimiento disponible — no se generan órdenes',
      );
      return summary;
    }

    // "Hoy" y "el día en que vence" son DÍAS de Nueva York (el negocio opera ahí),
    // nunca el día UTC: de las 20:00 a la medianoche el día UTC ya es el siguiente.
    const today = todayIsoDay(now);

    const dueRentals = await this.rentals.find({
      where: {
        status: RentalStatus.ACTIVE,
        // LessThanOrEqual excluye las filas sin contador (NULL).
        nextMaintenanceAt: LessThanOrEqual(
          new Date(now.getTime() + DUE_HORIZON_MS),
        ),
      },
      relations: ['product', 'user'],
      loadEagerRelations: false,
    });

    // Agrupa por usuario: una visita cubre TODOS sus bebederos
    // (resetMaintenanceForUser los reinicia juntos al entregarla).
    const byUser = new Map<string, Rental[]>();
    for (const rental of dueRentals) {
      if (!rental.product?.requiresMaintenance) continue;
      if (rental.user?.maintenanceTimerDisabled) continue;
      if (!rental.nextMaintenanceAt) continue;
      if (todayIsoDay(rental.nextMaintenanceAt) > today) continue;

      const group = byUser.get(rental.userId);
      if (group) group.push(rental);
      else byUser.set(rental.userId, [rental]);
    }

    summary.candidates = byUser.size;
    if (byUser.size === 0) return summary;

    // Un solo viaje para los planes de todos. Sólo cuenta un plan ACTIVE con
    // periodo vigente: es la misma definición de suscriptor que usa create() para
    // dejar el mantenimiento en $0 — con un periodo vencido create() cobraría la
    // visita y el sistema le generaría una orden de pago que nadie pidió.
    const planByUser = await this.subscriptions.resolvePlanRowsByUserIds([
      ...byUser.keys(),
    ]);
    const eligible = new Map<string, Rental[]>();
    for (const [userId, userRentals] of byUser) {
      const plan = planByUser.get(userId);
      const live =
        plan !== undefined &&
        plan.status === SubscriptionStatus.ACTIVE &&
        plan.currentPeriodEnd.getTime() > now.getTime();
      if (live) eligible.set(userId, userRentals);
      else summary.skipped += 1;
    }

    // Una sola consulta para saber en qué estado están las visitas ya enlazadas.
    const linkedOrderIds = [
      ...new Set(
        [...eligible.values()]
          .flat()
          .map((r) => r.maintenanceOrderId)
          .filter((id): id is string => id != null),
      ),
    ];
    const linkedOrders =
      linkedOrderIds.length > 0
        ? await this.orders.find({
            where: { id: In(linkedOrderIds) },
            select: { id: true, status: true },
            loadEagerRelations: false,
          })
        : [];
    const statusByOrderId = new Map(linkedOrders.map((o) => [o.id, o.status]));

    // Visita abierta = enlazada y no cancelada. Una CANCELADA significa "no
    // ocurrió, sigue vencida" y se regenera.
    const hasOpenLinkedVisit = (userRentals: Rental[]): boolean =>
      userRentals.some((r) => {
        if (r.maintenanceOrderId == null) return false;
        const status = statusByOrderId.get(r.maintenanceOrderId);
        return status !== undefined && status !== OrderStatus.CANCELLED;
      });

    // Un mantenimiento puede estar YA en camino sin que el bebedero lo sepa: el
    // cliente tocó "Solicitar mantenimiento" (el botón manual sigue existiendo),
    // o un corrido anterior creó la orden y se cayó antes de enlazarla. Crear
    // otra sería mandar al repartidor dos veces: esa orden se ADOPTA como la
    // visita. Una sola consulta para todos los que no tienen visita enlazada.
    const unlinkedUserIds = [...eligible.entries()]
      .filter(([, userRentals]) => !hasOpenLinkedVisit(userRentals))
      .map(([userId]) => userId);
    const openMaintenanceByUser = new Map<string, string>();
    if (unlinkedUserIds.length > 0) {
      const openMaintenance = await this.orders.find({
        where: {
          customerId: In(unlinkedUserIds),
          status: Not(In([OrderStatus.DELIVERED, OrderStatus.CANCELLED])),
          items: { product: { isMaintenanceService: true } },
        },
        select: { id: true, customerId: true },
        order: { createdAt: 'ASC' },
        loadEagerRelations: false,
      });
      // La más vieja gana: es la que el cliente ya está esperando.
      for (const o of openMaintenance) {
        if (!openMaintenanceByUser.has(o.customerId)) {
          openMaintenanceByUser.set(o.customerId, o.id);
        }
      }
    }

    for (const [userId, userRentals] of eligible) {
      if (hasOpenLinkedVisit(userRentals)) {
        summary.skipped += 1;
        continue;
      }

      const adoptedId = openMaintenanceByUser.get(userId);
      if (adoptedId) {
        summary.skipped += 1;
        try {
          await this.rentals.update(
            userRentals.map((r) => r.id),
            { maintenanceOrderId: adoptedId },
          );
        } catch (err) {
          // Sin enlace el próximo corrido la vuelve a encontrar y reintenta: no
          // hay riesgo de duplicar, sólo el banner tarda un día en mostrarla.
          this.logger.error(
            `Mantenimiento automático: no se pudo enlazar la orden abierta ${adoptedId} a los bebederos de ${userId}: ${(err as Error).message}`,
          );
        }
        continue;
      }

      let orderId: string;
      try {
        const order = await this.ordersService.create(
          { id: userId, role: UserRole.CLIENT, email: null },
          {
            items: [{ productId: maintenanceProduct.id, quantity: 1 }],
            paymentMethod: PaymentMethod.CASH,
            usePoints: false,
            useCredit: false,
          },
          // `provisioned`: la pidió el sistema, no el cliente (no choca con su
          // pedido en curso ni lo bloquea). El día es HOY: cae en "Pendientes".
          { provisioned: true, scheduledDeliveryDate: today },
        );
        orderId = order.id;
      } catch (err) {
        summary.failed += 1;
        this.logger.error(
          `Mantenimiento automático: no se pudo crear la visita del usuario ${userId}: ${(err as Error).message}`,
        );
        continue;
      }
      summary.created += 1;

      try {
        await this.rentals.update(
          userRentals.map((r) => r.id),
          { maintenanceOrderId: orderId },
        );
      } catch (err) {
        // La orden YA existe pero el enlace no quedó. El próximo corrido no la
        // duplica (la encuentra como mantenimiento abierto y la adopta), pero
        // hasta entonces el cliente no ve la visita en el banner: se avisa.
        this.logger.error(
          `Mantenimiento automático: orden ${orderId} creada pero NO enlazada a los bebederos de ${userId}: ${(err as Error).message}`,
        );
        Sentry.captureException(err, {
          tags: { module: 'orders', phase: 'maintenance-link' },
          extra: { userId, orderId },
        });
      }
    }

    this.logger.log(
      `Mantenimiento automático: ${summary.candidates} candidatos, ${summary.created} órdenes creadas, ${summary.skipped} omitidos, ${summary.failed} fallidos`,
    );
    return summary;
  }
}
