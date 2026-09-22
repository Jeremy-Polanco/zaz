import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Rental, RentalStatus } from '../../entities/rental.entity';
import { Subscription, SubscriptionStatus } from '../../entities/subscription.entity';
import {
  SUBSCRIPTION_STATUS_CHANGED,
  SUBSCRIPTION_RECONCILED,
  SubscriptionStatusChangedEvent,
  SubscriptionReconciledEvent,
} from '../../common/events/subscription.events';

/** Rentals que un plan puede mover. pending_setup y canceled no se tocan nunca. */
const MIRRORABLE_STATUSES = [
  RentalStatus.ACTIVE,
  RentalStatus.PAST_DUE,
  RentalStatus.UNPAID,
] as const;

export interface SyncOutcome {
  marked: number;
  unpaid: number;
  restored: number;
}

/**
 * "La suscripción ES el bebedero": cuando el plan que paga el bebedero
 * gratuito de un suscriptor ($6.99/mes, tabla `subscriptions`) se atrasa, el
 * alquiler de ese bebedero ($0/mes, tabla `rentals`) nunca se entera solo —
 * su propia suscripción de Stripe (también $0) jamás falla. Este listener
 * espeja el estado del PLAN sobre los rentals de $0 que ese plan paga, para
 * que la mora aparezca en el panel de Alquileres, acumule el recargo diario
 * existente (misma gracia de 3 días, vía `pastDueSince`) y, si Stripe se
 * rinde con el plan, el alquiler quede `unpaid` hasta que un admin retire la
 * unidad y cancele a mano — nunca lo cancela ni llama a Stripe este listener.
 *
 * Solo lee `subscriptions` y `rentals`; jamás llama a Stripe ni importa
 * SubscriptionModule/OrdersModule — el grafo de módulos se mantiene acíclico
 * vía @nestjs/event-emitter, igual que SubscriberBebederoListener.
 *
 * Nunca lanza: todo error se atrapa y se loguea para no tumbar al emisor
 * (SubscriptionService.upsertSubscription / reconcileWithStripe).
 */
@Injectable()
export class PlanDelinquencyListener {
  private readonly logger = new Logger(PlanDelinquencyListener.name);

  constructor(
    @InjectRepository(Rental)
    private readonly rentals: Repository<Rental>,
    @InjectRepository(Subscription)
    private readonly subscriptions: Repository<Subscription>,
  ) {}

  @OnEvent(SUBSCRIPTION_STATUS_CHANGED)
  async handleStatusChanged(event: SubscriptionStatusChangedEvent): Promise<void> {
    try {
      await this.syncForUser(event.userId);
    } catch (err) {
      this.logger.error(
        `handleStatusChanged: sync falló para el usuario ${event.userId}: ${(err as Error).message}`,
      );
    }
  }

  @OnEvent(SUBSCRIPTION_RECONCILED)
  async handleReconciled(_event: SubscriptionReconciledEvent): Promise<void> {
    await this.syncAll();
  }

  /**
   * Re-barre TODOS los usuarios que tienen un rental de $0 (independientemente
   * de si su plan cambió): la misma foto final que ya usa el reconcile horario
   * de SubscriptionService para curar webhooks perdidos.
   */
  async syncAll(): Promise<void> {
    let userIds: string[];
    try {
      const rows = await this.rentals
        .createQueryBuilder('rental')
        .select('DISTINCT rental.userId', 'userId')
        .where('rental.monthlyRentCents = 0')
        .andWhere('rental.status IN (:...statuses)', {
          statuses: MIRRORABLE_STATUSES,
        })
        .getRawMany<{ userId: string }>();
      userIds = rows.map((r) => r.userId);
    } catch (err) {
      this.logger.error(
        `syncAll: no se pudo listar usuarios con alquiler de $0: ${(err as Error).message}`,
      );
      return;
    }

    let marked = 0;
    let unpaid = 0;
    let restored = 0;
    for (const userId of userIds) {
      try {
        const outcome = await this.syncForUser(userId);
        marked += outcome.marked;
        unpaid += outcome.unpaid;
        restored += outcome.restored;
      } catch (err) {
        this.logger.error(
          `syncAll: sync falló para el usuario ${userId}: ${(err as Error).message}`,
        );
      }
    }
    this.logger.log(
      `syncAll: ${JSON.stringify({ users: userIds.length, marked, unpaid, restored })}`,
    );
  }

