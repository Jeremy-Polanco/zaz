/**
 * Integration spec — aportes al pool al entregar y reverso de canjes viejos.
 *
 * POR QUÉ real: la idempotencia por orden la garantiza un índice único parcial
 * y la anonimización de cuentas depende del ON DELETE SET NULL; ninguna de las
 * dos cosas se prueba con mocks. La base se comparte con el resto de los
 * specs (que al entregar órdenes también aportan al trimestre actual), por eso
 * se asertan DELTAS o filas filtradas por orden/usuario, nunca totales
 * absolutos del pool, y se limpia en afterAll todo lo que se commitea.
 */

// eslint-disable-next-line no-var
var mockStripe: {
  paymentIntents: { create: jest.Mock; retrieve: jest.Mock; cancel: jest.Mock; capture: jest.Mock };
  customers: { create: jest.Mock; search: jest.Mock; update: jest.Mock; list: jest.Mock };
  subscriptions: { create: jest.Mock; retrieve: jest.Mock; update: jest.Mock; list: jest.Mock };
  checkout: { sessions: { create: jest.Mock } };
  billingPortal: { sessions: { create: jest.Mock } };
  webhooks: { constructEvent: jest.Mock };
  prices: { retrieve: jest.Mock; create: jest.Mock; update: jest.Mock };
  products: { create: jest.Mock; update: jest.Mock };
};

jest.mock('stripe', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctor = jest.fn().mockImplementation(() => mockStripe as any);
  return ctor;
});

mockStripe = {
  paymentIntents: {
    create: jest.fn(),
    retrieve: jest.fn(),
    cancel: jest.fn(),
    capture: jest.fn(),
  },
  customers: { create: jest.fn(), search: jest.fn(), update: jest.fn(), list: jest.fn() },
  subscriptions: { create: jest.fn(), retrieve: jest.fn(), update: jest.fn(), list: jest.fn() },
  checkout: { sessions: { create: jest.fn() } },
  billingPortal: { sessions: { create: jest.fn() } },
  webhooks: { constructEvent: jest.fn() },
  prices: { retrieve: jest.fn(), create: jest.fn(), update: jest.fn() },
  products: { create: jest.fn(), update: jest.fn() },
};

import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createTestingApp } from '../../src/test-utils/testing-app';
import { makeOrder, makeUser } from '../../src/test-utils/fixtures';
import { OrdersService } from '../../src/modules/orders/orders.service';
import { AuthService } from '../../src/modules/auth/auth.service';
import { PoolService } from '../../src/modules/pool/pool.service';
import { AssociateBalanceService } from '../../src/modules/pool/associate-balance.service';
import { quarterOf } from '../../src/modules/pool/quarter';
import type { AuthenticatedUser } from '../../src/common/types/authenticated-user';
import {
  AssociateBalanceEntry,
  AssociateBalanceEntryType,
  Category,
  Order,
  OrderItem,
  PointsEntryStatus,
  PointsEntryType,
  PointsLedgerEntry,
  PoolContribution,
  PoolContributionSource,
  PoolDistribution,
  Product,
  User,
} from '../../src/entities';
import { OrderStatus, UserRole } from '../../src/entities/enums';

const adminAs = (): AuthenticatedUser => ({
  id: 'admin-pool-contrib',
  email: null,
  role: UserRole.SUPER_ADMIN_DELIVERY,
});

