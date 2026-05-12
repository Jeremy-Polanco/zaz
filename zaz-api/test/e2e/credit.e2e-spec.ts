/**
 * E2E spec: Credit admin flow
 *
 * Tests:
 * 1. Super admin grants credit to a user
 * 2. User creates order with useCredit=true → balance decremented
 * 3. Super admin reverses credit → balance restored
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
      product: 'prod_test_credit',
      unit_amount: 1000,
      currency: 'usd',
      recurring: { interval: 'month' },
    }),
    create: jest.fn().mockResolvedValue({ id: 'price_new', unit_amount: 1500, currency: 'usd', recurring: { interval: 'month' } }),
    update: jest.fn().mockResolvedValue({}),
  },
  products: {
    update: jest.fn().mockResolvedValue({}),
  },
  paymentIntents: {
    create: jest.fn().mockResolvedValue({
      id: 'pi_credit_e2e',
      client_secret: 'pi_credit_e2e_secret',
      status: 'requires_payment_method',
      amount: 0,
      currency: 'usd',
    }),
    retrieve: jest.fn(),
    cancel: jest.fn(),
    capture: jest.fn(),
  },
  customers: {
    create: jest.fn().mockResolvedValue({ id: 'cus_credit_e2e' }),
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
import { CreditAccount } from '../../src/entities/credit-account.entity';
import { CreditMovement, CreditMovementType } from '../../src/entities/credit-movement.entity';
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

describe('Credit E2E', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let clientUser: User;
  let superUser: User;
  let clientToken: string;
  let superToken: string;
  let testProduct: Product;
  let testCategory: Category;

  beforeAll(async () => {
    loadEnvTest();
    app = await createTestingApp();
    dataSource = app.get(DataSource);

    // Category + Product
    testCategory = await dataSource.getRepository(Category).save({
      name: 'Credit E2E Category',
      slug: `credit-e2e-cat-${Date.now()}`,
      emoji: '💳',
      imageUrl: null,
      isActive: true,
    } as unknown as Category);

    testProduct = await dataSource.getRepository(Product).save({
      name: 'Credit E2E Product',
      description: 'Product for credit E2E tests',
      priceToPublic: '20.00', // $20.00 — entity field is priceToPublic (column: price_to_public)
      salePrice: null,
      salePriceStart: null,
      salePriceEnd: null,
      isAvailable: true,
      stock: 100,
      imageUrl: null,
      categoryId: testCategory.id,
    } as unknown as Product);

    // Users
    clientUser = await dataSource.getRepository(User).save(
      makeUser({ role: UserRole.CLIENT }) as unknown as User,
    );
    superUser = await dataSource.getRepository(User).save(
      makeUser({ role: UserRole.SUPER_ADMIN_DELIVERY }) as unknown as User,
    );

    clientToken = await issueTestToken(app, clientUser.id, UserRole.CLIENT);
    superToken = await issueTestToken(app, superUser.id, UserRole.SUPER_ADMIN_DELIVERY);
  });

  afterAll(async () => {
    await dataSource.getRepository(CreditMovement).delete({ creditAccountId: clientUser.id });
    await dataSource.getRepository(Order).delete({ customerId: clientUser.id });
    await dataSource.getRepository(CreditAccount).delete({ userId: clientUser.id });
    await dataSource.getRepository(User).delete({ id: clientUser.id });
    await dataSource.getRepository(User).delete({ id: superUser.id });
    await dataSource.getRepository(Product).delete({ id: testProduct.id });
    await dataSource.getRepository(Category).delete({ id: testCategory.id });
    await app.close();
  });

  describe('grant → order with credit → refund flow', () => {
    const grantAmount = 1500; // $15.00 in cents

    it('POST /credit/:userId/grant sets credit balance for the user', async () => {
      const res = await request(app.getHttpServer())
        .post(`/admin/credit-accounts/${clientUser.id}/grant`)
        .set('Authorization', `Bearer ${superToken}`)
        .send({
          amountCents: grantAmount,
          note: 'E2E test grant',
        });

      expect(res.status).toBe(201);
      expect(res.body.amountCents).toBe(grantAmount);
    });

    it('GET /me/credit shows the granted balance', async () => {
      const res = await request(app.getHttpServer())
        .get('/me/credit')
        .set('Authorization', `Bearer ${clientToken}`);

      expect(res.status).toBe(200);
      // The /me/credit endpoint returns a flat object (not { account: {...} })
      expect(res.body.balanceCents).not.toBeNull();
      // Balance should be >= grantAmount (may include prior state)
      expect(res.body.balanceCents).toBeGreaterThanOrEqual(grantAmount);
    });

    let orderId: string;

    it('POST /orders with useCredit=true decrements credit balance', async () => {
      // Get current balance before order
      const creditBefore = await request(app.getHttpServer())
        .get('/me/credit')
        .set('Authorization', `Bearer ${clientToken}`);
      const balanceBefore: number = creditBefore.body.balanceCents ?? 0;

      const orderRes = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({
          items: [{ productId: testProduct.id, quantity: 1 }],
          deliveryAddress: { text: '456 Credit E2E St', lat: 18.4749, lng: -69.9312 },
          paymentMethod: PaymentMethod.CASH,
          usePoints: false,
          useCredit: true,
        });

      expect(orderRes.status).toBe(201);
      orderId = orderRes.body.id as string;

      // If credit was applied, creditApplied should be > 0
      const creditApplied = parseFloat(orderRes.body.creditApplied ?? '0');
      expect(creditApplied).toBeGreaterThan(0);

      // Balance should have decreased
      const creditAfter = await request(app.getHttpServer())
        .get('/me/credit')
        .set('Authorization', `Bearer ${clientToken}`);
      const balanceAfter: number = creditAfter.body.balanceCents ?? 0;
      expect(balanceAfter).toBeLessThan(balanceBefore);
    });

    it('PATCH /orders/:id/status CANCELLED reverses credit and restores balance', async () => {
      // Get balance before cancellation
      const creditBefore = await request(app.getHttpServer())
        .get('/me/credit')
        .set('Authorization', `Bearer ${clientToken}`);
      const balanceBefore: number = creditBefore.body.balanceCents ?? 0;

      // Cancel the order
      const cancelRes = await request(app.getHttpServer())
        .patch(`/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${superToken}`)
        .send({ status: OrderStatus.CANCELLED });

      expect(cancelRes.status).toBe(200);
      expect(cancelRes.body.status).toBe(OrderStatus.CANCELLED);

      // Credit should be restored
      const creditAfter = await request(app.getHttpServer())
        .get('/me/credit')
        .set('Authorization', `Bearer ${clientToken}`);
      const balanceAfter: number = creditAfter.body.balanceCents ?? 0;

      expect(balanceAfter).toBeGreaterThan(balanceBefore);
    });
  });
});