  /**
   * Espeja el status del plan MÁS NUEVO del usuario sobre sus rentals de $0.
   * Idempotente: repetir la llamada con el mismo status del plan no vuelve a
   * pisar `pastDueSince`/`planPastDueSince` (write-once) hasta que el plan
   * recupera `active` y los restaura.
   */
  async syncForUser(userId: string): Promise<SyncOutcome> {
    const outcome: SyncOutcome = { marked: 0, unpaid: 0, restored: 0 };

    // F1 — `subscriptions.user_id` YA NO es UNIQUE (ver migración
    // 1811000000000-DropSubscriptionsUserIdUnique): un usuario acumula una
    // fila por cada suscripción de Stripe que tuvo (cancelación +
    // re-suscripción). Un `findOne` sin más ganaba con CUALQUIER fila —
    // incluida una `canceled` vieja que Postgres puede devolver antes que la
    // `active` nueva — y eso alcanzó a marcar UNPAID el bebedero de un
    // suscriptor que sí estaba pagando. Traemos TODAS las filas y resolvemos
    // el status "efectivo" nosotros mismos.
    const rows = await this.subscriptions.find({ where: { userId } });
    const planStatus = this.resolvePlanStatus(rows);

    // Sin plan, o el plan sigue en proceso (incomplete): todavía no hay nada
    // que espejar.
    if (planStatus === null || planStatus === SubscriptionStatus.INCOMPLETE) {
      return outcome;
    }

    const targets = await this.rentals.find({
      where: {
        userId,
        monthlyRentCents: 0,
        status: In(MIRRORABLE_STATUSES as unknown as RentalStatus[]),
      },
    });
    if (targets.length === 0) return outcome;

    const now = new Date();

    if (planStatus === SubscriptionStatus.PAST_DUE) {
      for (const rental of targets) {
        rental.planPastDueSince = rental.planPastDueSince ?? now;
        rental.pastDueSince = rental.pastDueSince ?? now;
        rental.status = RentalStatus.PAST_DUE;
        await this.rentals.save(rental);
        outcome.marked += 1;
      }
      this.logger.log(
        `syncForUser: plan de ${userId} en mora — ${outcome.marked} alquiler(es) de $0 marcado(s) PAST_DUE`,
      );
      return outcome;
    }

    if (
      planStatus === SubscriptionStatus.UNPAID ||
      planStatus === SubscriptionStatus.CANCELED ||
      planStatus === SubscriptionStatus.INCOMPLETE_EXPIRED
    ) {
      for (const rental of targets) {
        rental.planPastDueSince = rental.planPastDueSince ?? now;
        rental.pastDueSince = rental.pastDueSince ?? now;
        rental.status = RentalStatus.UNPAID;
        await this.rentals.save(rental);
        outcome.unpaid += 1;
      }
      this.logger.log(
        `syncForUser: plan de ${userId} perdido (${planStatus}) — ${outcome.unpaid} alquiler(es) de $0 marcado(s) UNPAID (requiere retiro manual del admin)`,
      );
      return outcome;
    }

    if (planStatus === SubscriptionStatus.ACTIVE) {
      const marked = targets.filter((r) => r.planPastDueSince !== null);
      for (const rental of marked) {
        rental.planPastDueSince = null;
        rental.pastDueSince = null;
        rental.status = RentalStatus.ACTIVE;
        await this.rentals.save(rental);
        outcome.restored += 1;
      }
      if (outcome.restored > 0) {
        this.logger.log(
          `syncForUser: plan de ${userId} vuelve a active — ${outcome.restored} alquiler(es) restaurado(s)`,
        );
      }
      return outcome;
    }

    return outcome;
  }

  /**
   * Resuelve el status "efectivo" del plan del usuario cuando hay varias
   * filas en `subscriptions` (cancelación + re-suscripción). Una fila VIEJA
   * nunca debe ganarle a una VIVA: se prioriza cualquier fila ACTIVE con
   * `currentPeriodEnd` futuro, después cualquier PAST_DUE con
   * `currentPeriodEnd` futuro, y solo si ninguna sigue viva se cae a "la más
   * nueva por currentPeriodEnd" — la regla previa, que sigue siendo correcta
   * cuando el usuario tiene una sola fila viva (o ninguna).
   */
  private resolvePlanStatus(rows: Subscription[]): SubscriptionStatus | null {
    if (rows.length === 0) return null;

    const now = new Date();
    const isLive = (r: Subscription): boolean => r.currentPeriodEnd > now;

    const liveActive = rows.some(
      (r) => r.status === SubscriptionStatus.ACTIVE && isLive(r),
    );
    if (liveActive) return SubscriptionStatus.ACTIVE;

    const livePastDue = rows.some(
      (r) => r.status === SubscriptionStatus.PAST_DUE && isLive(r),
    );
    if (livePastDue) return SubscriptionStatus.PAST_DUE;

    const newest = [...rows].sort(
      (a, b) => b.currentPeriodEnd.getTime() - a.currentPeriodEnd.getTime(),
    )[0];
    return newest.status;
  }
}
