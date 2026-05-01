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
jest.mock('stripe', () => ({
  default: jest.fn().mockImplementation(() => mockStripe),
}));

const NOW_UNIX = Math.floor(Date.now() / 1000);
const FUTURE_UNIX = NOW_UNIX + 86400 * 30;

const mockStripe = {
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
  },
  checkout: { sessions: { create: jest.fn().mockResolvedValue({ url: 'https://stripe.test/session' }) } },
  billingPortal: { sessions: { create: jest.fn().mockResolvedValue({ url: 'https://stripe.test/portal' }) } },
  paymentIntents: { create: jest.fn(), retrieve: jest.fn(), cancel: jest.fn(), capture: jest.fn() },
  webhooks: { constructEvent: jest.fn() },
};

import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createTestingApp } from '../../src/test-utils/testing-app';
import { makeUser } from '../../src/test-utils/fixtures';
import { User } from '../../src/entities/user.entity';
import { Subscription, SubscriptionStatus } from '../../src/entities/subscription.entity';
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
});
