/**
 * Integration spec — mantenimiento automático del bebedero, contra Postgres REAL.
 *
 * POR QUÉ existe: los unit tests de MaintenanceCron mockean repos y servicios, así
 * que no prueban lo que de verdad importa del recorrido completo: que la orden que
 * crea el cron nazca en $0, auto-confirmada, con el día de hoy (Nueva York), que
 * caiga en el bucket `due` de la ruta, que el FK `rentals.maintenance_order_id`
 * quede bien, que la guarda "un pedido activo a la vez" no estorbe a las órdenes
 * del sistema, y que un segundo corrido no duplique nada.
 *
 * Las filas se guardan commiteadas (no hay rollback por test) porque el service lee
 * con otra conexión; la limpieza es manual en `afterAll`. La base se comparte con los
 * demás specs: las aserciones se hacen sólo sobre los usuarios de ESTE spec.
 */

// El service usa `import Stripe = require('stripe')` → el mock devuelve el
// constructor directo. Sin este mock el AppModule marcaría a Stripe de verdad.
// eslint-disable-next-line no-var
var mockStripe: Record<string, unknown>;
jest.mock('stripe', () => jest.fn().mockImplementation(() => mockStripe));

mockStripe = {
  prices: {
    retrieve: jest.fn().mockResolvedValue({
      id: 'price_test_monthly',
      product: 'prod_maintenance_test',
      unit_amount: 1000,
      currency: 'usd',
      recurring: { interval: 'month' },
    }),
    create: jest.fn(),
    update: jest.fn(),
  },
  products: { update: jest.fn() },
  paymentIntents: {
    create: jest.fn(),
    retrieve: jest.fn(),
    cancel: jest.fn(),
    capture: jest.fn(),
  },
  customers: {
    create: jest.fn().mockResolvedValue({ id: 'cus_maintenance_test' }),
    search: jest.fn().mockResolvedValue({ data: [] }),
    update: jest.fn(),
    list: jest.fn(),
  },
  subscriptions: {
    create: jest.fn(),
    retrieve: jest.fn(),
    update: jest.fn(),
    list: jest.fn(),
  },
  checkout: { sessions: { create: jest.fn() } },
  billingPortal: { sessions: { create: jest.fn() } },
  webhooks: { constructEvent: jest.fn() },
};

import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createTestingApp } from '../../src/test-utils/testing-app';
import { makeUser } from '../../src/test-utils/fixtures';
import { Order } from '../../src/entities/order.entity';
import { OrderItem } from '../../src/entities/order-item.entity';
import { Product } from '../../src/entities/product.entity';
import { Rental, RentalStatus } from '../../src/entities/rental.entity';
import {
  Subscription,
  SubscriptionStatus,
} from '../../src/entities/subscription.entity';
import { User } from '../../src/entities/user.entity';
import {
  OrderStatus,
  PaymentMethod,
  UserRole,
} from '../../src/entities/enums';
import { todayIsoDay } from '../../src/common/delivery-day';
import { OrdersService } from '../../src/modules/orders/orders.service';
import { OrderNotificationsService } from '../../src/modules/orders/order-notifications.service';
import { MaintenanceCron } from '../../src/modules/orders/maintenance.cron';
import { RentalsService } from '../../src/modules/rentals/rentals.service';
import type { AuthenticatedUser } from '../../src/common/types/authenticated-user';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

