/**
 * Integration specs for SubscriptionService.
 *
 * Tests:
 * 1. Webhook double-fire creates exactly one DB row (upsert idempotency).
 * 2. period_end fallback to items[0] is stored correctly.
 */

import * as path from 'path';
import * as fs from 'fs';

// Stripe module mock
// MUST use var (hoisted) and return the constructor directly (not { default: fn })
// because the service uses `import Stripe = require('stripe')` (CJS interop).
// eslint-disable-next-line no-var
var mockStripe: {
  customers: { create: jest.Mock; search: jest.Mock; update: jest.Mock; list: jest.Mock };
  subscriptions: { retrieve: jest.Mock; create: jest.Mock; update: jest.Mock; list: jest.Mock; cancel: jest.Mock };
  checkout: { sessions: { create: jest.Mock } };
  billingPortal: { sessions: { create: jest.Mock } };
  paymentIntents: { create: jest.Mock; retrieve: jest.Mock; cancel: jest.Mock; capture: jest.Mock };
  webhooks: { constructEvent: jest.Mock };
  prices: { retrieve: jest.Mock; create: jest.Mock; update: jest.Mock };
  products: { update: jest.Mock };
};

jest.mock('stripe', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctor = jest.fn().mockImplementation(() => mockStripe as any);
  return ctor;
});

const NOW_UNIX = Math.floor(Date.now() / 1000);
const FUTURE_UNIX = NOW_UNIX + 86400 * 30;

mockStripe = {
  customers: {
    create: jest.fn().mockResolvedValue({ id: 'cus_test' }),
    search: jest.fn().mockResolvedValue({ data: [] }),
    update: jest.fn(),
    list: jest.fn(),
  },
  subscriptions: {
    retrieve: jest.fn().mockResolvedValue({
      id: 'sub_integration_1',
      status: 'active',
      current_period_start: NOW_UNIX - 86400,
      current_period_end: FUTURE_UNIX,
      cancel_at_period_end: false,
      canceled_at: null,
      metadata: { userId: '' }, // filled per test
    }),
    create: jest.fn(),
    update: jest.fn(),
    list: jest.fn(),
    cancel: jest.fn().mockResolvedValue({
      id: 'sub_integration_canceled',
      status: 'canceled',
      current_period_start: NOW_UNIX - 86400,
      current_period_end: FUTURE_UNIX,
      cancel_at_period_end: false,
      canceled_at: NOW_UNIX,
      metadata: { userId: '' },
    }),
  },
  checkout: { sessions: { create: jest.fn().mockResolvedValue({ url: 'https://stripe.test/session' }) } },
  billingPortal: { sessions: { create: jest.fn().mockResolvedValue({ url: 'https://stripe.test/portal' }) } },
  paymentIntents: { create: jest.fn(), retrieve: jest.fn(), cancel: jest.fn(), capture: jest.fn() },
  webhooks: { constructEvent: jest.fn() },
  prices: {
    retrieve: jest.fn().mockResolvedValue({ id: 'price_sub_test', product: 'prod_sub_test', unit_amount: 1000, currency: 'usd', recurring: { interval: 'month' } }),
    create: jest.fn(),
    update: jest.fn(),
  },
  products: { update: jest.fn() },
};

import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createTestingApp } from '../../src/test-utils/testing-app';
import { makeUser } from '../../src/test-utils/fixtures';
import { User } from '../../src/entities/user.entity';
import { Subscription, SubscriptionModel, SubscriptionStatus } from '../../src/entities/subscription.entity';
import { SubscriptionPlan } from '../../src/entities/subscription-plan.entity';
import { UserRole } from '../../src/entities/enums';
import { SubscriptionService } from '../../src/modules/subscription/subscription.service';

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

