/**
 * E2E spec: Admin subscription plan management
 *
 * Tests:
 * T27a/b – Auth guard tests (should fail RED until controller endpoints added):
 *   (a) PUT /admin/subscription/plan with no JWT → 401
 *   (b) PUT with CLIENT role token → 403
 *   (c) PUT with PROMOTER role token → 403
 *   (d) GET /admin/subscription/plan with no JWT → 401
 *   (e) GET with non-super-admin → 403
 *
 * T29 – Happy path:
 *   (f) PUT with super_admin_delivery token + valid body → 200 AdminPlanResponseDto
 *   (g) GET with super_admin_delivery → 200 AdminPlanResponseDto
 *
 * T31 – Validation:
 *   (h) PUT with body { unitAmountCents: 0 } → 400
 *   (i) PUT with body { unitAmountCents: 100001 } → 400
 *   (j) PUT with body { unitAmountCents: -500 } → 400
 *
 * T32 – Regression: public GET /subscription/plan still returns 200
 */

import * as path from 'path';
import * as fs from 'fs';

// Stripe must be mocked BEFORE any imports that load it.
// The service uses `import Stripe = require('stripe')` → Stripe is the module itself (a constructor function).
// The mock MUST return a function (constructor), not { default: fn }.
// mockStripeInstance holds the instance that `new Stripe()` will return.
// We declare it with var so it is accessible inside the jest.mock factory after hoisting.
// eslint-disable-next-line no-var
var mockStripeInstance: Record<string, unknown>;

jest.mock('stripe', () => {
  // Returns a constructor function that, when called with `new`, returns mockStripeInstance.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctor = jest.fn().mockImplementation(() => mockStripeInstance as any);
  return ctor;
});

