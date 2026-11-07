/**
 * Integration spec — el checkout gasta el saldo del asociado (no puntos de
 * cliente) y deja el sobrante; el shim `/points/*` mantiene viva la app vieja.
 *
 * POR QUÉ real: el bug que se previene es que el canje "quemaba" TODO el saldo
 * aunque la orden costara menos (saldo 1000, orden de $6.00 → quedaba 0). Solo
 * una base real prueba el libro `associate_balance_entries` de punta a punta, y
 * el shim se prueba por HTTP con JWT. La base se comparte con el resto de los
 * specs: se asierta por ids de usuario/orden y se limpia todo en afterAll.
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
import { makeUser } from '../../src/test-utils/fixtures';
import { issueTestToken } from '../e2e/helpers/auth.helper';
import { OrdersService } from '../../src/modules/orders/orders.service';
import { AssociateBalanceService } from '../../src/modules/pool/associate-balance.service';
import type { AuthenticatedUser } from '../../src/common/types/authenticated-user';
import {
  AssociateBalanceEntry,
  AssociateBalanceEntryType,
  Category,
  Order,
  Product,
  User,
} from '../../src/entities';
import { PaymentMethod, UserRole } from '../../src/entities/enums';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');

describe('Checkout con saldo de asociado (integración)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let orders: OrdersService;
  let balance: AssociateBalanceService;
  let category: Category;
  let product: Product;
  const userIds: string[] = [];

  beforeAll(async () => {
    app = await createTestingApp();
    ds = app.get(DataSource);
    orders = app.get(OrdersService);
    balance = app.get(AssociateBalanceService);

    const stamp = `${process.pid}-${Date.now()}`;
    category = await ds.getRepository(Category).save(
      ds.getRepository(Category).create({
        name: `assoc-checkout-${stamp}`,
        slug: `assoc-checkout-${stamp}`,
        displayOrder: 999,
      }),
    );
    product = await ds.getRepository(Product).save(
      ds.getRepository(Product).create({
        name: `assoc-checkout-prod-${stamp}`,
        priceToPublic: '6.00',
        stock: 100,
        categoryId: category.id,
      } as Partial<Product>),
    );
  });

  afterAll(async () => {
    if (ds?.isInitialized) {
      if (userIds.length) {
        // El libro y las órdenes cuelgan del usuario (CASCADE / SET NULL según
        // la tabla): se borran explícito por usuario para no dejar huérfanos.
        await ds.query(
          'DELETE FROM associate_balance_entries WHERE user_id = ANY($1)',
          [userIds],
        );
        await ds.query(
          'DELETE FROM pool_contributions WHERE source_user_id = ANY($1)',
          [userIds],
        );
        await ds.query('DELETE FROM orders WHERE customer_id = ANY($1)', [
          userIds,
        ]);
        await ds.getRepository(User).delete(userIds);
      }
      await ds.getRepository(Product).delete(product.id);
      await ds.getRepository(Category).delete(category.id);
    }
    if (app) await app.close();
  });

  async function seedUser(role: UserRole): Promise<User> {
    const user = await ds
      .getRepository(User)
      .save(ds.getRepository(User).create(makeUser({ role }) as Partial<User>));
    userIds.push(user.id);
    return user;
  }

  async function seedAssociate(cents: number): Promise<User> {
    const user = await seedUser(UserRole.ASSOCIATE);
    // distributionId nulo está permitido: solo importa el saldo.
    await ds.getRepository(AssociateBalanceEntry).save(
      ds.getRepository(AssociateBalanceEntry).create({
        userId: user.id,
        type: AssociateBalanceEntryType.ALLOCATION,
        amountCents: cents,
        distributionId: null,
      }),
    );
    return user;
  }

  const asAuth = (user: User): AuthenticatedUser => ({
    id: user.id,
    email: null,
    role: user.role,
  });

  it('un asociado con 1000 que paga una orden de $6.00 con usePoints queda con 400', async () => {
    const assoc = await seedAssociate(1000);

    const order = await orders.create(asAuth(assoc), {
      items: [{ productId: product.id, quantity: 1 }],
      paymentMethod: PaymentMethod.CASH,
      deliveryAddress: { text: 'Assoc Checkout St', lat: 40.7, lng: -74.0 },
      usePoints: true,
    });

    expect(order.pointsRedeemed).toBe('6.00');
    expect(await balance.getBalanceCents(assoc.id)).toBe(400);

    const redemptions = await ds.getRepository(AssociateBalanceEntry).find({
      where: { userId: assoc.id, type: AssociateBalanceEntryType.REDEMPTION },
    });
    expect(redemptions).toHaveLength(1);
    expect(redemptions[0]).toMatchObject({
      amountCents: -600,
      orderId: order.id,
    });
  });

  it('un cliente con usePoints no canjea nada: no tiene saldo de asociado', async () => {
    const client = await seedUser(UserRole.CLIENT);

    const order = await orders.create(asAuth(client), {
      items: [{ productId: product.id, quantity: 1 }],
      paymentMethod: PaymentMethod.CASH,
      deliveryAddress: { text: 'Client Checkout St', lat: 40.7, lng: -74.0 },
      usePoints: true,
    });

    expect(order.pointsRedeemed).toBe('0.00');
    expect(
      await ds
        .getRepository(AssociateBalanceEntry)
        .count({ where: { userId: client.id } }),
    ).toBe(0);
  });

  describe('shim de compatibilidad /points (app móvil vieja)', () => {
    it('GET /points/balance de un cliente responde todo en 0', async () => {
      const client = await seedUser(UserRole.CLIENT);
      const token = await issueTestToken(app, client.id, UserRole.CLIENT);

      const res = await request(app.getHttpServer())
        .get('/points/balance')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body).toEqual({
        pendingCents: 0,
        claimableCents: 0,
        redeemedCents: 0,
        expiredCents: 0,
      });
    });

    it('GET /points/balance de un asociado devuelve su saldo en claimableCents', async () => {
      const assoc = await seedAssociate(400);
      const token = await issueTestToken(app, assoc.id, UserRole.ASSOCIATE);

      const res = await request(app.getHttpServer())
        .get('/points/balance')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body).toEqual({
        pendingCents: 0,
        claimableCents: 400,
        redeemedCents: 0,
        expiredCents: 0,
      });
    });

    it('GET /points/history responde 200 con []', async () => {
      const assoc = await seedAssociate(400);
      const token = await issueTestToken(app, assoc.id, UserRole.ASSOCIATE);

      const res = await request(app.getHttpServer())
        .get('/points/history')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body).toEqual([]);
    });

    it('sin token responde 401', async () => {
      await request(app.getHttpServer()).get('/points/balance').expect(401);
    });
  });
});