describe('SubscriptionService (integration)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let subscriptionService: SubscriptionService;

  beforeAll(async () => {
    loadEnvTest();
    app = await createTestingApp();
    dataSource = app.get(DataSource);
    subscriptionService = app.get(SubscriptionService);
  });

  afterAll(async () => {
    await app.close();
  });

  // Helper: create a user and clean up after each test
  async function createTestUser(): Promise<User> {
    const userRepo = dataSource.getRepository(User);
    return userRepo.save(
      makeUser({ role: UserRole.CLIENT }) as unknown as User,
    );
  }

  async function cleanupUser(userId: string): Promise<void> {
    await dataSource.getRepository(Subscription).delete({ userId });
    await dataSource.getRepository(User).delete({ id: userId });
  }

  // -------------------------------------------------------------------------
  // Webhook double-fire — idempotent upsert
  // -------------------------------------------------------------------------

  describe('webhook double-fire idempotency', () => {
    it('creates exactly one subscription row when the same event fires twice', async () => {
      const user = await createTestUser();

      const event = {
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_idem_test',
            status: 'active',
            current_period_start: NOW_UNIX - 3600,
            current_period_end: FUTURE_UNIX,
            cancel_at_period_end: false,
            canceled_at: null,
            metadata: { userId: user.id },
          },
        },
      };

      // Fire the same event twice
      await subscriptionService.handleWebhook(event);
      await subscriptionService.handleWebhook(event);

      // Assert: exactly one row exists
      const rows = await dataSource.getRepository(Subscription).find({
        where: { userId: user.id },
      });

      expect(rows).toHaveLength(1);
      expect(rows[0].stripeSubscriptionId).toBe('sub_idem_test');
      expect(rows[0].status).toBe(SubscriptionStatus.ACTIVE);

      await cleanupUser(user.id);
    });
  });

  // -------------------------------------------------------------------------
  // period_end fallback to items[0]
  // -------------------------------------------------------------------------

  describe('period_end from items[0]', () => {
    it('stores correct period_end when subscription uses new API shape (items[0])', async () => {
      const user = await createTestUser();

      const expectedEnd = new Date(FUTURE_UNIX * 1000);

      const event = {
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_new_api_test',
            status: 'active',
            // NO top-level current_period_start / current_period_end
            items: {
              data: [
                {
                  current_period_start: NOW_UNIX - 3600,
                  current_period_end: FUTURE_UNIX,
                },
              ],
            },
            cancel_at_period_end: false,
            canceled_at: null,
            metadata: { userId: user.id },
          },
        },
      };

      await subscriptionService.handleWebhook(event);

      const row = await dataSource.getRepository(Subscription).findOneOrFail({
        where: { userId: user.id, stripeSubscriptionId: 'sub_new_api_test' },
      });

      // period_end should match FUTURE_UNIX (within 1 second tolerance for DB precision)
      const diff = Math.abs(row.currentPeriodEnd.getTime() - expectedEnd.getTime());
      expect(diff).toBeLessThan(1500); // within 1.5 seconds

      await cleanupUser(user.id);
    });
  });

  // -------------------------------------------------------------------------
  // T53: activateAsRental / activateAsPurchase / chargeLateFee + cancelAdmin
  //      / getDelinquentList — end-to-end with real Postgres + mocked Stripe
  // -------------------------------------------------------------------------

  describe('T53 — rental-billing end-to-end integration', () => {
    let planId: string;

    beforeAll(async () => {
      // Ensure a subscription plan row exists with all required fields
      const planRepo = dataSource.getRepository(SubscriptionPlan);
      let plan = await planRepo.findOne({ where: {} });
      if (plan) {
        plan.unitAmountCents = 1000;
        plan.purchasePriceCents = 4500;
        plan.lateFeeCents = 500;
        plan.activeStripePriceId = 'price_sub_test';
        plan.stripeProductId = 'prod_sub_test';
        plan = await planRepo.save(plan);
      } else {
        plan = await planRepo.save({
          stripeProductId: 'prod_sub_test',
          activeStripePriceId: 'price_sub_test',
          unitAmountCents: 1000,
          purchasePriceCents: 4500,
          lateFeeCents: 500,
          currency: 'usd',
          interval: 'month',
        } as unknown as SubscriptionPlan);
      }
      planId = plan.id;
    });

    describe('activateAsRental', () => {
      it('persists a row with model=rental and correct Stripe fields', async () => {
        const user = await createTestUser();
        // Give user a stripeCustomerId so the no-PM check passes
        await dataSource.getRepository(User).update(user.id, {
          stripeCustomerId: 'cus_rental_int_test',
        } as Partial<User>);

        const stripeSubId = `sub_rental_int_${Date.now()}`;
        mockStripe.subscriptions.create.mockResolvedValueOnce({
          id: stripeSubId,
          status: 'active',
          current_period_start: NOW_UNIX - 3600,
          current_period_end: FUTURE_UNIX,
          cancel_at_period_end: false,
          canceled_at: null,
          metadata: { userId: user.id },
        });

        const result = await subscriptionService.activateAsRental(user.id);

        // Stripe was called
        expect(mockStripe.subscriptions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            customer: 'cus_rental_int_test',
            items: expect.arrayContaining([
              expect.objectContaining({ price: 'price_sub_test' }),
            ]),
            metadata: expect.objectContaining({ userId: user.id }),
          }),
          expect.anything(),
        );

        // Service returns a SubscriptionResponseDto
        expect(result).toBeDefined();
        expect(result.status).toBe(SubscriptionStatus.ACTIVE);

        // DB row was written with model=rental
        const row = await dataSource.getRepository(Subscription).findOne({
          where: { userId: user.id, stripeSubscriptionId: stripeSubId },
        });
        expect(row).toBeDefined();
        expect(row?.model).toBe(SubscriptionModel.RENTAL);
        expect(row?.stripeChargeId).toBeNull();
        expect(row?.purchasedAt).toBeNull();

        await cleanupUser(user.id);
      });
    });

    describe('activateAsPurchase', () => {
      it('persists row with model=purchase, synthetic stripeSubscriptionId, purchasedAt set, currentPeriodEnd=9999', async () => {
        const user = await createTestUser();
        await dataSource.getRepository(User).update(user.id, {
          stripeCustomerId: 'cus_purchase_int_test',
        } as Partial<User>);

        const piId = `pi_purchase_int_${Date.now()}`;
        mockStripe.paymentIntents.create.mockResolvedValueOnce({
          id: piId,
          status: 'succeeded',
          amount: 4500,
          currency: 'usd',
        });

        const result = await subscriptionService.activateAsPurchase(user.id);

        expect(result).toBeDefined();
        expect(result.status).toBe(SubscriptionStatus.ACTIVE);

        // DB row
        const row = await dataSource.getRepository(Subscription).findOne({
          where: { userId: user.id, stripeSubscriptionId: `purchase:${piId}` },
        });
        expect(row).toBeDefined();
        expect(row?.model).toBe(SubscriptionModel.PURCHASE);
        expect(row?.stripeChargeId).toBe(piId);
        expect(row?.purchasedAt).toBeDefined();
        expect(row?.purchasedAt).not.toBeNull();
        // sentinel: currentPeriodEnd year = 9999
        expect(row?.currentPeriodEnd.getFullYear()).toBe(9999);

        await cleanupUser(user.id);
      });
    });

    describe('chargeLateFee + cancelAdmin', () => {
      it('chargeLateFee charges Stripe PI then cancelAdmin transitions DB to canceled', async () => {
        const user = await createTestUser();
        await dataSource.getRepository(User).update(user.id, {
          stripeCustomerId: 'cus_latefee_int_test',
        } as Partial<User>);

        // Seed a rental subscription
        const sub = await dataSource.getRepository(Subscription).save({
          userId: user.id,
          stripeSubscriptionId: `sub_latefee_int_${Date.now()}`,
          model: SubscriptionModel.RENTAL,
          status: SubscriptionStatus.PAST_DUE,
          currentPeriodStart: new Date(Date.now() - 35 * 24 * 3600 * 1000),
          currentPeriodEnd: new Date(Date.now() - 5 * 24 * 3600 * 1000),
          cancelAtPeriodEnd: false,
          canceledAt: null,
          stripeChargeId: null,
          purchasedAt: null,
        } as unknown as Subscription);

        const piId = `pi_latefee_int_${Date.now()}`;
        mockStripe.paymentIntents.create.mockResolvedValueOnce({
          id: piId,
          status: 'succeeded',
          amount: 500,
          currency: 'usd',
        });

        // chargeLateFee with alsoCancel=true
        const chargeResult = await subscriptionService.chargeLateFee(sub.id, true);

        expect(chargeResult.chargedCents).toBe(500);
        expect(chargeResult.paymentIntentId).toBe(piId);
        expect(chargeResult.subscriptionCanceled).toBe(true);

        // DB row should be canceled
        const updatedRow = await dataSource.getRepository(Subscription).findOne({
          where: { id: sub.id },
        });
        expect(updatedRow?.status).toBe(SubscriptionStatus.CANCELED);
        expect(updatedRow?.canceledAt).toBeDefined();

        await cleanupUser(user.id);
      });
    });

    describe('getDelinquentList', () => {
      it('filters correctly: returns past_due rental, excludes active and purchase rows, orders by period_end ASC', async () => {
        const user1 = await createTestUser();
        const user2 = await createTestUser();
        const user3 = await createTestUser(); // for purchase row (should be excluded)
        const user4 = await createTestUser(); // for active rental (should be excluded)

        const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 3600 * 1000);
        const twoDaysAgo = new Date(Date.now() - 2 * 24 * 3600 * 1000);

        // Delinquent rental — 5 days ago
        const sub1 = await dataSource.getRepository(Subscription).save({
          userId: user1.id,
          stripeSubscriptionId: `sub_delinquent_5d_${Date.now()}`,
          model: SubscriptionModel.RENTAL,
          status: SubscriptionStatus.PAST_DUE,
          currentPeriodStart: new Date(fiveDaysAgo.getTime() - 30 * 24 * 3600 * 1000),
          currentPeriodEnd: fiveDaysAgo,
          cancelAtPeriodEnd: false,
          canceledAt: null,
          stripeChargeId: null,
          purchasedAt: null,
        } as unknown as Subscription);

        // Delinquent rental — 2 days ago
        const sub2 = await dataSource.getRepository(Subscription).save({
          userId: user2.id,
          stripeSubscriptionId: `sub_delinquent_2d_${Date.now()}`,
          model: SubscriptionModel.RENTAL,
          status: SubscriptionStatus.PAST_DUE,
          currentPeriodStart: new Date(twoDaysAgo.getTime() - 30 * 24 * 3600 * 1000),
          currentPeriodEnd: twoDaysAgo,
          cancelAtPeriodEnd: false,
          canceledAt: null,
          stripeChargeId: null,
          purchasedAt: null,
        } as unknown as Subscription);

        // Purchase row — should be EXCLUDED
        const sub3 = await dataSource.getRepository(Subscription).save({
          userId: user3.id,
          stripeSubscriptionId: `purchase_delinq_excl_${Date.now()}`,
          model: SubscriptionModel.PURCHASE,
          status: SubscriptionStatus.ACTIVE,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date('9999-12-31'),
          cancelAtPeriodEnd: false,
          canceledAt: null,
          stripeChargeId: 'pi_excl',
          purchasedAt: new Date(),
        } as unknown as Subscription);

        // Active rental — should be EXCLUDED
        const sub4 = await dataSource.getRepository(Subscription).save({
          userId: user4.id,
          stripeSubscriptionId: `sub_active_excl_${Date.now()}`,
          model: SubscriptionModel.RENTAL,
          status: SubscriptionStatus.ACTIVE,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000),
          cancelAtPeriodEnd: false,
          canceledAt: null,
          stripeChargeId: null,
          purchasedAt: null,
        } as unknown as Subscription);

        const list = await subscriptionService.getDelinquentList();

        // Filter to only our seeded users
        const seededUserIds = [user1.id, user2.id, user3.id, user4.id];
        const filtered = list.filter((entry) => seededUserIds.includes(entry.userId));

        // Should only include user1 and user2 (both delinquent rentals)
        const userIdsInResult = filtered.map((e) => e.userId);
        expect(userIdsInResult).toContain(user1.id);
        expect(userIdsInResult).toContain(user2.id);
        expect(userIdsInResult).not.toContain(user3.id); // purchase excluded
        expect(userIdsInResult).not.toContain(user4.id); // active excluded

        // Ordered by currentPeriodEnd ASC (oldest first = user1 with 5 days ago)
        const idx1 = filtered.findIndex((e) => e.userId === user1.id);
        const idx2 = filtered.findIndex((e) => e.userId === user2.id);
        expect(idx1).toBeLessThan(idx2); // 5-day-delinquent before 2-day-delinquent

        // Verify daysDelinquent field
        const entry1 = filtered.find((e) => e.userId === user1.id);
        expect(entry1?.daysDelinquent).toBeGreaterThanOrEqual(4);

        // Cleanup
        await dataSource.getRepository(Subscription).delete({ id: sub1.id });
        await dataSource.getRepository(Subscription).delete({ id: sub2.id });
        await dataSource.getRepository(Subscription).delete({ id: sub3.id });
        await dataSource.getRepository(Subscription).delete({ id: sub4.id });
        await cleanupUser(user1.id);
        await cleanupUser(user2.id);
        await cleanupUser(user3.id);
        await cleanupUser(user4.id);
      });
    });
  });
});
