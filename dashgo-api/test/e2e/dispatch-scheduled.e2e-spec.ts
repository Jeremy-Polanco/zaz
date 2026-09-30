/**
 * E2E spec — pedidos programados fuera de la ruta, por HTTP real (supertest).
 *
 * Recorre lo que hace la app del repartidor: `PATCH /orders/:id/delivery-date`
 * para programar y `GET /orders?lat&lng` para armar la ruta. Lo que se prueba es
 * el comportamiento observable en el JSON (bucket y posición), no la función de
 * orden, porque lo que importa es que el programado SALGA de la ruta de hoy en
 * la respuesta que consume el cliente móvil/web.
 *
 * La base es compartida y el admin lista TODOS los pedidos, así que las
 * aserciones de orden son relativas a los pedidos de este spec más la
 * invariante global due → scheduled → history.
 */

import * as path from 'path';
import * as fs from 'fs';

// El service usa `import Stripe = require('stripe')` → constructor directo.
// eslint-disable-next-line no-var
var mockStripe: Record<string, unknown>;
jest.mock('stripe', () => jest.fn().mockImplementation(() => mockStripe));

mockStripe = {
  prices: {
    retrieve: jest.fn().mockResolvedValue({
      id: 'price_test_monthly',
      product: 'prod_dispatch_e2e',
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
    create: jest.fn().mockResolvedValue({ id: 'cus_dispatch_e2e' }),
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

// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createTestingApp } from '../../src/test-utils/testing-app';
import { makeOrder, makeUser } from '../../src/test-utils/fixtures';
import { User } from '../../src/entities/user.entity';
import { Order } from '../../src/entities/order.entity';
import { OrderStatus, UserRole } from '../../src/entities/enums';
import { OrderNotificationsService } from '../../src/modules/orders/order-notifications.service';
import { todayIsoDay } from '../../src/common/delivery-day';
import { issueTestToken } from './helpers/auth.helper';

function loadEnvTest(): void {
  const envTestPath = path.resolve(__dirname, '../../.env.test');
  if (!fs.existsSync(envTestPath)) return;
  const lines = fs.readFileSync(envTestPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

/**
 * Suma `delta` días a un día ISO sin `toISOString` (UTC) ni
 * `new Date('YYYY-MM-DD')` (medianoche UTC): componentes en hora LOCAL al
 * mediodía, formateados con el propio `todayIsoDay` en la zona local del
 * proceso. Da igual en UTC, Nueva York o Auckland.
 */
function shiftIsoDay(isoDay: string, delta: number): string {
  const [y, m, d] = isoDay.split('-').map(Number);
  const localNoon = new Date(y, m - 1, d + delta, 12);
  const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return todayIsoDay(localNoon, localZone);
}

interface ListedOrder {
  id: string;
  dispatchBucket?: string;
  distanceMiles?: number | null;
  scheduledDeliveryDate?: string | null;
}

describe('Pedidos programados fuera de ruta (E2E)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let adminToken: string;
  let customerToken: string;
  let admin: User;
  let customer: User;
  let orderA: Order; // sin programar, lejos
  let orderB: Order; // el que se programa, el más cerca
  let notifySpy: jest.SpyInstance;

  const originQuery = 'lat=40.7&lng=-74';
  const today = todayIsoDay();
  const tomorrow = shiftIsoDay(today, 1);

  const patchDate = (id: string, body: unknown, token = adminToken) =>
    request(app.getHttpServer())
      .patch(`/orders/${id}/delivery-date`)
      .set('Authorization', `Bearer ${token}`)
      .send(body as object);

  const listAsAdmin = () =>
    request(app.getHttpServer())
      .get(`/orders?${originQuery}`)
      .set('Authorization', `Bearer ${adminToken}`);

  beforeAll(async () => {
    loadEnvTest();
    app = await createTestingApp();
    dataSource = app.get(DataSource);

    // Programar avisa al cliente por push/WhatsApp; el canal no es de este spec.
    notifySpy = jest
      .spyOn(app.get(OrderNotificationsService), 'notifyScheduledDelivery')
      .mockImplementation(() => undefined);

    admin = await dataSource
      .getRepository(User)
      .save(
        makeUser({ role: UserRole.SUPER_ADMIN_DELIVERY }) as unknown as User,
      );
    customer = await dataSource
      .getRepository(User)
      .save(makeUser({ role: UserRole.CLIENT }) as unknown as User);
    adminToken = await issueTestToken(app, admin.id, UserRole.SUPER_ADMIN_DELIVERY);
    customerToken = await issueTestToken(app, customer.id, UserRole.CLIENT);

    const save = (pin: { text: string; lat: number; lng: number }) =>
      dataSource.getRepository(Order).save({
        ...makeOrder({ customerId: customer.id }),
        status: OrderStatus.CONFIRMED_BY_COLMADO,
        deliveryAddress: pin,
        scheduledDeliveryDate: null,
      } as unknown as Order);

    // B está a ~70 m del origen y A a ~35 km: sin el día, B iría primero.
    orderA = await save({ text: 'A lejos', lat: 41.0, lng: -74.0 });
    orderB = await save({ text: 'B cerca', lat: 40.7006, lng: -74.0 });
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

  it('PATCH con el día de mañana → 200 y el pedido sale como `scheduled`, después de todos los `due`', async () => {
    const patch = await patchDate(orderB.id, { scheduledDeliveryDate: tomorrow });
    expect(patch.status).toBe(200);
    expect(patch.body.scheduledDeliveryDate).toBe(tomorrow);

    const res = await listAsAdmin();
    expect(res.status).toBe(200);
    expect(res.headers['x-dispatch-origin']).toBe('device');

    const list = res.body as ListedOrder[];
    const b = list.find((o) => o.id === orderB.id)!;
    expect(b.dispatchBucket).toBe('scheduled');
    expect(b.scheduledDeliveryDate).toBe(tomorrow);
    expect(list.find((o) => o.id === orderA.id)!.dispatchBucket).toBe('due');

    // B es el más cercano pero, programado, va DESPUÉS de cada `due`.
    const posB = list.findIndex((o) => o.id === orderB.id);
    const lastDue = list.map((o) => o.dispatchBucket).lastIndexOf('due');
    expect(b.distanceMiles!).toBeLessThan(
      list.find((o) => o.id === orderA.id)!.distanceMiles!,
    );
    expect(posB).toBeGreaterThan(lastDue);
    expect(posB).toBeGreaterThan(list.findIndex((o) => o.id === orderA.id));
  });

  it('PATCH con la fecha de HOY → `due` (ya le toca a la ruta)', async () => {
    const patch = await patchDate(orderB.id, { scheduledDeliveryDate: today });
    expect(patch.status).toBe(200);

    const list = (await listAsAdmin()).body as ListedOrder[];
    expect(list.find((o) => o.id === orderB.id)!.dispatchBucket).toBe('due');
    // Ya en la ruta, vuelve a ganar por cercanía: B antes que A.
    expect(list.findIndex((o) => o.id === orderB.id)).toBeLessThan(
      list.findIndex((o) => o.id === orderA.id),
    );
  });

  it('PATCH con `null` → desasigna el día y queda `due`', async () => {
    await patchDate(orderB.id, { scheduledDeliveryDate: tomorrow });
    const patch = await patchDate(orderB.id, { scheduledDeliveryDate: null });
    expect(patch.status).toBe(200);
    expect(patch.body.scheduledDeliveryDate).toBeNull();

    const list = (await listAsAdmin()).body as ListedOrder[];
    const b = list.find((o) => o.id === orderB.id)!;
    expect(b.dispatchBucket).toBe('due');
    expect(b.scheduledDeliveryDate).toBeNull();
  });

  it('el listado completo respeta due → scheduled → history', async () => {
    await patchDate(orderB.id, { scheduledDeliveryDate: tomorrow });

    const list = (await listAsAdmin()).body as ListedOrder[];
    const rank: Record<string, number> = { due: 0, scheduled: 1, history: 2 };
    const ranks = list.map((o) => rank[o.dispatchBucket!]);
    expect(ranks.every((r) => r !== undefined)).toBe(true);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it('el cliente recibe su pedido SIN la clave `dispatchBucket` (ni `distanceMiles`)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/orders?${originQuery}`)
      .set('Authorization', `Bearer ${customerToken}`);

    expect(res.status).toBe(200);
    expect((res.body as ListedOrder[]).length).toBeGreaterThanOrEqual(2);
    for (const o of res.body as Array<Record<string, unknown>>) {
      expect(Object.keys(o)).not.toContain('dispatchBucket');
      expect(Object.keys(o)).not.toContain('distanceMiles');
    }
    // El día de reparto SÍ es del cliente: lo necesita para saber cuándo le toca.
    const b = (res.body as ListedOrder[]).find((o) => o.id === orderB.id)!;
    expect(b.scheduledDeliveryDate).toBe(tomorrow);
  });

  describe('validación de PATCH /orders/:id/delivery-date', () => {
    it.each([
      ['texto cualquiera', { scheduledDeliveryDate: 'mañana' }],
      ['fecha con hora (ISO completo)', { scheduledDeliveryDate: '2026-10-01T00:00:00Z' }],
      ['formato día/mes/año', { scheduledDeliveryDate: '01/10/2026' }],
      ['número', { scheduledDeliveryDate: 20261001 }],
      ['cadena vacía', { scheduledDeliveryDate: '' }],
      ['campo omitido (un null tiene que ser explícito)', {}],
    ])('rechaza con 400: %s', async (_label, body) => {
      const res = await patchDate(orderB.id, body);
      expect(res.status).toBe(400);
    });

    it('una fecha con formato válido pero inexistente (2026-02-30) NO es un 500', async () => {
      // El regex del DTO sólo mira la forma; si el día no existe, Postgres lo
      // rechaza al escribir. Eso tiene que ser un 400 del cliente, no un 500.
      const res = await patchDate(orderB.id, { scheduledDeliveryDate: '2026-02-30' });
      expect(res.status).toBe(400);
    });

    it('un rechazo no toca el día ya guardado', async () => {
      await patchDate(orderB.id, { scheduledDeliveryDate: tomorrow });
      await patchDate(orderB.id, { scheduledDeliveryDate: 'basura' });

      const row = await dataSource
        .getRepository(Order)
        .findOneByOrFail({ id: orderB.id });
      expect(row.scheduledDeliveryDate).toBe(tomorrow);
    });

    it('un cliente no puede programar su propia entrega → 403', async () => {
      const res = await patchDate(
        orderB.id,
        { scheduledDeliveryDate: tomorrow },
        customerToken,
      );
      expect(res.status).toBe(403);
    });

    it('un pedido entregado no se puede programar → 400', async () => {
      await dataSource
        .getRepository(Order)
        .update(orderA.id, { status: OrderStatus.DELIVERED });

      const res = await patchDate(orderA.id, { scheduledDeliveryDate: tomorrow });
      expect(res.status).toBe(400);
    });
  });
});
