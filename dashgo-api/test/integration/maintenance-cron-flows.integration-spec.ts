/**
 * Integration spec — mantenimiento automático: los RECORRIDOS reales alrededor de
 * la visita que genera MaintenanceCron, contra Postgres REAL.
 *
 * POR QUÉ existe (además de maintenance-cron.integration-spec.ts): aquel prueba
 * el corrido feliz con atajos (cancela con un UPDATE crudo, entrega llamando
 * directo a resetMaintenanceForUser). Acá cada transición pasa por el camino que
 * usa la app de verdad — `OrdersService.create`, `updateStatus` como admin,
 * `deleteOrder` — porque es ahí donde se esconden las interacciones que un mock
 * no ve: la guarda "un pedido activo a la vez", la reversión de stock al
 * cancelar, el reinicio del contador en `markDelivered`, el FK
 * `ON DELETE SET NULL` y los avisos que de verdad salen por cada visita.
 *
 * Cada escenario tiene SU usuario, para que los corridos del cron de un test no
 * contaminen las aserciones de otro (el cron recorre toda la base). Las filas se
 * commitean y se borran a mano en `afterAll`; la base se comparte con los demás
 * specs.
 */

// eslint-disable-next-line no-var
var mockStripe: Record<string, unknown>;
jest.mock('stripe', () => jest.fn().mockImplementation(() => mockStripe));

