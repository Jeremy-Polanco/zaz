/**
 * E2E spec: Order lifecycle
 *
 * Tests the full order journey via HTTP:
 * POST /orders → PENDING_QUOTE → QUOTED (setQuote) → PENDING_VALIDATION → DELIVERED
 *
 * Uses real NestJS app + test DB. Stripe SDK mocked at module level.
 * Auth bypassed via direct JWT signing.
 */

import * as path from 'path';
import * as fs from 'fs';

// The service uses `import Stripe = require('stripe')` → Stripe is a constructor function.
// Return jest.fn() directly (NOT { default: fn }) so `new Stripe(secret)` works.
// eslint-disable-next-line no-var
var mockStripe: Record<string, unknown>;
jest.mock('stripe', () => jest.fn().mockImplementation(() => mockStripe));

mockStripe = {
  prices: {
    // Required for onModuleInit seed flow
    retrieve: jest.fn().mockResolvedValue({
      id: 'price_test_monthly',
      product: 'prod_test_orders',
      unit_amount: 1000,
      currency: 'usd',
      recurring: { interval: 'month' },
    }),
    create: jest.fn().mockResolvedValue({ id: 'price_new_orders', unit_amount: 1500, currency: 'usd', recurring: { interval: 'month' } }),
    update: jest.fn().mockResolvedValue({}),
  },
  products: {
    update: jest.fn().mockResolvedValue({}),
  },
  paymentIntents: {
    create: jest.fn().mockResolvedValue({
      id: 'pi_e2e_test',
      client_secret: 'pi_e2e_test_secret',
      status: 'requires_payment_method',
      amount: 0,
      currency: 'usd',
    }),
    retrieve: jest.fn().mockResolvedValue({
      id: 'pi_e2e_test',
      status: 'requires_payment_method',
      client_secret: 'pi_e2e_test_secret',
      amount: 1000,
      currency: 'usd',
    }),
    cancel: jest.fn().mockResolvedValue({ id: 'pi_e2e_test', status: 'canceled' }),
    capture: jest.fn().mockResolvedValue({ id: 'pi_e2e_test', status: 'succeeded' }),
  },
  customers: {
    create: jest.fn().mockResolvedValue({ id: 'cus_e2e_test' }),
    search: jest.fn().mockResolvedValue({ data: [] }),
    update: jest.fn(),
    list: jest.fn(),
  },
  subscriptions: { create: jest.fn(), retrieve: jest.fn(), update: jest.fn(), list: jest.fn() },
  checkout: { sessions: { create: jest.fn().mockResolvedValue({ url: 'https://stripe.test/session' }) } },
  billingPortal: { sessions: { create: jest.fn().mockResolvedValue({ url: 'https://stripe.test/portal' }) } },
  webhooks: { constructEvent: jest.fn() },
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createTestingApp } from '../../src/test-utils/testing-app';
import { makeUser } from '../../src/test-utils/fixtures';
import { User } from '../../src/entities/user.entity';
import { Order } from '../../src/entities/order.entity';
import { Product } from '../../src/entities/product.entity';
import { Category } from '../../src/entities/category.entity';
import { UserRole, OrderStatus, PaymentMethod } from '../../src/entities/enums';
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

describe('Orders E2E', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let clientToken: string;
  let superToken: string;
  let clientUser: User;
  let superUser: User;
  let testProduct: Product;
  let testCategory: Category;

  beforeAll(async () => {
    loadEnvTest();
    app = await createTestingApp();
    dataSource = app.get(DataSource);

    // Create test category
    testCategory = await dataSource.getRepository(Category).save({
      name: 'E2E Test Category',
      slug: `e2e-cat-${Date.now()}`,
      emoji: '🧪',
      imageUrl: null,
      isActive: true,
    } as unknown as Category);

    // Create test product
    testProduct = await dataSource.getRepository(Product).save({
      name: 'E2E Test Product',
      description: 'Product for E2E tests',
      priceToPublic: '10.00', // entity field is priceToPublic (column: price_to_public)
      salePrice: null,
      salePriceStart: null,
      salePriceEnd: null,
      isAvailable: true,
      stock: 100,
      imageUrl: null,
      categoryId: testCategory.id,
    } as unknown as Product);

    // Create client user
    const clientData = makeUser({ role: UserRole.CLIENT });
    clientUser = await dataSource.getRepository(User).save(clientData as unknown as User);
    clientToken = await issueTestToken(app, clientUser.id, UserRole.CLIENT);

    // Create super admin user
    const superData = makeUser({ role: UserRole.SUPER_ADMIN_DELIVERY });
    superUser = await dataSource.getRepository(User).save(superData as unknown as User);
    superToken = await issueTestToken(app, superUser.id, UserRole.SUPER_ADMIN_DELIVERY);
  });

  afterAll(async () => {
    // Cleanup
    const orderRepo = dataSource.getRepository(Order);
    await orderRepo.delete({ customerId: clientUser.id });
    await dataSource.getRepository(User).delete({ id: clientUser.id });
    await dataSource.getRepository(User).delete({ id: superUser.id });
    await dataSource.getRepository(Product).delete({ id: testProduct.id });
    await dataSource.getRepository(Category).delete({ id: testCategory.id });
    await app.close();
  });

  describe('Cash order lifecycle: POST /orders → PENDING_QUOTE → QUOTED → DELIVERED', () => {
    let orderId: string;

    it('POST /orders returns 201 and order in PENDING_QUOTE status', async () => {
      const res = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({
          items: [{ productId: testProduct.id, quantity: 1 }],
          deliveryAddress: { text: '123 E2E Test Ave', lat: 18.4861, lng: -69.9312 },
          paymentMethod: PaymentMethod.CASH,
          usePoints: false,
          useCredit: false,
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe(OrderStatus.PENDING_QUOTE);
      orderId = res.body.id as string;
      expect(orderId).toBeDefined();
    });

    it('PATCH /orders/:id/quote sets shipping and moves to QUOTED', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/orders/${orderId}/quote`)
        .set('Authorization', `Bearer ${superToken}`)
        .send({ shippingCents: 200 });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe(OrderStatus.QUOTED);
    });

    it('POST /orders/:id/confirm-cash moves to PENDING_VALIDATION', async () => {
      const res = await request(app.getHttpServer())
        .post(`/orders/${orderId}/confirm-cash`)
        .set('Authorization', `Bearer ${clientToken}`);

      expect(res.status).toBe(201);
      expect(res.body.status).toBe(OrderStatus.PENDING_VALIDATION);
    });

    it('PATCH /orders/:id/status CONFIRMED_BY_COLMADO moves to confirmed', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${superToken}`)
        .send({ status: OrderStatus.CONFIRMED_BY_COLMADO });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe(OrderStatus.CONFIRMED_BY_COLMADO);
    });

    it('PATCH /orders/:id/status IN_DELIVERY_ROUTE moves to in-route', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${superToken}`)
        .send({ status: OrderStatus.IN_DELIVERY_ROUTE });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe(OrderStatus.IN_DELIVERY_ROUTE);
    });

    it('PATCH /orders/:id/status DELIVERED reaches final state', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${superToken}`)
        .send({ status: OrderStatus.DELIVERED });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe(OrderStatus.DELIVERED);
    });

    it('GET /orders/:id returns the completed order', async () => {
      const res = await request(app.getHttpServer())
        .get(`/orders/${orderId}`)
        .set('Authorization', `Bearer ${clientToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe(OrderStatus.DELIVERED);
      expect(res.body.id).toBe(orderId);
    });
  });
});
