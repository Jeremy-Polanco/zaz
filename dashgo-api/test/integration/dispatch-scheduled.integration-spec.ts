/**
 * Integration spec — pedidos programados fuera de la ruta de hoy, contra
 * Postgres REAL.
 *
 * POR QUÉ existe: `sortOrdersForDispatch` compara `scheduledDeliveryDate` con
 * `todayIsoDay` como TEXTO ('YYYY-MM-DD' > 'YYYY-MM-DD'). Los unit tests sólo
 * usan fixtures con strings, así que nunca probaron lo que el driver `pg`
 * entrega de verdad para una columna Postgres `date`: si fuera un `Date`, la
 * comparación `Date > string` daría falso/NaN y TODOS los programados caerían
 * en `due` (o peor, en `scheduled`) en producción sin que ningún test lo viera.
 * Acá se prueba el recorrido completo: escribir el día, leerlo de la base, y
 * ver en qué bucket y en qué posición sale en `findAll`.
 *
 * Los pedidos se guardan commiteados (no hay rollback por test) porque el
 * service lee con otra conexión; la limpieza es manual en `afterAll`.
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
      product: 'prod_dispatch_test',
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
    create: jest.fn().mockResolvedValue({ id: 'cus_dispatch_test' }),
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
import { makeOrder, makeUser } from '../../src/test-utils/fixtures';
import { User } from '../../src/entities/user.entity';
import { Order } from '../../src/entities/order.entity';
import { OrderStatus, UserRole } from '../../src/entities/enums';
import { OrdersService } from '../../src/modules/orders/orders.service';
import { OrderNotificationsService } from '../../src/modules/orders/order-notifications.service';
import { todayIsoDay } from '../../src/common/delivery-day';
import type { AuthenticatedUser } from '../../src/common/types/authenticated-user';

/**
 * Suma `delta` días a un día ISO sin pasar por `toISOString` (UTC) ni por
 * `new Date('YYYY-MM-DD')` (medianoche UTC): se arma con los componentes en hora
 * LOCAL, al MEDIODÍA para que un cambio de horario nunca mueva el día, y se
 * vuelve a formatear con el propio `todayIsoDay` fijando la zona local del
 * proceso. Así el test da lo mismo corra en UTC, en Nueva York o en Auckland.
 */
function shiftIsoDay(isoDay: string, delta: number): string {
  const [y, m, d] = isoDay.split('-').map(Number);
  const localNoon = new Date(y, m - 1, d + delta, 12);
  const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return todayIsoDay(localNoon, localZone);
}

