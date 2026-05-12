/**
 * E2E spec: Admin rental/purchase management endpoints
 *
 * Tests all 5 new admin-only endpoints:
 *   POST /admin/users/:userId/subscription/activate-rental
 *   POST /admin/users/:userId/subscription/activate-purchase
 *   POST /admin/subscriptions/:id/charge-late-fee
 *   POST /admin/subscriptions/:id/cancel
 *   GET  /admin/subscription/delinquent
 *
 * TDD T47 — RED (written before AdminRentalController exists)
 */

import * as path from 'path';
import * as fs from 'fs';

// Stripe must be mocked BEFORE any imports that load it.
// eslint-disable-next-line no-var
var mockStripeInstance: Record<string, unknown>;

jest.mock('stripe', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctor = jest.fn().mockImplementation(() => mockStripeInstance as any);
  return ctor;
});

const NOW_UNIX = Math.floor(Date.now() / 1000);
const FUTURE_UNIX = NOW_UNIX + 86400 * 30;

mockStripeInstance = {
  prices: {
    retrieve: jest.fn().mockResolvedValue({
      id: 'price_rental_e2e',
      product: 'prod_rental_e2e',
      unit_amount: 1000,
      currency: 'usd',
      recurring: { interval: 'month' },
    }),
    create: jest.fn().mockResolvedValue({
      id: 'price_rental_new',
      unit_amount: 1000,
      currency: 'usd',
      recurring: { interval: 'month' },
    }),
    update: jest.fn().mockResolvedValue({}),
  },
  products: { update: jest.fn().mockResolvedValue({}) },
  customers: {
    create: jest.fn().mockResolvedValue({ id: 'cus_rental_e2e' }),
    search: jest.fn().mockResolvedValue({ data: [] }),
    update: jest.fn(),
    list: jest.fn(),
  },
  subscriptions: {
    create: jest.fn().mockResolvedValue({
      id: 'sub_rental_e2e_1',
      status: 'active',
      current_period_start: NOW_UNIX - 86400,
      current_period_end: FUTURE_UNIX,
      cancel_at_period_end: false,
      canceled_at: null,
      metadata: { userId: '' }, // filled per test
    }),
    retrieve: jest.fn().mockResolvedValue({
      id: 'sub_rental_e2e_1',
      status: 'active',
      current_period_start: NOW_UNIX - 86400,
      current_period_end: FUTURE_UNIX,
      cancel_at_period_end: false,
      canceled_at: null,
      metadata: { userId: '' },
    }),
    update: jest.fn().mockResolvedValue({}),
    list: jest.fn().mockResolvedValue({ data: [] }),
    cancel: jest.fn().mockResolvedValue({
      id: 'sub_rental_e2e_1',
      status: 'canceled',
      current_period_start: NOW_UNIX - 86400,
      current_period_end: FUTURE_UNIX,
      cancel_at_period_end: false,
      canceled_at: NOW_UNIX,
      metadata: { userId: '' },
    }),
  },
  paymentIntents: {
    create: jest.fn().mockResolvedValue({
      id: 'pi_purchase_e2e_1',
      status: 'succeeded',
      amount: 4500,
      currency: 'usd',
    }),
    retrieve: jest.fn().mockResolvedValue({ id: 'pi_purchase_e2e_1', status: 'succeeded' }),
    cancel: jest.fn(),
    capture: jest.fn(),
  },
  checkout: {
    sessions: { create: jest.fn().mockResolvedValue({ id: 'cs_rental_e2e', url: 'https://stripe.test' }) },
  },
  billingPortal: {
    sessions: { create: jest.fn().mockResolvedValue({ url: 'https://stripe.test/portal' }) },
  },
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
import { Subscription, SubscriptionModel, SubscriptionStatus } from '../../src/entities/subscription.entity';
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

describe('Admin Rental E2E', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  let clientUser: User;
  let superUser: User;
  let targetUser: User; // user to activate rental/purchase for

  let clientToken: string;
  let superToken: string;

  let planId: string;

  beforeAll(async () => {
    loadEnvTest();

    process.env.DB_HOST = 'localhost';
    process.env.DB_PORT = '5433';
    process.env.DB_USER = 'zaz_test';
    process.env.DB_PASSWORD = 'zaz_test';
    process.env.DB_NAME = 'zaz_test';
    process.env.STRIPE_SUBSCRIPTION_PRICE_ID = 'price_rental_e2e';

    app = await createTestingApp();
    dataSource = app.get(DataSource);

    clientUser = await dataSource.getRepository(User).save(
      makeUser({ role: UserRole.CLIENT }) as unknown as User,
    );
    superUser = await dataSource.getRepository(User).save(
      makeUser({ role: UserRole.SUPER_ADMIN_DELIVERY }) as unknown as User,
    );
    targetUser = await dataSource.getRepository(User).save(
      makeUser({ role: UserRole.CLIENT, stripeCustomerId: 'cus_rental_e2e' }) as unknown as User,
    );

    clientToken = await issueTestToken(app, clientUser.id, UserRole.CLIENT);
    superToken = await issueTestToken(app, superUser.id, UserRole.SUPER_ADMIN_DELIVERY);

    // Ensure subscription plan exists with purchase price and late fee configured
    const planRepo = dataSource.getRepository(SubscriptionPlan);
    let plan = await planRepo.findOne({ where: {} });
    if (plan) {
      plan.unitAmountCents = 1000;
      plan.purchasePriceCents = 4500;
      plan.lateFeeCents = 500;
      plan.activeStripePriceId = 'price_rental_e2e';
      plan.stripeProductId = 'prod_rental_e2e';
      plan = await planRepo.save(plan);
    } else {
      plan = await planRepo.save({
        stripeProductId: 'prod_rental_e2e',
        activeStripePriceId: 'price_rental_e2e',
        unitAmountCents: 1000,
        purchasePriceCents: 4500,
        lateFeeCents: 500,
        currency: 'usd',
        interval: 'month',
      } as unknown as SubscriptionPlan);
    }
    planId = plan.id;
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.getRepository(Subscription).delete({ userId: targetUser.id });
      await dataSource.getRepository(User).delete({ id: clientUser.id });
      await dataSource.getRepository(User).delete({ id: superUser.id });
      await dataSource.getRepository(User).delete({ id: targetUser.id });
    }
    if (app) await app.close();
  });

  // Helper to clean up subscriptions for targetUser between tests
  async function cleanupTargetUserSubscription(): Promise<void> {
    await dataSource.getRepository(Subscription).delete({ userId: targetUser.id });
    // Reset Stripe mock call counts
    (mockStripeInstance.subscriptions as Record<string, jest.Mock>)['create'].mockClear();
    (mockStripeInstance.subscriptions as Record<string, jest.Mock>)['cancel'].mockClear();
    (mockStripeInstance.paymentIntents as Record<string, jest.Mock>)['create'].mockClear();
  }

  // ---------------------------------------------------------------------------
  // Auth/Role guards (all 5 endpoints)
  // ---------------------------------------------------------------------------

  describe('POST /admin/users/:userId/subscription/activate-rental — auth guards', () => {
    it('no JWT → 401', async () => {
      const res = await request(app.getHttpServer())
        .post(`/admin/users/${targetUser.id}/subscription/activate-rental`);
      expect(res.status).toBe(401);
    });

    it('CLIENT role → 403', async () => {
      const res = await request(app.getHttpServer())
        .post(`/admin/users/${targetUser.id}/subscription/activate-rental`)
        .set('Authorization', `Bearer ${clientToken}`);
      expect(res.status).toBe(403);
    });
  });

  describe('POST /admin/users/:userId/subscription/activate-purchase — auth guards', () => {
    it('no JWT → 401', async () => {
      const res = await request(app.getHttpServer())
        .post(`/admin/users/${targetUser.id}/subscription/activate-purchase`);
      expect(res.status).toBe(401);
    });

    it('CLIENT role → 403', async () => {
      const res = await request(app.getHttpServer())
        .post(`/admin/users/${targetUser.id}/subscription/activate-purchase`)
        .set('Authorization', `Bearer ${clientToken}`);
      expect(res.status).toBe(403);
    });
  });

  describe('POST /admin/subscriptions/:id/charge-late-fee — auth guards', () => {
    it('no JWT → 401', async () => {
      const res = await request(app.getHttpServer())
        .post('/admin/subscriptions/some-id/charge-late-fee')
        .send({ alsoCancel: false });
      expect(res.status).toBe(401);
    });

    it('CLIENT role → 403', async () => {
      const res = await request(app.getHttpServer())
        .post('/admin/subscriptions/some-id/charge-late-fee')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ alsoCancel: false });
      expect(res.status).toBe(403);
    });
  });

  describe('POST /admin/subscriptions/:id/cancel — auth guards', () => {
    it('no JWT → 401', async () => {
      const res = await request(app.getHttpServer())
        .post('/admin/subscriptions/some-id/cancel');
      expect(res.status).toBe(401);
    });

    it('CLIENT role → 403', async () => {
      const res = await request(app.getHttpServer())
        .post('/admin/subscriptions/some-id/cancel')
        .set('Authorization', `Bearer ${clientToken}`);
      expect(res.status).toBe(403);
    });
  });

  describe('GET /admin/subscription/delinquent — auth guards', () => {
    it('no JWT → 401', async () => {
      const res = await request(app.getHttpServer())
        .get('/admin/subscription/delinquent');
      expect(res.status).toBe(401);
    });

    it('CLIENT role → 403', async () => {
      const res = await request(app.getHttpServer())
        .get('/admin/subscription/delinquent')
        .set('Authorization', `Bearer ${clientToken}`);
      expect(res.status).toBe(403);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /admin/subscription/delinquent — happy path + shape
  // ---------------------------------------------------------------------------

  describe('GET /admin/subscription/delinquent', () => {
    it('returns 200 with array (empty when no delinquent subs)', async () => {
      const res = await request(app.getHttpServer())
        .get('/admin/subscription/delinquent')
        .set('Authorization', `Bearer ${superToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('returns correct shape for delinquent rental subscription', async () => {
      // Seed a past_due rental subscription with period_end in the past
      const pastEnd = new Date(Date.now() - 5 * 24 * 3600 * 1000); // 5 days ago
      await dataSource.getRepository(Subscription).save({
        userId: targetUser.id,
        stripeSubscriptionId: `sub_delinquent_e2e_${Date.now()}`,
        model: SubscriptionModel.RENTAL,
        status: SubscriptionStatus.PAST_DUE,
        currentPeriodStart: new Date(pastEnd.getTime() - 30 * 24 * 3600 * 1000),
        currentPeriodEnd: pastEnd,
        cancelAtPeriodEnd: false,
        canceledAt: null,
        stripeChargeId: null,
        purchasedAt: null,
      } as unknown as Subscription);

      const res = await request(app.getHttpServer())
        .get('/admin/subscription/delinquent')
        .set('Authorization', `Bearer ${superToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);

      const matchingEntry = (res.body as Record<string, unknown>[]).find(
        (entry) => entry['userId'] === targetUser.id,
      );
      expect(matchingEntry).toBeDefined();
      expect(matchingEntry).toMatchObject({
        userId: targetUser.id,
        status: 'past_due',
        daysDelinquent: expect.any(Number),
        unitAmountCents: expect.any(Number),
      });
      expect((matchingEntry as Record<string, unknown>)['daysDelinquent']).toBeGreaterThanOrEqual(4);

      // Cleanup
      await cleanupTargetUserSubscription();
    });
  });

  // ---------------------------------------------------------------------------
  // POST activate-rental — happy path
  // ---------------------------------------------------------------------------

  describe('POST /admin/users/:userId/subscription/activate-rental', () => {
    afterEach(async () => {
      await cleanupTargetUserSubscription();
    });

    it('happy path → 201 SubscriptionResponseDto (Stripe subscriptions.create called)', async () => {
      // Reset mock to provide correct userId in metadata
      const subCreate = (mockStripeInstance.subscriptions as Record<string, jest.Mock>)['create'];
      subCreate.mockResolvedValueOnce({
        id: `sub_rental_e2e_hp_${Date.now()}`,
        status: 'active',
        current_period_start: NOW_UNIX - 3600,
        current_period_end: FUTURE_UNIX,
        cancel_at_period_end: false,
        canceled_at: null,
        metadata: { userId: targetUser.id },
      });

      const res = await request(app.getHttpServer())
        .post(`/admin/users/${targetUser.id}/subscription/activate-rental`)
        .set('Authorization', `Bearer ${superToken}`);

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        status: 'active',
      });
      expect(subCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          customer: 'cus_rental_e2e',
          items: expect.arrayContaining([
            expect.objectContaining({ price: 'price_rental_e2e' }),
          ]),
        }),
        expect.anything(),
      );
    });

    it('user not found → 404', async () => {
      const res = await request(app.getHttpServer())
        .post('/admin/users/00000000-0000-0000-0000-000000000099/subscription/activate-rental')
        .set('Authorization', `Bearer ${superToken}`);
      expect(res.status).toBe(404);
    });

    it('user has no stripeCustomerId → 400 NO_PAYMENT_METHOD', async () => {
      // Create a user without stripeCustomerId
      const noPayUser = await dataSource.getRepository(User).save(
        makeUser({ role: UserRole.CLIENT, stripeCustomerId: null }) as unknown as User,
      );
      try {
        const res = await request(app.getHttpServer())
          .post(`/admin/users/${noPayUser.id}/subscription/activate-rental`)
          .set('Authorization', `Bearer ${superToken}`);
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('NO_PAYMENT_METHOD');
      } finally {
        await dataSource.getRepository(User).delete({ id: noPayUser.id });
      }
    });

    it('user already has active subscription → 409 ALREADY_ACTIVE', async () => {
      // Seed an active subscription
      await dataSource.getRepository(Subscription).save({
        userId: targetUser.id,
        stripeSubscriptionId: `sub_already_active_${Date.now()}`,
        model: SubscriptionModel.RENTAL,
        status: SubscriptionStatus.ACTIVE,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000),
        cancelAtPeriodEnd: false,
        canceledAt: null,
        stripeChargeId: null,
        purchasedAt: null,
      } as unknown as Subscription);

      const res = await request(app.getHttpServer())
        .post(`/admin/users/${targetUser.id}/subscription/activate-rental`)
        .set('Authorization', `Bearer ${superToken}`);
      expect(res.status).toBe(409);
    });
  });

  // ---------------------------------------------------------------------------
  // POST activate-purchase — happy path + error paths
  // ---------------------------------------------------------------------------

  describe('POST /admin/users/:userId/subscription/activate-purchase', () => {
    afterEach(async () => {
      await cleanupTargetUserSubscription();
    });

    it('happy path → 201 SubscriptionResponseDto (PI create called)', async () => {
      const piCreate = (mockStripeInstance.paymentIntents as Record<string, jest.Mock>)['create'];
      piCreate.mockResolvedValueOnce({
        id: `pi_purchase_e2e_hp_${Date.now()}`,
        status: 'succeeded',
        amount: 4500,
        currency: 'usd',
      });

      const res = await request(app.getHttpServer())
        .post(`/admin/users/${targetUser.id}/subscription/activate-purchase`)
        .set('Authorization', `Bearer ${superToken}`);

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ status: 'active' });
      expect(piCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          customer: 'cus_rental_e2e',
          amount: 4500,
          currency: 'usd',
          off_session: true,
          confirm: true,
        }),
        expect.objectContaining({ idempotencyKey: expect.any(String) }),
      );
    });

    it('purchasePriceCents=0 → 503 PURCHASE_PRICE_NOT_CONFIGURED', async () => {
      // Temporarily set purchasePriceCents to 0
      const planRepo = dataSource.getRepository(SubscriptionPlan);
      const plan = await planRepo.findOne({ where: {} });
      if (plan) {
        plan.purchasePriceCents = 0;
        await planRepo.save(plan);
      }

      try {
        const res = await request(app.getHttpServer())
          .post(`/admin/users/${targetUser.id}/subscription/activate-purchase`)
          .set('Authorization', `Bearer ${superToken}`);
        expect(res.status).toBe(503);
        expect(res.body.code).toContain('PURCHASE_PRICE_NOT_CONFIGURED');
      } finally {
        // Restore
        if (plan) {
          plan.purchasePriceCents = 4500;
          await planRepo.save(plan);
        }
      }
    });

    it('user already has active subscription → 409', async () => {
      await dataSource.getRepository(Subscription).save({
        userId: targetUser.id,
        stripeSubscriptionId: `sub_already_active_purchase_${Date.now()}`,
        model: SubscriptionModel.RENTAL,
        status: SubscriptionStatus.ACTIVE,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000),
        cancelAtPeriodEnd: false,
        canceledAt: null,
        stripeChargeId: null,
        purchasedAt: null,
      } as unknown as Subscription);

      const res = await request(app.getHttpServer())
        .post(`/admin/users/${targetUser.id}/subscription/activate-purchase`)
        .set('Authorization', `Bearer ${superToken}`);
      expect(res.status).toBe(409);
    });
  });

  // ---------------------------------------------------------------------------
  // POST charge-late-fee — happy path + error paths
  // ---------------------------------------------------------------------------

  describe('POST /admin/subscriptions/:id/charge-late-fee', () => {
    let rentalSubId: string;

    beforeEach(async () => {
      // Seed an active rental sub for these tests
      const sub = await dataSource.getRepository(Subscription).save({
        userId: targetUser.id,
        stripeSubscriptionId: `sub_latefee_e2e_${Date.now()}`,
        model: SubscriptionModel.RENTAL,
        status: SubscriptionStatus.PAST_DUE,
        currentPeriodStart: new Date(Date.now() - 35 * 24 * 3600 * 1000),
        currentPeriodEnd: new Date(Date.now() - 5 * 24 * 3600 * 1000),
        cancelAtPeriodEnd: false,
        canceledAt: null,
        stripeChargeId: null,
        purchasedAt: null,
      } as unknown as Subscription);
      rentalSubId = sub.id;
    });

    afterEach(async () => {
      await dataSource.getRepository(Subscription).delete({ id: rentalSubId });
    });

    it('happy path alsoCancel=false → 200 ChargeLateFeeResponseDto, sub NOT canceled', async () => {
      const piCreate = (mockStripeInstance.paymentIntents as Record<string, jest.Mock>)['create'];
      piCreate.mockResolvedValueOnce({
        id: 'pi_latefee_e2e_1',
        status: 'succeeded',
        amount: 500,
        currency: 'usd',
      });

      const res = await request(app.getHttpServer())
        .post(`/admin/subscriptions/${rentalSubId}/charge-late-fee`)
        .set('Authorization', `Bearer ${superToken}`)
        .send({ alsoCancel: false });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        chargedCents: 500,
        paymentIntentId: 'pi_latefee_e2e_1',
        subscriptionCanceled: false,
      });

      // Verify sub is still in DB and NOT canceled
      const sub = await dataSource.getRepository(Subscription).findOne({ where: { id: rentalSubId } });
      expect(sub?.status).not.toBe(SubscriptionStatus.CANCELED);
    });

    it('alsoCancel=true → 200, subscriptionCanceled=true, sub status=canceled', async () => {
      const piCreate = (mockStripeInstance.paymentIntents as Record<string, jest.Mock>)['create'];
      piCreate.mockResolvedValueOnce({
        id: 'pi_latefee_e2e_2',
        status: 'succeeded',
        amount: 500,
        currency: 'usd',
      });

      const res = await request(app.getHttpServer())
        .post(`/admin/subscriptions/${rentalSubId}/charge-late-fee`)
        .set('Authorization', `Bearer ${superToken}`)
        .send({ alsoCancel: true });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        subscriptionCanceled: true,
      });
    });

    it('purchase-model subscription → 400 NOT_A_RENTAL', async () => {
      // Create a purchase subscription
      const purchaseSub = await dataSource.getRepository(Subscription).save({
        userId: superUser.id, // use a different user to avoid unique constraint
        stripeSubscriptionId: `purchase_latefee_test_${Date.now()}`,
        model: SubscriptionModel.PURCHASE,
        status: SubscriptionStatus.ACTIVE,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date('9999-12-31'),
        cancelAtPeriodEnd: false,
        canceledAt: null,
        stripeChargeId: 'pi_latefee_purchase_test',
        purchasedAt: new Date(),
      } as unknown as Subscription);

      try {
        const res = await request(app.getHttpServer())
          .post(`/admin/subscriptions/${purchaseSub.id}/charge-late-fee`)
          .set('Authorization', `Bearer ${superToken}`)
          .send({ alsoCancel: false });
        expect(res.status).toBe(400);
        expect(res.body.code).toContain('NOT_A_RENTAL');
      } finally {
        await dataSource.getRepository(Subscription).delete({ id: purchaseSub.id });
      }
    });

    it('lateFeeCents=0 → 503 LATE_FEE_NOT_CONFIGURED', async () => {
      const planRepo = dataSource.getRepository(SubscriptionPlan);
      const plan = await planRepo.findOne({ where: {} });
      if (plan) {
        plan.lateFeeCents = 0;
        await planRepo.save(plan);
      }

      try {
        const res = await request(app.getHttpServer())
          .post(`/admin/subscriptions/${rentalSubId}/charge-late-fee`)
          .set('Authorization', `Bearer ${superToken}`)
          .send({ alsoCancel: false });
        expect(res.status).toBe(503);
        expect(res.body.code).toContain('LATE_FEE_NOT_CONFIGURED');
      } finally {
        if (plan) {
          plan.lateFeeCents = 500;
          await planRepo.save(plan);
        }
      }
    });
  });

  // ---------------------------------------------------------------------------
  // POST cancel — happy path + error paths
  // ---------------------------------------------------------------------------

  describe('POST /admin/subscriptions/:id/cancel', () => {
    let rentalSubId: string;

    beforeEach(async () => {
      const sub = await dataSource.getRepository(Subscription).save({
        userId: targetUser.id,
        stripeSubscriptionId: `sub_cancel_e2e_${Date.now()}`,
        model: SubscriptionModel.RENTAL,
        status: SubscriptionStatus.ACTIVE,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000),
        cancelAtPeriodEnd: false,
        canceledAt: null,
        stripeChargeId: null,
        purchasedAt: null,
      } as unknown as Subscription);
      rentalSubId = sub.id;
    });

    afterEach(async () => {
      await dataSource.getRepository(Subscription).delete({ id: rentalSubId });
    });

    it('happy path → 200, sub status=canceled', async () => {
      const subCancel = (mockStripeInstance.subscriptions as Record<string, jest.Mock>)['cancel'];
      subCancel.mockResolvedValueOnce({
        id: 'sub_cancel_e2e_1',
        status: 'canceled',
        current_period_start: NOW_UNIX - 86400,
        current_period_end: FUTURE_UNIX,
        cancel_at_period_end: false,
        canceled_at: NOW_UNIX,
        metadata: { userId: targetUser.id },
      });

      const res = await request(app.getHttpServer())
        .post(`/admin/subscriptions/${rentalSubId}/cancel`)
        .set('Authorization', `Bearer ${superToken}`);

      expect(res.status).toBe(200);

      const sub = await dataSource.getRepository(Subscription).findOne({ where: { id: rentalSubId } });
      expect(sub?.status).toBe(SubscriptionStatus.CANCELED);
      expect(sub?.canceledAt).toBeDefined();
    });

    it('already-canceled sub → 200 idempotent, Stripe NOT called', async () => {
      // Set the sub to canceled first
      await dataSource.getRepository(Subscription).update(rentalSubId, {
        status: SubscriptionStatus.CANCELED,
        canceledAt: new Date(),
      });

      const subCancel = (mockStripeInstance.subscriptions as Record<string, jest.Mock>)['cancel'];
      subCancel.mockClear();

      const res = await request(app.getHttpServer())
        .post(`/admin/subscriptions/${rentalSubId}/cancel`)
        .set('Authorization', `Bearer ${superToken}`);

      expect(res.status).toBe(200);
      expect(subCancel).not.toHaveBeenCalled();
    });

    it('purchase-model subscription → 400 NOT_A_RENTAL', async () => {
      const purchaseSub = await dataSource.getRepository(Subscription).save({
        userId: superUser.id,
        stripeSubscriptionId: `purchase_cancel_test_${Date.now()}`,
        model: SubscriptionModel.PURCHASE,
        status: SubscriptionStatus.ACTIVE,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date('9999-12-31'),
        cancelAtPeriodEnd: false,
        canceledAt: null,
        stripeChargeId: 'pi_cancel_purchase_test',
        purchasedAt: new Date(),
      } as unknown as Subscription);

      try {
        const res = await request(app.getHttpServer())
          .post(`/admin/subscriptions/${purchaseSub.id}/cancel`)
          .set('Authorization', `Bearer ${superToken}`);
        expect(res.status).toBe(400);
        expect(res.body.code).toContain('NOT_A_RENTAL');
      } finally {
        await dataSource.getRepository(Subscription).delete({ id: purchaseSub.id });
      }
    });
  });
});