describe('Mantenimiento automático (integration, Postgres real)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let cron: MaintenanceCron;
  let ordersService: OrdersService;
  let rentalsService: RentalsService;
  let notifySpy: jest.SpyInstance;
  let statusSpy: jest.SpyInstance;

  let admin: User;
  let adminAuth: AuthenticatedUser;
  let subscriber: User; // plan ACTIVE + bebedero vencido  → recibe visita
  let delinquent: User; // plan PAST_DUE + bebedero vencido → NO recibe visita
  let notDue: User; // plan ACTIVE + bebedero que vence en 30 días → NO todavía
  let maintenanceProduct: Product;
  let initialMaintenanceStock: number;
  let bebederoProduct: Product;
  let subscriberRental: Rental;
  let delinquentRental: Rental;
  let notDueRental: Rental;

  const today = todayIsoDay();
  // La repartidora está parada cerca; el pedido no tiene dirección, así que el
  // origen sólo sirve para que findAll devuelva el listado ordenado de despacho.
  const origin = { lat: 40.7, lng: -74.0 };

  async function saveUser(): Promise<User> {
    return dataSource
      .getRepository(User)
      .save(makeUser({ role: UserRole.CLIENT }) as unknown as User);
  }

  async function savePlan(
    userId: string,
    status: SubscriptionStatus,
  ): Promise<void> {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await dataSource.getRepository(Subscription).save({
      userId,
      stripeSubscriptionId: `sub_maint_${stamp}`,
      status,
      currentPeriodStart: new Date(Date.now() - 5 * DAY_MS),
      // Periodo vigente: es lo que hace que cuente como suscriptor vivo.
      currentPeriodEnd: new Date(Date.now() + 25 * DAY_MS),
      cancelAtPeriodEnd: false,
      canceledAt: null,
    } as unknown as Subscription);
  }

  async function saveRental(
    userId: string,
    nextMaintenanceAt: Date,
  ): Promise<Rental> {
    return dataSource.getRepository(Rental).save({
      userId,
      productId: bebederoProduct.id,
      orderId: null,
      stripePriceId: 'price_maint_test',
      monthlyRentCents: 0,
      lateFeeCents: 0,
      status: RentalStatus.ACTIVE,
      activatedAt: new Date(Date.now() - 80 * DAY_MS),
      nextMaintenanceAt,
    } as unknown as Rental);
  }

  const ordersOf = (userId: string): Promise<Order[]> =>
    dataSource.getRepository(Order).find({ where: { customerId: userId } });

  const reloadRental = (id: string): Promise<Rental> =>
    dataSource.getRepository(Rental).findOneByOrFail({ id });

  beforeAll(async () => {
    app = await createTestingApp();
    dataSource = app.get(DataSource);
    cron = app.get(MaintenanceCron);
    ordersService = app.get(OrdersService);
    rentalsService = app.get(RentalsService);

    // Los avisos al cliente (push / WhatsApp) no se prueban acá: se prueba CUÁNDO
    // se disparan. Mockeados para que ningún test salga a la red.
    notifySpy = jest
      .spyOn(app.get(OrderNotificationsService), 'notifyScheduledDelivery')
      .mockImplementation(() => undefined);
    statusSpy = jest
      .spyOn(app.get(OrderNotificationsService), 'notifyStatus')
      .mockImplementation(() => undefined);

    // El producto de mantenimiento ya existe: lo siembra la migración
    // SeedBebederoMaintenance (también en producción), a $0 y sin cotización. El
    // cron toma "EL" producto disponible, así que se usa ése y no uno propio.
    maintenanceProduct = await dataSource
      .getRepository(Product)
      .findOneByOrFail({ isMaintenanceService: true, isAvailable: true });
    initialMaintenanceStock = maintenanceProduct.stock;

    admin = await dataSource
      .getRepository(User)
      .save(
        makeUser({ role: UserRole.SUPER_ADMIN_DELIVERY }) as unknown as User,
      );
    adminAuth = { id: admin.id, email: admin.email, role: admin.role };

    subscriber = await saveUser();
    delinquent = await saveUser();
    notDue = await saveUser();

    bebederoProduct = await dataSource.getRepository(Product).save({
      name: `maint-bebedero-${Date.now()}`,
      description: 'Bebedero (integration)',
      stock: 50,
      priceToPublic: '0.00',
      isAvailable: true,
      pricingMode: 'rental',
      monthlyRentCents: 0,
      lateFeeCents: 0,
      requiresMaintenance: true,
    } as unknown as Product);

    await savePlan(subscriber.id, SubscriptionStatus.ACTIVE);
    await savePlan(delinquent.id, SubscriptionStatus.PAST_DUE);
    await savePlan(notDue.id, SubscriptionStatus.ACTIVE);

    // "Ayer" con margen de sobra (30 h): siempre es un día de Nueva York ANTERIOR
    // a hoy, también en el día de 25 h del cambio de horario.
    const yesterday = new Date(Date.now() - 30 * HOUR_MS);
    subscriberRental = await saveRental(subscriber.id, yesterday);
    delinquentRental = await saveRental(delinquent.id, yesterday);
    notDueRental = await saveRental(
      notDue.id,
      new Date(Date.now() + 30 * DAY_MS),
    );
  });

  afterAll(async () => {
    try {
      if (dataSource?.isInitialized) {
        // Si beforeAll falló a medias hay variables sin asignar: se limpia sólo
        // lo que existe, y SIEMPRE se cierra la app (si no, jest se cuelga).
        const ids = [subscriber, delinquent, notDue]
          .filter((u): u is User => u !== undefined)
          .map((u) => u.id);
        // Orden de borrado por FKs: rentals (apuntan a orders y products) →
        // orders (sus ítems caen en cascada) → planes → producto → usuarios.
        for (const id of ids) {
          await dataSource.getRepository(Rental).delete({ userId: id });
        }
        for (const id of ids) {
          await dataSource.getRepository(Order).delete({ customerId: id });
        }
        for (const id of ids) {
          await dataSource.getRepository(Subscription).delete({ userId: id });
        }
        if (bebederoProduct) {
          await dataSource
            .getRepository(Product)
            .delete({ id: bebederoProduct.id });
        }
        // El producto de mantenimiento es el sembrado por la migración: no se
        // borra, sólo se le devuelve el stock que consumieron las visitas.
        if (maintenanceProduct) {
          await dataSource.getRepository(Product).update(maintenanceProduct.id, {
            stock: initialMaintenanceStock,
            isAvailable: true,
          });
        }
        for (const id of [...ids, admin?.id].filter(Boolean) as string[]) {
          await dataSource.getRepository(User).delete({ id });
        }
      }
    } finally {
      notifySpy?.mockRestore();
      statusSpy?.mockRestore();
      if (app) await app.close();
    }
  });

  it('crea la visita del suscriptor ACTIVE: $0, auto-confirmada, programada para hoy y enlazada al bebedero', async () => {
    const result = await cron.generateDueMaintenanceOrders();

    // La base es compartida: pudo haber otros candidatos de otros specs, pero el
    // nuestro tiene que estar.
    expect(result.created).toBeGreaterThanOrEqual(1);

    const orders = await ordersOf(subscriber.id);
    expect(orders).toHaveLength(1);
    const order = await dataSource
      .getRepository(Order)
      .findOneOrFail({ where: { id: orders[0].id }, relations: ['items'] });

    expect(order.provisioned).toBe(true);
    expect(order.totalAmount).toBe('0.00');
    expect(order.shipping).toBe('0.00');
    // QUOTED → auto-confirmada: el cliente no tiene que tocar nada.
    expect(order.status).toBe(OrderStatus.CONFIRMED_BY_COLMADO);
    // Una columna `date` llega de `pg` como string: se compara string vs string.
    expect(order.scheduledDeliveryDate).toBe(today);
    expect(order.items).toHaveLength(1);
    expect(order.items[0].productId).toBe(maintenanceProduct.id);

    const rental = await reloadRental(subscriberRental.id);
    expect(rental.maintenanceOrderId).toBe(order.id);

    // El aviso del día se dispara una sola vez, con la orden creada.
    expect(notifySpy).toHaveBeenCalledTimes(1);
    expect(notifySpy.mock.calls[0][0].id).toBe(order.id);
  });

  it('la visita aparece en la ruta del admin dentro del bucket `due` (Pendientes)', async () => {
    const [order] = await ordersOf(subscriber.id);

    const { orders } = await ordersService.findAll(adminAuth, { origin });
    const listed = orders.find((o) => o.id === order.id);

    expect(listed).toBeDefined();
    expect(listed?.dispatchBucket).toBe('due');
  });

  it('un segundo corrido no crea nada: la visita abierta ya está enlazada', async () => {
    notifySpy.mockClear();

    await cron.generateDueMaintenanceOrders();

    expect(await ordersOf(subscriber.id)).toHaveLength(1);
    expect(notifySpy).not.toHaveBeenCalled();
  });

  it('no crea visita para el plan past_due ni para el bebedero que aún no vence', async () => {
    expect(await ordersOf(delinquent.id)).toHaveLength(0);
    expect(await ordersOf(notDue.id)).toHaveLength(0);

    expect((await reloadRental(delinquentRental.id)).maintenanceOrderId).toBeNull();
    expect((await reloadRental(notDueRental.id)).maintenanceOrderId).toBeNull();
  });

  it('la visita del sistema no bloquea el pedido de agua del cliente (y viceversa)', async () => {
    // El cliente tiene una visita ABIERTA (provisioned). Un pedido normal suyo no
    // puede chocar con ACTIVE_ORDER_EXISTS por culpa de ella.
    const water = await dataSource.getRepository(Product).save({
      name: `maint-water-${Date.now()}`,
      stock: 50,
      priceToPublic: '5.00',
      isAvailable: true,
      requiresQuote: false,
      pricingMode: 'single_payment',
      monthlyRentCents: 0,
      lateFeeCents: 0,
    } as unknown as Product);

    try {
      const waterOrder = await ordersService.create(
        { id: subscriber.id, role: UserRole.CLIENT, email: null },
        {
          items: [{ productId: water.id, quantity: 1 }],
          paymentMethod: PaymentMethod.CASH,
          usePoints: false,
          useCredit: false,
        } as never,
      );
      expect(waterOrder.provisioned).toBe(false);

      // Y al revés: con SU pedido de agua en curso, el sistema igual puede crear
      // otra visita (provisioned se salta la guarda).
      const visit = await ordersService.create(
        { id: subscriber.id, role: UserRole.CLIENT, email: null },
        {
          items: [{ productId: maintenanceProduct.id, quantity: 1 }],
          paymentMethod: PaymentMethod.CASH,
          usePoints: false,
          useCredit: false,
        } as never,
        { provisioned: true, scheduledDeliveryDate: today },
      );
      expect(visit.provisioned).toBe(true);
    } finally {
      // Limpieza de lo de este test: las órdenes caen con el delete por cliente
      // del afterAll; el producto de agua se borra acá (sus ítems primero).
      await dataSource
        .getRepository(OrderItem)
        .delete({ productId: water.id });
      await dataSource.getRepository(Product).delete({ id: water.id });
    }
  });

  it('el cliente ve la visita programada en sus bebederos (maintenanceScheduledFor = hoy)', async () => {
    const linkedId = (await reloadRental(subscriberRental.id))
      .maintenanceOrderId;
    expect(linkedId).toBeTruthy();

    const mine = await rentalsService.listMine(subscriber.id);

    expect(mine).toHaveLength(1);
    expect(mine[0].maintenanceOrderId).toBe(linkedId);
    expect(mine[0].maintenanceScheduledFor).toBe(today);
  });

  it('al entregar la visita se reinicia el contador y se suelta el enlace', async () => {
    await rentalsService.resetMaintenanceForUser(subscriber.id);

    const rental = await reloadRental(subscriberRental.id);
    expect(rental.maintenanceOrderId).toBeNull();
    expect(rental.lastMaintenanceAt).not.toBeNull();
    // ~90 días hacia adelante.
    const ahead = rental.nextMaintenanceAt!.getTime() - Date.now();
    expect(ahead).toBeGreaterThan(89 * DAY_MS);
    expect(ahead).toBeLessThan(91 * DAY_MS);

    // Con el contador al día, el cron ya no tiene nada que hacer por este usuario.
    const before = (await ordersOf(subscriber.id)).length;
    await cron.generateDueMaintenanceOrders();
    expect(await ordersOf(subscriber.id)).toHaveLength(before);

    const mine = await rentalsService.listMine(subscriber.id);
    expect(mine[0].maintenanceOrderId).toBeNull();
    expect(mine[0].maintenanceScheduledFor).toBeNull();
  });

  it('una visita CANCELADA se regenera en el siguiente corrido (no ocurrió, sigue vencida)', async () => {
    // Vuelve a vencer el bebedero y reaparece una visita abierta…
    await dataSource.getRepository(Rental).update(subscriberRental.id, {
      nextMaintenanceAt: new Date(Date.now() - 30 * HOUR_MS),
    });
    await cron.generateDueMaintenanceOrders();
    const linkedId = (await reloadRental(subscriberRental.id)).maintenanceOrderId;
    expect(linkedId).toBeTruthy();

    // …el admin la cancela: el bebedero sigue vencido y el cron la regenera.
    await dataSource
      .getRepository(Order)
      .update(linkedId!, { status: OrderStatus.CANCELLED });
    await cron.generateDueMaintenanceOrders();

    const regeneratedId = (await reloadRental(subscriberRental.id))
      .maintenanceOrderId;
    expect(regeneratedId).toBeTruthy();
    expect(regeneratedId).not.toBe(linkedId);

    // Y borrar la orden CANCELADA (ON DELETE SET NULL) deja el enlace limpio.
    await dataSource.getRepository(Order).delete({ id: linkedId! });
    expect(
      await dataSource.getRepository(Order).findOneBy({ id: linkedId! }),
    ).toBeNull();
  });
});