describe('Pedidos programados fuera de ruta (integration, Postgres real)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let ordersService: OrdersService;
  let notifySpy: jest.SpyInstance;

  let admin: User;
  let adminAuth: AuthenticatedUser;
  let customer: User;
  let orderA: Order; // sin programar, LEJOS del origen
  let orderB: Order; // el que se programa, el más CERCA del origen
  let orderC: Order; // programado para AYER, a media distancia

  // El repartidor está parado en (40.7000, -74.0000); B queda a ~70 m, C a ~7 km
  // y A a ~35 km. Si el día se ignorara, el orden sería B, C, A: justamente lo
  // que el dueño reportó como bug (el programado mezclado en la ruta).
  const origin = { lat: 40.7, lng: -74.0 };
  const pinA = { text: 'A lejos', lat: 41.0, lng: -74.0 };
  const pinB = { text: 'B cerca', lat: 40.7006, lng: -74.0 };
  const pinC = { text: 'C medio', lat: 40.76, lng: -74.0 };

  const today = todayIsoDay();
  const tomorrow = shiftIsoDay(today, 1);
  const yesterday = shiftIsoDay(today, -1);

  async function saveOrder(
    pin: { text: string; lat: number; lng: number },
    scheduledDeliveryDate: string | null,
  ): Promise<Order> {
    return dataSource.getRepository(Order).save({
      ...makeOrder({ customerId: customer.id }),
      status: OrderStatus.CONFIRMED_BY_COLMADO,
      deliveryAddress: pin,
      scheduledDeliveryDate,
    } as unknown as Order);
  }

  /** Corre el listado del admin y devuelve sólo A, B y C, en el orden recibido. */
  async function listMine() {
    const { orders } = await ordersService.findAll(adminAuth, { origin });
    const ids = [orderA.id, orderB.id, orderC.id];
    const mine = orders.filter((o) => ids.includes(o.id));
    return { all: orders, mine };
  }

  const bucketOf = (
    orders: Array<{ id: string; dispatchBucket?: string }>,
    id: string,
  ) => orders.find((o) => o.id === id)?.dispatchBucket;

  beforeAll(async () => {
    app = await createTestingApp();
    dataSource = app.get(DataSource);
    ordersService = app.get(OrdersService);

    // Reprogramar avisa al cliente por push/WhatsApp; acá no se prueba el
    // canal, se prueba CUÁNDO se dispara (ver el test de "misma fecha").
    notifySpy = jest
      .spyOn(app.get(OrderNotificationsService), 'notifyScheduledDelivery')
      .mockImplementation(() => undefined);

    admin = await dataSource
      .getRepository(User)
      .save(
        makeUser({ role: UserRole.SUPER_ADMIN_DELIVERY }) as unknown as User,
      );
    adminAuth = { id: admin.id, email: admin.email, role: admin.role };
    customer = await dataSource
      .getRepository(User)
      .save(makeUser({ role: UserRole.CLIENT }) as unknown as User);

    orderA = await saveOrder(pinA, null);
    orderB = await saveOrder(pinB, tomorrow);
    orderC = await saveOrder(pinC, yesterday);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.getRepository(Order).delete({ customerId: customer.id });
      await dataSource.getRepository(User).delete({ id: customer.id });
      await dataSource.getRepository(User).delete({ id: admin.id });
    }
    notifySpy?.mockRestore();
    if (app) await app.close();
  });

  it('una columna `date` llega de Postgres como string "YYYY-MM-DD", no como Date', async () => {
    const viaEntity = await dataSource
      .getRepository(Order)
      .findOneByOrFail({ id: orderB.id });
    const viaService = await ordersService.findOne(orderB.id, adminAuth);
    // Lectura cruda: es lo que entrega el driver `pg` SIN la hidratación de
    // TypeORM. Se documenta para que quede claro de dónde viene el riesgo.
    const [raw] = await dataSource.query(
      `SELECT scheduled_delivery_date AS d FROM orders WHERE id = $1`,
      [orderB.id],
    );

    // eslint-disable-next-line no-console
    console.log(
      `[round-trip] entity=${typeof viaEntity.scheduledDeliveryDate}(${String(
        viaEntity.scheduledDeliveryDate,
      )}) service.findOne=${typeof viaService.scheduledDeliveryDate} raw-pg=${
        raw.d instanceof Date ? 'Date' : typeof raw.d
      }`,
    );

    expect(typeof viaEntity.scheduledDeliveryDate).toBe('string');
    expect(viaEntity.scheduledDeliveryDate).toBe(tomorrow);
    expect(typeof viaService.scheduledDeliveryDate).toBe('string');
    expect(viaService.scheduledDeliveryDate).toBe(tomorrow);
  });

  it('sin programar y vencido son `due`; el programado a mañana es `scheduled` y va DESPUÉS aunque esté más cerca', async () => {
    const { all, mine } = await listMine();

    expect(bucketOf(mine, orderA.id)).toBe('due');
    expect(bucketOf(mine, orderC.id)).toBe('due');
    expect(bucketOf(mine, orderB.id)).toBe('scheduled');

    const pos = (id: string) => all.findIndex((o) => o.id === id);
    // B es el más cercano (distancia menor), pero programado → después de A y C.
    const dist = (id: string) => all.find((o) => o.id === id)!.distanceMiles!;
    expect(dist(orderB.id)).toBeLessThan(dist(orderC.id));
    expect(dist(orderC.id)).toBeLessThan(dist(orderA.id));
    expect(pos(orderB.id)).toBeGreaterThan(pos(orderA.id));
    expect(pos(orderB.id)).toBeGreaterThan(pos(orderC.id));
    // Entre los dos vencidos/sin día manda la cercanía: C (más cerca) antes que A.
    expect(pos(orderC.id)).toBeLessThan(pos(orderA.id));

    // Invariante global (la base compartida puede traer pedidos de otros
    // specs): la secuencia de buckets nunca retrocede due → scheduled → history.
    const rank = { due: 0, scheduled: 1, history: 2 } as const;
    const ranks = all.map((o) => rank[o.dispatchBucket!]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it('programado para HOY (Nueva York) es `due`: ya le toca a la ruta', async () => {
    await ordersService.setScheduledDeliveryDate(orderB.id, today, adminAuth);

    const { mine } = await listMine();
    expect(bucketOf(mine, orderB.id)).toBe('due');
  });

  it('al sacarle el día (null) vuelve a `due` y a su lugar por cercanía', async () => {
    await ordersService.setScheduledDeliveryDate(orderB.id, null, adminAuth);

    const { all, mine } = await listMine();
    expect(bucketOf(mine, orderB.id)).toBe('due');
    const after = await ordersService.findOne(orderB.id, adminAuth);
    expect(after.scheduledDeliveryDate).toBeNull();
    // Sin día y el más cercano de los tres → primero entre los suyos.
    expect(mine.map((o) => o.id)).toEqual([orderB.id, orderC.id, orderA.id]);
    expect(all.findIndex((o) => o.id === orderB.id)).toBeLessThan(
      all.findIndex((o) => o.id === orderA.id),
    );
  });

  it('reprogramar a mañana lo manda otra vez a `scheduled`', async () => {
    await ordersService.setScheduledDeliveryDate(orderB.id, tomorrow, adminAuth);

    const { mine } = await listMine();
    expect(bucketOf(mine, orderB.id)).toBe('scheduled');
    expect(mine[mine.length - 1].id).toBe(orderB.id);
  });

  it('re-guardar la MISMA fecha no vuelve a notificar al cliente (la comparación es string vs string)', async () => {
    // Si la lectura devolviera un `Date`, `date !== order.scheduledDeliveryDate`
    // sería siempre verdadero y el cliente recibiría el aviso en cada guardado.
    notifySpy.mockClear();

    await ordersService.setScheduledDeliveryDate(orderB.id, tomorrow, adminAuth);
    expect(notifySpy).not.toHaveBeenCalled();

    await ordersService.setScheduledDeliveryDate(
      orderB.id,
      shiftIsoDay(tomorrow, 1),
      adminAuth,
    );
    expect(notifySpy).toHaveBeenCalledTimes(1);
  });

  it('un pedido entregado con día futuro cae en `history`, no en `scheduled`', async () => {
    await dataSource
      .getRepository(Order)
      .update(orderB.id, { status: OrderStatus.DELIVERED });

    const { mine } = await listMine();
    expect(bucketOf(mine, orderB.id)).toBe('history');
    expect(mine[mine.length - 1].id).toBe(orderB.id);
  });

  it('el cliente no recibe `dispatchBucket` ni `distanceMiles` en su listado', async () => {
    const { orders } = await ordersService.findAll({
      id: customer.id,
      email: customer.email,
      role: UserRole.CLIENT,
    });

    expect(orders.length).toBeGreaterThanOrEqual(3);
    for (const o of orders) {
      expect(o).not.toHaveProperty('dispatchBucket');
      expect(o).not.toHaveProperty('distanceMiles');
    }
  });
});