mockStripe = {
  prices: {
    retrieve: jest.fn().mockResolvedValue({
      id: 'price_test_monthly',
      product: 'prod_maintenance_flows',
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
    create: jest.fn().mockResolvedValue({ id: 'cus_maintenance_flows' }),
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
import { todayIsoDay, formatDeliveryDay } from '../../src/common/delivery-day';
import { OrdersService } from '../../src/modules/orders/orders.service';
import { MaintenanceCron } from '../../src/modules/orders/maintenance.cron';
import { RentalsService } from '../../src/modules/rentals/rentals.service';
import { PushService } from '../../src/modules/notifications/push.service';
import { WhatsAppService } from '../../src/modules/whatsapp/whatsapp.service';
import { TwilioService } from '../../src/modules/twilio/twilio.service';
import type { AuthenticatedUser } from '../../src/common/types/authenticated-user';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

describe('Mantenimiento automático — recorridos reales (integration)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let cron: MaintenanceCron;
  let ordersService: OrdersService;
  let rentalsService: RentalsService;
  let pushSpy: jest.SpyInstance;
  let whatsappSpy: jest.SpyInstance;
  let smsSpy: jest.SpyInstance;
  // Lo que salió en EL corrido de beforeAll, congelado antes de que los tests
  // generen sus propios avisos (el pedido de agua de (b), las cancelaciones…).
  let burst: { push: unknown[][]; whatsapp: unknown[][]; sms: unknown[][] };

  let admin: User;
  let adminAuth: AuthenticatedUser;
  let maintenanceProduct: Product;
  let initialMaintenanceStock: number;
  let bebederoProduct: Product;
  let waterQuoted: Product; // requiresQuote=true → nace en pending_quote
  let waterInstant: Product; // requiresQuote=false → se auto-cotiza

  // Un usuario por escenario (ver el doc de arriba).
  const users: Record<string, User> = {};
  const rentals: Record<string, Rental[]> = {};
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  let seq = 0;

  const today = todayIsoDay();
  const origin = { lat: 40.7, lng: -74.0 };
  // Con margen (30 h) para que sea un día de Nueva York ANTERIOR a hoy también
  // en el día de 25 h del cambio de horario.
  const overdue = (): Date => new Date(Date.now() - 30 * HOUR_MS);

  const asClient = (u: User): AuthenticatedUser => ({
    id: u.id,
    email: u.email,
    role: UserRole.CLIENT,
  });

  async function saveUser(
    overrides: Partial<User> = {},
  ): Promise<User> {
    seq += 1;
    return dataSource.getRepository(User).save({
      ...makeUser({ role: UserRole.CLIENT }),
      // Únicos por corrido: makeUser numera desde 1 en cada archivo.
      email: `maint-flows-${stamp}-${seq}@test.example`,
      phone: `+1201${String(Date.now()).slice(-5)}${String(seq).padStart(2, '0')}`,
      ...overrides,
    } as unknown as User);
  }

  async function savePlan(
    userId: string,
    status: SubscriptionStatus,
  ): Promise<void> {
    await dataSource.getRepository(Subscription).save({
      userId,
      stripeSubscriptionId: `sub_maint_flows_${stamp}_${userId.slice(0, 8)}`,
      status,
      currentPeriodStart: new Date(Date.now() - 5 * DAY_MS),
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
      stripePriceId: 'price_maint_flows',
      monthlyRentCents: 0,
      lateFeeCents: 0,
      status: RentalStatus.ACTIVE,
      activatedAt: new Date(Date.now() - 100 * DAY_MS),
      nextMaintenanceAt,
    } as unknown as Rental);
  }

  /** Usuario con plan (o sin él) y N bebederos vencidos. */
  async function scenario(
    key: string,
    opts: {
      plan?: SubscriptionStatus | null;
      bebederos?: number;
      user?: Partial<User>;
    } = {},
  ): Promise<void> {
    const user = await saveUser(opts.user);
    users[key] = user;
    const plan =
      opts.plan === undefined ? SubscriptionStatus.ACTIVE : opts.plan;
    if (plan) await savePlan(user.id, plan);
    rentals[key] = [];
    for (let i = 0; i < (opts.bebederos ?? 1); i += 1) {
      rentals[key].push(await saveRental(user.id, overdue()));
    }
  }

  const ordersOf = (key: string): Promise<Order[]> =>
    dataSource.getRepository(Order).find({
      where: { customerId: users[key].id },
      order: { createdAt: 'ASC' },
    });

  /** Las visitas = órdenes del usuario que llevan el producto de servicio. */
  async function visitsOf(key: string): Promise<Order[]> {
    const all = await ordersOf(key);
    return all.filter((o) =>
      o.items.some((i) => i.productId === maintenanceProduct.id),
    );
  }

  const reloadRental = (id: string): Promise<Rental> =>
    dataSource.getRepository(Rental).findOneByOrFail({ id });

  const productStock = async (id: string): Promise<number> =>
    (await dataSource.getRepository(Product).findOneByOrFail({ id })).stock;

  async function saveProduct(overrides: Partial<Product>): Promise<Product> {
    return dataSource.getRepository(Product).save({
      description: 'maintenance flows (integration)',
      stock: 500,
      isAvailable: true,
      monthlyRentCents: 0,
      lateFeeCents: 0,
      ...overrides,
    } as unknown as Product);
  }

  beforeAll(async () => {
    app = await createTestingApp();
    dataSource = app.get(DataSource);
    cron = app.get(MaintenanceCron);
    ordersService = app.get(OrdersService);
    rentalsService = app.get(RentalsService);

    // Se espía el ÚLTIMO eslabón de cada canal (no notifyStatus /
    // notifyScheduledDelivery): así el test ve exactamente qué texto le llega al
    // cliente y cuántos SMS al dueño por cada visita, sin salir a la red.
    pushSpy = jest
      .spyOn(app.get(PushService), 'sendToUser')
      .mockResolvedValue(1 as never);
    whatsappSpy = jest
      .spyOn(app.get(WhatsAppService), 'sendTemplate')
      .mockResolvedValue(true as never);
    smsSpy = jest
      .spyOn(app.get(TwilioService), 'sendOrderNotificationSms')
      .mockResolvedValue(undefined);

    maintenanceProduct = await dataSource
      .getRepository(Product)
      .findOneByOrFail({ isMaintenanceService: true, isAvailable: true });
    initialMaintenanceStock = maintenanceProduct.stock;

    admin = await saveUser({ role: UserRole.SUPER_ADMIN_DELIVERY });
    adminAuth = { id: admin.id, email: admin.email, role: admin.role };

    bebederoProduct = await saveProduct({
      name: `flows-bebedero-${stamp}`,
      priceToPublic: '0.00',
      pricingMode: 'rental',
      requiresMaintenance: true,
    } as Partial<Product>);
    waterQuoted = await saveProduct({
      name: `flows-water-quoted-${stamp}`,
      priceToPublic: '5.00',
      requiresQuote: true,
      pricingMode: 'single_payment',
    } as Partial<Product>);
    waterInstant = await saveProduct({
      name: `flows-water-instant-${stamp}`,
      priceToPublic: '5.00',
      requiresQuote: false,
      pricingMode: 'single_payment',
    } as Partial<Product>);

    await scenario('withOpenWater'); // (a)
    await scenario('normalAfterVisit'); // (b) + avisos
    await scenario('twoBebederos', { bebederos: 2 }); // (c)
    await scenario('cancelled'); // (d) + deleteOrder
    await scenario('delivered'); // (e)
    await scenario('pastDue', { plan: SubscriptionStatus.PAST_DUE }); // (f)
    await scenario('timerOff', { user: { maintenanceTimerDisabled: true } }); // (g)
    await scenario('noPlan', { plan: null }); // (h)
    await scenario('manualRequest'); // pidió el mantenimiento a mano antes
    await scenario('disabledMidVisit'); // el admin apaga el contador con la visita en curso

    // (a) El cliente ya tiene su pedido de agua abierto (pending_quote) ANTES
    // de que corra el cron.
    const water = await ordersService.create(
      asClient(users.withOpenWater),
      {
        items: [{ productId: waterQuoted.id, quantity: 1 }],
        paymentMethod: PaymentMethod.CASH,
        usePoints: false,
        useCredit: false,
      } as never,
    );
    expect(water.status).toBe(OrderStatus.PENDING_QUOTE);

    // El cliente tocó "Solicitar mantenimiento" en el banner antes del deploy:
    // el mismo POST /orders que hace la app (sin opts del sistema).
    const manual = await ordersService.create(
      asClient(users.manualRequest),
      {
        items: [{ productId: maintenanceProduct.id, quantity: 1 }],
        paymentMethod: PaymentMethod.CASH,
        usePoints: false,
        useCredit: false,
      } as never,
    );
    expect(manual.provisioned).toBe(false);

    pushSpy.mockClear();
    whatsappSpy.mockClear();
    smsSpy.mockClear();

    // EL corrido: todos los escenarios a la vez, como en el primer deploy.
    await cron.generateDueMaintenanceOrders();
    burst = {
      push: [...pushSpy.mock.calls],
      whatsapp: [...whatsappSpy.mock.calls],
      sms: [...smsSpy.mock.calls],
    };
  });

  afterAll(async () => {
    try {
      if (dataSource?.isInitialized) {
        const ids = Object.values(users).map((u) => u.id);
        // Orden por FKs: rentals (→ orders, products) → orders (ítems en
        // cascada) → planes → productos → usuarios.
        for (const id of ids) {
          await dataSource.getRepository(Rental).delete({ userId: id });
        }
        for (const id of ids) {
          await dataSource.getRepository(Order).delete({ customerId: id });
        }
        for (const id of ids) {
          await dataSource.getRepository(Subscription).delete({ userId: id });
        }
        for (const p of [bebederoProduct, waterQuoted, waterInstant]) {
          if (!p) continue;
          await dataSource.getRepository(OrderItem).delete({ productId: p.id });
          await dataSource.getRepository(Product).delete({ id: p.id });
        }
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
      pushSpy?.mockRestore();
      whatsappSpy?.mockRestore();
      smsSpy?.mockRestore();
      if (app) await app.close();
    }
  });

  it('(a) un pedido de agua abierto (pending_quote) NO impide que el sistema genere la visita', async () => {
    const all = await ordersOf('withOpenWater');
    const visits = await visitsOf('withOpenWater');

    expect(all).toHaveLength(2);
    expect(visits).toHaveLength(1);
    expect(visits[0].provisioned).toBe(true);
    expect(visits[0].status).toBe(OrderStatus.CONFIRMED_BY_COLMADO);
    // El agua sigue intacta, esperando su cotización.
    const water = all.find((o) => o.id !== visits[0].id)!;
    expect(water.status).toBe(OrderStatus.PENDING_QUOTE);
    expect(
      (await reloadRental(rentals.withOpenWater[0].id)).maintenanceOrderId,
    ).toBe(visits[0].id);
  });

  it('(b) con la visita abierta el cliente puede pedir agua; un SEGUNDO pedido normal sigue bloqueado', async () => {
    const [visit] = await visitsOf('normalAfterVisit');
    expect(visit.status).toBe(OrderStatus.CONFIRMED_BY_COLMADO);

    const first = await ordersService.create(
      asClient(users.normalAfterVisit),
      {
        items: [{ productId: waterInstant.id, quantity: 1 }],
        paymentMethod: PaymentMethod.CASH,
        usePoints: false,
        useCredit: false,
      } as never,
    );
    expect(first.provisioned).toBe(false);

    await expect(
      ordersService.create(asClient(users.normalAfterVisit), {
        items: [{ productId: waterInstant.id, quantity: 1 }],
        paymentMethod: PaymentMethod.CASH,
        usePoints: false,
        useCredit: false,
      } as never),
    ).rejects.toMatchObject({ response: { code: 'ACTIVE_ORDER_EXISTS' } });
  });

  it('avisos de UNA visita: 1 SMS al dueño; al cliente UN solo push y UN solo WhatsApp (el del día programado, sin "pedido confirmado")', async () => {
    const user = users.normalAfterVisit;
    const [visit] = await visitsOf('normalAfterVisit');

    // Dueño: un sendOrderNotificationSms por visita (que manda 1 SMS a cada
    // número de ORDER_SMS_NOTIFY_NUMBERS).
    const sms = burst.sms.filter(([o]) => (o as Order).id === visit.id);
    expect(sms).toHaveLength(1);
    expect((sms[0][0] as Order).totalAmount).toBe('0.00');

    // Cliente — push. La visita la agendó el SISTEMA: el cliente no pidió nada,
    // así que NO recibe el genérico "Tu pedido fue confirmado…"; el aviso del día
    // programado es el único mensaje.
    const pushes = burst.push.filter(([uid]) => uid === user.id);
    expect(pushes.map((c) => c[2])).toEqual([
      `Tu mantenimiento de bebedero quedó programado para el ${formatDeliveryDay(today)}.`,
    ]);

    // Cliente — WhatsApp: el template aprobado, sólo con la frase del día.
    const wa = burst.whatsapp.filter(([phone]) => phone === user.phone);
    expect(wa.map((c) => (c[2] as string[])[1])).toEqual([
      `tu entrega quedó programada para el ${formatDeliveryDay(today)}.`,
    ]);
  });

  it('(c) dos bebederos vencidos → UNA sola visita, enlazada a los dos', async () => {
    const visits = await visitsOf('twoBebederos');
    expect(visits).toHaveLength(1);
    for (const r of rentals.twoBebederos) {
      expect((await reloadRental(r.id)).maintenanceOrderId).toBe(visits[0].id);
    }
  });

  it('con la visita del sistema abierta, el botón manual (app vieja) NO crea una segunda visita', async () => {
    // Las versiones de la app sin `maintenanceOrderId` siguen mostrando
    // "Solicitar mantenimiento" vencido: el mismo POST /orders que hacen ellas.
    await expect(
      ordersService.create(asClient(users.twoBebederos), {
        items: [{ productId: maintenanceProduct.id, quantity: 1 }],
        paymentMethod: PaymentMethod.CASH,
        usePoints: false,
        useCredit: false,
      } as never),
    ).rejects.toMatchObject({
      response: { code: 'MAINTENANCE_ALREADY_SCHEDULED' },
    });
    expect(await visitsOf('twoBebederos')).toHaveLength(1);
  });

  it('(i) la visita aparece en la ruta del admin en `due`, programada para hoy', async () => {
    const [visit] = await visitsOf('twoBebederos');
    const { orders } = await ordersService.findAll(adminAuth, { origin });
    const listed = orders.find((o) => o.id === visit.id);

    expect(listed?.dispatchBucket).toBe('due');
    expect(listed?.scheduledDeliveryDate).toBe(today);
  });

  it('(d) el admin la cancela por updateStatus → se repone el stock y el próximo corrido la regenera y re-enlaza', async () => {
    const [visit] = await visitsOf('cancelled');
    const stockBefore = await productStock(maintenanceProduct.id);

    await ordersService.updateStatus(
      visit.id,
      { status: OrderStatus.CANCELLED },
      adminAuth,
    );
    // Estaba confirmada (stock descontado): cancelar lo devuelve.
    expect(await productStock(maintenanceProduct.id)).toBe(stockBefore + 1);

    // Para el cliente ya no hay visita programada mientras tanto.
    const [dtoAfterCancel] = await rentalsService.listMine(users.cancelled.id);
    expect(dtoAfterCancel.maintenanceOrderId).toBeNull();

    await cron.generateDueMaintenanceOrders();

    const visits = await visitsOf('cancelled');
    expect(visits).toHaveLength(2);
    const regenerated = visits.find((o) => o.id !== visit.id)!;
    expect(regenerated.status).toBe(OrderStatus.CONFIRMED_BY_COLMADO);
    expect(
      (await reloadRental(rentals.cancelled[0].id)).maintenanceOrderId,
    ).toBe(regenerated.id);
  });

  it('(d) borrar como admin la visita cancelada (deleteOrder) suelta el enlace por ON DELETE SET NULL', async () => {
    const rentalId = rentals.cancelled[0].id;
    const linked = (await reloadRental(rentalId)).maintenanceOrderId!;

    await ordersService.updateStatus(
      linked,
      { status: OrderStatus.CANCELLED },
      adminAuth,
    );
    await ordersService.deleteOrder(linked, adminAuth);

    expect(
      await dataSource.getRepository(Order).findOneBy({ id: linked }),
    ).toBeNull();
    expect((await reloadRental(rentalId)).maintenanceOrderId).toBeNull();
  });

  it('(e) entregada por el flujo real (en ruta → entregada): contador +90 días, enlace NULL y el cron no crea nada más', async () => {
    const [visit] = await visitsOf('delivered');

    await ordersService.updateStatus(
      visit.id,
      { status: OrderStatus.IN_DELIVERY_ROUTE },
      adminAuth,
    );
    const done = await ordersService.updateStatus(
      visit.id,
      { status: OrderStatus.DELIVERED },
      adminAuth,
    );
    expect(done.status).toBe(OrderStatus.DELIVERED);

    const rental = await reloadRental(rentals.delivered[0].id);
    expect(rental.maintenanceOrderId).toBeNull();
    expect(rental.lastMaintenanceAt).not.toBeNull();
    const ahead = rental.nextMaintenanceAt!.getTime() - Date.now();
    expect(ahead).toBeGreaterThan(89 * DAY_MS);
    expect(ahead).toBeLessThan(91 * DAY_MS);

    await cron.generateDueMaintenanceOrders();
    expect(await visitsOf('delivered')).toHaveLength(1);
  });

  it('si el admin apaga el contador con la visita en curso y se entrega igual, el enlace se suelta (no queda trabado)', async () => {
    const [visit] = await visitsOf('disabledMidVisit');
    await dataSource
      .getRepository(User)
      .update(users.disabledMidVisit.id, { maintenanceTimerDisabled: true });

    await ordersService.updateStatus(
      visit.id,
      { status: OrderStatus.IN_DELIVERY_ROUTE },
      adminAuth,
    );
    await ordersService.updateStatus(
      visit.id,
      { status: OrderStatus.DELIVERED },
      adminAuth,
    );

    // Con el contador apagado no se reinicia, pero la visita ya no está abierta.
    const rental = await reloadRental(rentals.disabledMidVisit[0].id);
    expect(rental.maintenanceOrderId).toBeNull();
    expect(rental.lastMaintenanceAt).toBeNull();
  });

  it('(f) plan past_due → ninguna visita', async () => {
    expect(await ordersOf('pastDue')).toHaveLength(0);
    expect(
      (await reloadRental(rentals.pastDue[0].id)).maintenanceOrderId,
    ).toBeNull();
  });

  it('(g) contador apagado por el admin → ninguna visita', async () => {
    expect(await ordersOf('timerOff')).toHaveLength(0);
  });

  it('(h) sin suscripción → ninguna visita, y el DTO deja el botón manual (sin visita, vencido)', async () => {
    expect(await ordersOf('noPlan')).toHaveLength(0);

    const [dto] = await rentalsService.listMine(users.noPlan.id);
    expect(dto.maintenanceOrderId).toBeNull();
    expect(dto.maintenanceScheduledFor).toBeNull();
    expect(new Date(dto.nextMaintenanceAt!).getTime()).toBeLessThan(Date.now());
  });

  it('un mantenimiento pedido A MANO y todavía abierto cuenta como la visita: no se crea otra, se enlaza ésa', async () => {
    const visits = await visitsOf('manualRequest');

    // Sin esto el cliente recibe DOS visitas (la suya y la del sistema) y el
    // repartidor va dos veces.
    expect(visits).toHaveLength(1);
    expect(visits[0].provisioned).toBe(false);
    expect(
      (await reloadRental(rentals.manualRequest[0].id)).maintenanceOrderId,
    ).toBe(visits[0].id);

    // Y corridos posteriores siguen sin duplicar.
    await cron.generateDueMaintenanceOrders();
    expect(await visitsOf('manualRequest')).toHaveLength(1);
  });
});