// Define the mock instance AFTER jest.mock (factory is lazy — runs on first import, after this runs).
mockStripeInstance = {
  prices: {
    retrieve: jest.fn().mockResolvedValue({
      id: 'price_seed_test',
      product: 'prod_test_123',
      unit_amount: 1000,
      currency: 'usd',
      recurring: { interval: 'month' },
    }),
    create: jest.fn().mockResolvedValue({
      id: 'price_new_test',
      unit_amount: 1500,
      currency: 'usd',
      recurring: { interval: 'month' },
    }),
    update: jest.fn().mockResolvedValue({}),
  },
  products: {
    update: jest.fn().mockResolvedValue({}),
  },
  customers: {
    create: jest.fn().mockResolvedValue({ id: 'cus_plan_e2e' }),
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
  checkout: {
    sessions: {
      create: jest.fn().mockResolvedValue({ id: 'cs_plan_e2e', url: 'https://stripe.test/plan-session' }),
    },
  },
  billingPortal: {
    sessions: { create: jest.fn().mockResolvedValue({ url: 'https://stripe.test/portal' }) },
  },
  paymentIntents: { create: jest.fn(), retrieve: jest.fn(), cancel: jest.fn(), capture: jest.fn() },
  webhooks: {
    constructEvent: jest.fn((rawBody: Buffer) => JSON.parse(rawBody.toString()) as unknown),
  },
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createTestingApp } from '../../src/test-utils/testing-app';
import { makeUser } from '../../src/test-utils/fixtures';
import { User } from '../../src/entities/user.entity';
import { SubscriptionPlan } from '../../src/entities/subscription-plan.entity';
import { UserRole } from '../../src/entities/enums';
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

describe('Admin Subscription Plan E2E', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  let clientUser: User;
  let promoterUser: User;
  let superUser: User;

  let clientToken: string;
  let promoterToken: string;
  let superToken: string;

  beforeAll(async () => {
    loadEnvTest();

    // Force test DB credentials (Docker container defaults)
    process.env.DB_HOST = 'localhost';
    process.env.DB_PORT = '5433';
    process.env.DB_USER = 'zaz_test';
    process.env.DB_PASSWORD = 'zaz_test';
    process.env.DB_NAME = 'zaz_test';
    process.env.STRIPE_SUBSCRIPTION_PRICE_ID = 'price_seed_test';

    app = await createTestingApp();
    dataSource = app.get(DataSource);

    // Create test users
    clientUser = await dataSource.getRepository(User).save(
      makeUser({ role: UserRole.CLIENT }) as unknown as User,
    );
    promoterUser = await dataSource.getRepository(User).save(
      makeUser({ role: UserRole.PROMOTER }) as unknown as User,
    );
    superUser = await dataSource.getRepository(User).save(
      makeUser({ role: UserRole.SUPER_ADMIN_DELIVERY }) as unknown as User,
    );

    clientToken = await issueTestToken(app, clientUser.id, UserRole.CLIENT);
    promoterToken = await issueTestToken(app, promoterUser.id, UserRole.PROMOTER);
    superToken = await issueTestToken(app, superUser.id, UserRole.SUPER_ADMIN_DELIVERY);

    // Ensure a subscription_plan row exists with known values for happy-path tests.
    const existingPlan = await dataSource.getRepository(SubscriptionPlan).findOne({ where: {} });
    if (existingPlan) {
      existingPlan.unitAmountCents = 1000;
      existingPlan.activeStripePriceId = 'price_seed_test';
      existingPlan.stripeProductId = 'prod_test_123';
      await dataSource.getRepository(SubscriptionPlan).save(existingPlan);
    } else {
      await dataSource.getRepository(SubscriptionPlan).save({
        stripeProductId: 'prod_test_123',
        activeStripePriceId: 'price_seed_test',
        unitAmountCents: 1000,
        currency: 'usd',
        interval: 'month',
      } as unknown as SubscriptionPlan);
    }
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.getRepository(User).delete({ id: clientUser.id });
      await dataSource.getRepository(User).delete({ id: promoterUser.id });
      await dataSource.getRepository(User).delete({ id: superUser.id });
    }
    if (app) await app.close();
  });

  // ---------------------------------------------------------------------------
  // T27: Auth guard tests (RED until controller endpoints exist)
  // ---------------------------------------------------------------------------

  describe('PUT /admin/subscription/plan — auth guard', () => {
    it('(a) no JWT → 401', async () => {
      const res = await request(app.getHttpServer())
        .put('/admin/subscription/plan')
        .send({ unitAmountCents: 1500 });
      expect(res.status).toBe(401);
    });

    it('(b) CLIENT role token → 403', async () => {
      const res = await request(app.getHttpServer())
        .put('/admin/subscription/plan')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ unitAmountCents: 1500 });
      expect(res.status).toBe(403);
    });

    it('(c) PROMOTER role token → 403', async () => {
      const res = await request(app.getHttpServer())
        .put('/admin/subscription/plan')
        .set('Authorization', `Bearer ${promoterToken}`)
        .send({ unitAmountCents: 1500 });
      expect(res.status).toBe(403);
    });
  });

  describe('GET /admin/subscription/plan — auth guard', () => {
    it('(d) no JWT → 401', async () => {
      const res = await request(app.getHttpServer())
        .get('/admin/subscription/plan');
      expect(res.status).toBe(401);
    });

    it('(e) CLIENT role token → 403', async () => {
      const res = await request(app.getHttpServer())
        .get('/admin/subscription/plan')
        .set('Authorization', `Bearer ${clientToken}`);
      expect(res.status).toBe(403);
    });
  });

  // ---------------------------------------------------------------------------
  // T29: Happy path tests (RED until controller endpoints exist and return values)
  // ---------------------------------------------------------------------------

  describe('PUT /admin/subscription/plan — happy path', () => {
    it('(f) super_admin_delivery + valid body → 200 AdminPlanResponseDto', async () => {
      // Reset mock to return fresh price
      const pricesCreate = (mockStripeInstance.prices as Record<string, jest.Mock>)['create'];
      pricesCreate.mockResolvedValueOnce({
        id: 'price_new_test',
        unit_amount: 1500,
        currency: 'usd',
        recurring: { interval: 'month' },
      });

      const res = await request(app.getHttpServer())
        .put('/admin/subscription/plan')
        .set('Authorization', `Bearer ${superToken}`)
        .send({ unitAmountCents: 1500 });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        unitAmountCents: 1500,
        activeStripePriceId: 'price_new_test',
        currency: 'usd',
        interval: 'month',
      });
      expect(res.body.id).toBeDefined();
      expect(res.body.stripeProductId).toBeDefined();
      expect(res.body.updatedAt).toBeDefined();

      // Verify DB row was updated
      const dbPlan = await dataSource.getRepository(SubscriptionPlan).findOne({ where: {} });
      expect(dbPlan?.unitAmountCents).toBe(1500);
      expect(dbPlan?.activeStripePriceId).toBe('price_new_test');
    });
  });

  describe('GET /admin/subscription/plan — happy path', () => {
    it('(g) super_admin_delivery → 200 AdminPlanResponseDto', async () => {
      const res = await request(app.getHttpServer())
        .get('/admin/subscription/plan')
        .set('Authorization', `Bearer ${superToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        currency: 'usd',
        interval: 'month',
      });
      expect(res.body.id).toBeDefined();
      expect(res.body.stripeProductId).toBeDefined();
      expect(res.body.activeStripePriceId).toBeDefined();
      expect(res.body.unitAmountCents).toBeDefined();
      expect(res.body.updatedAt).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // T31: Validation tests (body validation)
  // ---------------------------------------------------------------------------

  describe('PUT /admin/subscription/plan — validation', () => {
    it('(h) unitAmountCents: 0 → 400', async () => {
      const res = await request(app.getHttpServer())
        .put('/admin/subscription/plan')
        .set('Authorization', `Bearer ${superToken}`)
        .send({ unitAmountCents: 0 });
      expect(res.status).toBe(400);
    });

    it('(i) unitAmountCents: 100001 → 400', async () => {
      const res = await request(app.getHttpServer())
        .put('/admin/subscription/plan')
        .set('Authorization', `Bearer ${superToken}`)
        .send({ unitAmountCents: 100001 });
      expect(res.status).toBe(400);
    });

    it('(j) unitAmountCents: -500 → 400', async () => {
      const res = await request(app.getHttpServer())
        .put('/admin/subscription/plan')
        .set('Authorization', `Bearer ${superToken}`)
        .send({ unitAmountCents: -500 });
      expect(res.status).toBe(400);
    });

    it('missing unitAmountCents (empty body) → 400', async () => {
      const res = await request(app.getHttpServer())
        .put('/admin/subscription/plan')
        .set('Authorization', `Bearer ${superToken}`)
        .send({});
      expect(res.status).toBe(400);
    });
  });

  // ---------------------------------------------------------------------------
  // T32: Regression — public GET /subscription/plan still works
  // ---------------------------------------------------------------------------

  describe('GET /subscription/plan — regression (public endpoint unchanged)', () => {
    it('returns 200 with priceCents, currency, interval fields', async () => {
      const res = await request(app.getHttpServer())
        .get('/subscription/plan');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('priceCents');
      expect(res.body).toHaveProperty('currency');
      expect(res.body).toHaveProperty('interval');
    });
  });

  // ---------------------------------------------------------------------------
  // T50: Partial body updates (purchasePriceCents, lateFeeCents)
  // GET response includes purchasePriceCents + lateFeeCents
  // ---------------------------------------------------------------------------

  describe('PUT /admin/subscription/plan — partial body (T50)', () => {
    it('purchasePriceCents only → 200, updates only that field', async () => {
      const res = await request(app.getHttpServer())
        .put('/admin/subscription/plan')
        .set('Authorization', `Bearer ${superToken}`)
        .send({ purchasePriceCents: 3000 });

      expect(res.status).toBe(200);
      expect(res.body.purchasePriceCents).toBe(3000);
    });

    it('lateFeeCents only → 200, updates only that field', async () => {
      const res = await request(app.getHttpServer())
        .put('/admin/subscription/plan')
        .set('Authorization', `Bearer ${superToken}`)
        .send({ lateFeeCents: 750 });

      expect(res.status).toBe(200);
      expect(res.body.lateFeeCents).toBe(750);
    });

    it('all three fields → 200, all updated', async () => {
      // Note: unitAmountCents update triggers Stripe price rotation
      const pricesCreate = (mockStripeInstance.prices as Record<string, jest.Mock>)['create'];
      pricesCreate.mockResolvedValueOnce({
        id: 'price_triple_update',
        unit_amount: 1200,
        currency: 'usd',
        recurring: { interval: 'month' },
      });

      const res = await request(app.getHttpServer())
        .put('/admin/subscription/plan')
        .set('Authorization', `Bearer ${superToken}`)
        .send({ unitAmountCents: 1200, purchasePriceCents: 5000, lateFeeCents: 600 });

      expect(res.status).toBe(200);
      expect(res.body.unitAmountCents).toBe(1200);
      expect(res.body.purchasePriceCents).toBe(5000);
      expect(res.body.lateFeeCents).toBe(600);
    });

    it('empty body → 400', async () => {
      const res = await request(app.getHttpServer())
        .put('/admin/subscription/plan')
        .set('Authorization', `Bearer ${superToken}`)
        .send({});

      expect(res.status).toBe(400);
    });
  });

  describe('GET /admin/subscription/plan — includes purchasePriceCents + lateFeeCents (T50)', () => {
    it('response includes purchasePriceCents and lateFeeCents fields', async () => {
      const res = await request(app.getHttpServer())
        .get('/admin/subscription/plan')
        .set('Authorization', `Bearer ${superToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('purchasePriceCents');
      expect(res.body).toHaveProperty('lateFeeCents');
      expect(typeof res.body.purchasePriceCents).toBe('number');
      expect(typeof res.body.lateFeeCents).toBe('number');
    });
  });
});