describe('Aportes al pool (integración)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let orders: OrdersService;
  let pool: PoolService;
  let balance: AssociateBalanceService;
  let auth: AuthService;
  let category: Category;
  let product: Product;
  let distribution: PoolDistribution | null = null;
  const userIds: string[] = [];
  const orderIds: string[] = [];

  beforeAll(async () => {
    app = await createTestingApp();
    ds = app.get(DataSource);
    orders = app.get(OrdersService);
    pool = app.get(PoolService);
    balance = app.get(AssociateBalanceService);
    auth = app.get(AuthService);

    const stamp = `${process.pid}-${Date.now()}`;
    category = await ds.getRepository(Category).save(
      ds.getRepository(Category).create({
        name: `pool-contrib-${stamp}`,
        slug: `pool-contrib-${stamp}`,
        displayOrder: 999,
      }),
    );
    product = await ds.getRepository(Product).save(
      ds.getRepository(Product).create({
        name: `pool-contrib-prod-${stamp}`,
        priceToPublic: '20.00',
        stock: 100,
        categoryId: category.id,
        pointsPct: '10.00',
      } as Partial<Product>),
    );
  });

  afterAll(async () => {
    if (ds?.isInitialized) {
      // Los aportes sobreviven al usuario (source_user_id SET NULL) y a la
      // orden (order_id SET NULL), así que hay que borrarlos por ambas claves
      // ANTES de borrar usuarios/órdenes o quedarían huérfanos en la base.
      if (orderIds.length) {
        await ds
          .createQueryBuilder()
          .delete()
          .from(PoolContribution)
          .where('order_id IN (:...orderIds)', { orderIds })
          .execute();
      }
      if (userIds.length) {
        await ds
          .createQueryBuilder()
          .delete()
          .from(PoolContribution)
          .where('source_user_id IN (:...userIds)', { userIds })
          .execute();
      }
      if (orderIds.length) await ds.getRepository(Order).delete(orderIds);
      if (userIds.length) {
        await ds.query(
          'DELETE FROM points_ledger_entries WHERE user_id = ANY($1)',
          [userIds],
        );
        await ds.getRepository(User).delete(userIds);
      }
      if (distribution) {
        await ds.getRepository(PoolDistribution).delete(distribution.id);
      }
      await ds.getRepository(Product).delete(product.id);
      await ds.getRepository(Category).delete(category.id);
    }
    if (app) await app.close();
  });

  async function seedUser(role: UserRole = UserRole.CLIENT): Promise<User> {
    const user = await ds
      .getRepository(User)
      .save(ds.getRepository(User).create(makeUser({ role }) as Partial<User>));
    userIds.push(user.id);
    return user;
  }

  async function seedOrder(
    customerId: string,
    status: OrderStatus,
    lines: Array<{ price: string; qty: number; productId?: string }> = [
      { price: '20.00', qty: 1 },
    ],
  ): Promise<Order> {
    const order = await ds.getRepository(Order).save(
      ds
        .getRepository(Order)
        .create(makeOrder({ customerId, status }) as Partial<Order>),
    );
    orderIds.push(order.id);
    for (const l of lines) {
      await ds.getRepository(OrderItem).save(
        ds.getRepository(OrderItem).create({
          orderId: order.id,
          productId: l.productId ?? product.id,
          quantity: l.qty,
          priceAtOrder: l.price,
        } as Partial<OrderItem>),
      );
    }
    return order;
  }

  const contributionsOf = (orderId: string) =>
    ds.getRepository(PoolContribution).find({ where: { orderId } });

  it('entregar una orden de $20 con 10% aporta 200 al trimestre y repetir no duplica', async () => {
    const user = await seedUser();
    const order = await seedOrder(user.id, OrderStatus.IN_DELIVERY_ROUTE);
    const quarter = quarterOf(new Date());
    const before = await pool.getPoolCents(quarter);

    await orders.updateStatus(
      order.id,
      { status: OrderStatus.DELIVERED },
      adminAs(),
    );

    expect(await pool.getPoolCents(quarter)).toBe(before + 200);
    const rows = await contributionsOf(order.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source: PoolContributionSource.ORDER,
      amountCents: 200,
      sourceUserId: user.id,
      quarter,
    });

    // El cliente ya no recibe puntos propios por esta orden.
    expect(
      await ds
        .getRepository(PointsLedgerEntry)
        .count({ where: { userId: user.id } }),
    ).toBe(0);

    const again = await ds.transaction((tx) =>
      pool.contributeForOrder(order.id, tx),
    );
    expect(again).toBe(0);
    expect(await contributionsOf(order.id)).toHaveLength(1);
    expect(await pool.getPoolCents(quarter)).toBe(before + 200);
  });

  it('suma las líneas en UNA fila con el redondeo de hoy (por línea)', async () => {
    const user = await seedUser();
    // 3 x $1.05 con 10% = 315 * 0.10 = 31.5 -> 32; 1 x $0.33 con 10% = 3.3 -> 3
    const order = await seedOrder(user.id, OrderStatus.DELIVERED, [
      { price: '1.05', qty: 3 },
      { price: '0.33', qty: 1 },
    ]);

    const total = await ds.transaction((tx) =>
      pool.contributeForOrder(order.id, tx),
    );

    expect(total).toBe(35);
    const rows = await contributionsOf(order.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].amountCents).toBe(35);
  });

  it('una orden sin puntos (total 0) no inserta nada', async () => {
    const user = await seedUser();
    const noPoints = await ds.getRepository(Product).save(
      ds.getRepository(Product).create({
        name: `pool-contrib-nopts-${process.pid}-${Date.now()}`,
        priceToPublic: '20.00',
        stock: 100,
        categoryId: category.id,
        pointsPct: '0',
      } as Partial<Product>),
    );
    try {
      const order = await seedOrder(user.id, OrderStatus.DELIVERED, [
        { price: '20.00', qty: 1, productId: noPoints.id },
      ]);
      const total = await ds.transaction((tx) =>
        pool.contributeForOrder(order.id, tx),
      );
      expect(total).toBe(0);
      expect(await contributionsOf(order.id)).toHaveLength(0);
    } finally {
      await ds
        .createQueryBuilder()
        .delete()
        .from(OrderItem)
        .where('product_id = :id', { id: noPoints.id })
        .execute();
      await ds.getRepository(Product).delete(noPoints.id);
    }
  });

  it('el trimestre se mide en hora de NY: 23:59 del 31-dic va a Q4 y 00:01 del 1-ene a Q1', async () => {
    const user = await seedUser();
    const before = await seedOrder(user.id, OrderStatus.DELIVERED);
    const after = await seedOrder(user.id, OrderStatus.DELIVERED);

    await ds.transaction((tx) =>
      pool.contributeForOrder(
        before.id,
        tx,
        new Date('2027-01-01T04:59:00Z'),
      ),
    );
    await ds.transaction((tx) =>
      pool.contributeForOrder(after.id, tx, new Date('2027-01-01T05:01:00Z')),
    );

    expect((await contributionsOf(before.id))[0].quarter).toBe('2026-Q4');
    expect((await contributionsOf(after.id))[0].quarter).toBe('2027-Q1');
  });

  it('borrar al cliente deja el aporte intacto con source_user_id null', async () => {
    const user = await seedUser();
    const order = await seedOrder(user.id, OrderStatus.IN_DELIVERY_ROUTE);
    await orders.updateStatus(
      order.id,
      { status: OrderStatus.DELIVERED },
      adminAs(),
    );
    const quarter = quarterOf(new Date());
    const poolBefore = await pool.getPoolCents(quarter);

    await auth.deleteAccount(user.id);

    const rows = await contributionsOf(order.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].amountCents).toBe(200);
    expect(rows[0].sourceUserId).toBeNull();
    expect(await pool.getPoolCents(quarter)).toBe(poolBefore);
  });

  it('cancelar un pedido viejo que canjeó 250 en puntos los manda al pool como legacy_reversal', async () => {
    const user = await seedUser();
    const order = await seedOrder(user.id, OrderStatus.PENDING_QUOTE);
    const ledger = ds.getRepository(PointsLedgerEntry);
    // Fixtures del canje viejo: dos EARNED ya canjeadas por esta orden (150 +
    // 100) y la entrada negativa que registró el canje.
    for (const amountCents of [150, 100]) {
      await ledger.save(
        ledger.create({
          userId: user.id,
          type: PointsEntryType.EARNED,
          status: PointsEntryStatus.REDEEMED,
          amountCents,
          orderId: order.id,
        }),
      );
    }
    await ledger.save(
      ledger.create({
        userId: user.id,
        type: PointsEntryType.REDEEMED,
        status: PointsEntryStatus.REDEEMED,
        amountCents: -250,
        orderId: order.id,
      }),
    );
    const quarter = quarterOf(new Date());
    const before = await pool.getPoolCents(quarter);

    await orders.updateStatus(
      order.id,
      { status: OrderStatus.CANCELLED },
      adminAs(),
    );

    const entries = await ledger.find({ where: { userId: user.id } });
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.status === PointsEntryStatus.POOLED)).toBe(
      true,
    );
    expect(entries.every((e) => e.type === PointsEntryType.EARNED)).toBe(true);

    const rows = await ds
      .getRepository(PoolContribution)
      .find({ where: { sourceUserId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source: PoolContributionSource.LEGACY_REVERSAL,
      amountCents: 250,
      quarter,
    });
    expect(await pool.getPoolCents(quarter)).toBe(before + 250);

    // Idempotente: reintentar no vuelve a aportar.
    const second = await ds.transaction((tx) =>
      pool.reverseLegacyRedemption(order.id, tx),
    );
    expect(second).toBe(0);
    expect(await pool.getPoolCents(quarter)).toBe(before + 250);
  });

  it('un pedido de asociado que usó saldo, al cancelarse, devuelve el saldo', async () => {
    const assoc = await seedUser(UserRole.ASSOCIATE);
    const order = await seedOrder(assoc.id, OrderStatus.PENDING_QUOTE);
    // Trimestre de los 1980: no choca con repartos reales ni de otros specs.
    distribution = await ds.getRepository(PoolDistribution).save(
      ds.getRepository(PoolDistribution).create({
        quarter: '1980-Q1',
        totalCents: 1000,
        associateCount: 1,
        shareCents: 1000,
        remainderCents: 0,
      }),
    );
    await ds.getRepository(AssociateBalanceEntry).save(
      ds.getRepository(AssociateBalanceEntry).create({
        userId: assoc.id,
        type: AssociateBalanceEntryType.ALLOCATION,
        amountCents: 1000,
        distributionId: distribution.id,
      }),
    );
    // `create` todavía no canjea saldo de asociado (llega en una tarea
    // posterior), así que el canje se siembra directo sobre la orden.
    await ds.transaction((tx) => balance.redeem(assoc.id, order.id, 400, tx));
    expect(await balance.getBalanceCents(assoc.id)).toBe(600);

    await orders.updateStatus(
      order.id,
      { status: OrderStatus.CANCELLED },
      adminAs(),
    );

    expect(await balance.getBalanceCents(assoc.id)).toBe(1000);
  });
});
