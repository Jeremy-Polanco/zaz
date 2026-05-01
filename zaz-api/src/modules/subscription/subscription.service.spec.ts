/**
 * Unit specs for SubscriptionService.
 *
 * Stripe is mocked at module level. Repositories and ConfigService are
 * injected as jest mocks. No real DB or Stripe connection.
 */

import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { SubscriptionService } from './subscription.service';
import { Subscription, SubscriptionStatus } from '../../entities/subscription.entity';
import { User } from '../../entities/user.entity';
import { createMockStripe, MockStripe } from '../../test-utils/stripe';

// ---------------------------------------------------------------------------
// Module-level Stripe mock
// Production code uses `import Stripe = require('stripe')` (CommonJS interop).
// The mock must expose the constructor as BOTH the default export AND the module itself.
// ---------------------------------------------------------------------------
jest.mock('stripe', () => {
  const mock = jest.fn().mockImplementation(() => mockStripeInstance);
  // CommonJS interop: the module itself IS the constructor
  (mock as unknown as Record<string, unknown>)['default'] = mock;
  return mock;
});

let mockStripeInstance: MockStripe;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRepoMock<T>(): jest.Mocked<Repository<T>> {
  return {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    create: jest.fn((dto: Partial<T>) => dto as T),
    upsert: jest.fn(),
    createQueryBuilder: jest.fn(),
    count: jest.fn(),
  } as unknown as jest.Mocked<Repository<T>>;
}

function fakeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'test@example.com',
    fullName: 'Test User',
    phone: null,
    role: 'client' as never,
    stripeCustomerId: null,
    referralCode: null,
    referredById: null,
    addressDefault: null,
    createdAt: new Date(),
    ...overrides,
  } as User;
}

function fakeSubscription(overrides: Partial<Subscription> = {}): Subscription {
  const now = new Date();
  const end = new Date(now.getTime() + 30 * 86400 * 1000);
  return {
    id: 'sub-db-1',
    userId: 'user-1',
    stripeSubscriptionId: 'sub_stripe_1',
    status: SubscriptionStatus.ACTIVE,
    currentPeriodStart: now,
    currentPeriodEnd: end,
    cancelAtPeriodEnd: false,
    canceledAt: null,
    createdAt: now,
    updatedAt: now,
    user: {} as never,
    ...overrides,
  };
}

const NOW_UNIX = Math.floor(Date.now() / 1000);
const FUTURE_UNIX = NOW_UNIX + 86400 * 30;
const PAST_UNIX = NOW_UNIX - 86400;

function fakeStripeSub(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'sub_stripe_1',
    status: 'active',
    current_period_start: NOW_UNIX - 86400,
    current_period_end: FUTURE_UNIX,
    cancel_at_period_end: false,
    canceled_at: null,
    metadata: { userId: 'user-1' },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('SubscriptionService', () => {
  let service: SubscriptionService;
  let subscriptionsRepo: jest.Mocked<Repository<Subscription>>;
  let usersRepo: jest.Mocked<Repository<User>>;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    // Create a fresh mock Stripe instance for each test
    mockStripeInstance = createMockStripe();

    subscriptionsRepo = makeRepoMock<Subscription>();
    usersRepo = makeRepoMock<User>();
    configService = {
      get: jest.fn(),
      getOrThrow: jest.fn(),
    } as unknown as jest.Mocked<ConfigService>;

    // Configure ConfigService to return test Stripe values
    configService.get.mockImplementation((key: string) => {
      if (key === 'STRIPE_SECRET_KEY') return 'sk_test_dummy';
      if (key === 'STRIPE_SUBSCRIPTION_PRICE_ID') return 'price_test_monthly';
      return undefined;
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionService,
        { provide: getRepositoryToken(Subscription), useValue: subscriptionsRepo },
        { provide: getRepositoryToken(User), useValue: usersRepo },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<SubscriptionService>(SubscriptionService);
    // Trigger onModuleInit to set up Stripe
    await service.onModuleInit();
  });

  // -------------------------------------------------------------------------
  // handleWebhook — checkout.session.completed
  // -------------------------------------------------------------------------

  describe('handleWebhook', () => {
    describe('checkout.session.completed', () => {
      it('creates a subscription row when session has metadata.userId', async () => {
        const stripeSub = fakeStripeSub();
        mockStripeInstance.subscriptions.retrieve.mockResolvedValue(stripeSub as never);
        subscriptionsRepo.upsert.mockResolvedValue({} as never);
        usersRepo.findOne.mockResolvedValue(null);

        const event = {
          type: 'checkout.session.completed',
          data: {
            object: {
              id: 'cs_test_1',
              mode: 'subscription',
              subscription: 'sub_stripe_1',
              customer: 'cus_test_1',
              metadata: { userId: 'user-1' },
            },
          },
        };

        await service.handleWebhook(event);

        expect(mockStripeInstance.subscriptions.retrieve).toHaveBeenCalledWith('sub_stripe_1');
        expect(subscriptionsRepo.upsert).toHaveBeenCalled();
      });

      it('skips safely when session has no metadata.userId', async () => {
        const event = {
          type: 'checkout.session.completed',
          data: {
            object: {
              id: 'cs_test_2',
              mode: 'subscription',
              subscription: 'sub_stripe_1',
              customer: 'cus_test_1',
              metadata: null,
            },
          },
        };

        await service.handleWebhook(event);

        expect(mockStripeInstance.subscriptions.retrieve).not.toHaveBeenCalled();
        expect(subscriptionsRepo.upsert).not.toHaveBeenCalled();
      });

      it('skips non-subscription sessions', async () => {
        const event = {
          type: 'checkout.session.completed',
          data: {
            object: {
              id: 'cs_test_3',
              mode: 'payment',
              subscription: null,
              customer: 'cus_test_1',
              metadata: { userId: 'user-1' },
            },
          },
        };

        await service.handleWebhook(event);
        expect(subscriptionsRepo.upsert).not.toHaveBeenCalled();
      });
    });

    // -----------------------------------------------------------------------
    // customer.subscription.updated — upserts
    // -----------------------------------------------------------------------

    describe('customer.subscription.updated', () => {
      it('upserts by stripe_subscription_id (no duplicate row)', async () => {
        subscriptionsRepo.upsert.mockResolvedValue({} as never);

        const event = {
          type: 'customer.subscription.updated',
          data: { object: fakeStripeSub() },
        };

        await service.handleWebhook(event);

        expect(subscriptionsRepo.upsert).toHaveBeenCalledTimes(1);
        // Upsert conflict key must be stripeSubscriptionId
        expect(subscriptionsRepo.upsert).toHaveBeenCalledWith(
          expect.objectContaining({ stripeSubscriptionId: 'sub_stripe_1' }),
          ['stripeSubscriptionId'],
        );
      });
    });

    // -----------------------------------------------------------------------
    // customer.subscription.deleted — forces canceled + sets canceled_at
    // -----------------------------------------------------------------------

    describe('customer.subscription.deleted', () => {
      it('sets status to canceled and provides canceled_at when Stripe omits it', async () => {
        subscriptionsRepo.upsert.mockResolvedValue({} as never);

        // Stripe can omit canceled_at on deletion
        const event = {
          type: 'customer.subscription.deleted',
          data: {
            object: fakeStripeSub({ status: 'active', canceled_at: null }),
          },
        };

        await service.handleWebhook(event);

        expect(subscriptionsRepo.upsert).toHaveBeenCalledWith(
          expect.objectContaining({
            status: SubscriptionStatus.CANCELED,
            canceledAt: expect.any(Date),
          }),
          ['stripeSubscriptionId'],
        );
      });
    });

    // -----------------------------------------------------------------------
    // invoice.payment_failed — sets past_due
    // -----------------------------------------------------------------------

    describe('invoice.payment_failed', () => {
      it('sets subscription status to past_due', async () => {
        const pastDueSub = fakeStripeSub({ status: 'past_due' });
        mockStripeInstance.subscriptions.retrieve.mockResolvedValue(pastDueSub as never);
        subscriptionsRepo.upsert.mockResolvedValue({} as never);

        const event = {
          type: 'invoice.payment_failed',
          data: {
            object: { id: 'inv_1', subscription: 'sub_stripe_1' },
          },
        };

        await service.handleWebhook(event);

        expect(subscriptionsRepo.upsert).toHaveBeenCalledWith(
          expect.objectContaining({ status: SubscriptionStatus.PAST_DUE }),
          ['stripeSubscriptionId'],
        );
      });
    });
  });

  // -------------------------------------------------------------------------
  // extractPeriodBounds — private method tested indirectly via handleWebhook
  // -------------------------------------------------------------------------

  describe('extractPeriodBounds (via upsert behavior)', () => {
    it('handles legacy shape: period bounds on subscription object directly', async () => {
      subscriptionsRepo.upsert.mockResolvedValue({} as never);

      const legacyStripeObj = {
        id: 'sub_legacy',
        status: 'active',
        current_period_start: NOW_UNIX - 3600,
        current_period_end: FUTURE_UNIX,
        cancel_at_period_end: false,
        canceled_at: null,
        metadata: { userId: 'user-1' },
        // No items.data
      };

      const event = {
        type: 'customer.subscription.updated',
        data: { object: legacyStripeObj },
      };

      await service.handleWebhook(event);

      const upsertCall = subscriptionsRepo.upsert.mock.calls[0][0] as Record<string, unknown>;
      const periodEnd = upsertCall.currentPeriodEnd as Date;
      expect(periodEnd).toBeInstanceOf(Date);
      expect(periodEnd.getTime()).toBeCloseTo(FUTURE_UNIX * 1000, -3);
    });

    it('handles new API shape: period bounds in items.data[0]', async () => {
      subscriptionsRepo.upsert.mockResolvedValue({} as never);

      const newShapeObj = {
        id: 'sub_new',
        status: 'active',
        // No top-level current_period_start / current_period_end
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
        metadata: { userId: 'user-1' },
      };

      const event = {
        type: 'customer.subscription.updated',
        data: { object: newShapeObj },
      };

      await service.handleWebhook(event);

      const upsertCall = subscriptionsRepo.upsert.mock.calls[0][0] as Record<string, unknown>;
      const periodEnd = upsertCall.currentPeriodEnd as Date;
      expect(periodEnd).toBeInstanceOf(Date);
      expect(periodEnd.getTime()).toBeCloseTo(FUTURE_UNIX * 1000, -3);
    });
  });

  // -------------------------------------------------------------------------
  // isActiveSubscriber
  // -------------------------------------------------------------------------

  describe('isActiveSubscriber', () => {
    it('returns true for active subscription within period', async () => {
      const mockQb = {
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ '1': '1' }),
      };
      subscriptionsRepo.createQueryBuilder.mockReturnValue(mockQb as never);

      const result = await service.isActiveSubscriber('user-1');
      expect(result).toBe(true);
    });

    it('returns false when no active subscription exists', async () => {
      const mockQb = {
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue(undefined),
      };
      subscriptionsRepo.createQueryBuilder.mockReturnValue(mockQb as never);

      const result = await service.isActiveSubscriber('user-1');
      expect(result).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // getOrCreateStripeCustomer — 3-tier dedup
  // -------------------------------------------------------------------------

  describe('getOrCreateStripeCustomer', () => {
    it('Tier 1: returns stored stripeCustomerId without calling Stripe', async () => {
      usersRepo.findOne.mockResolvedValue(
        fakeUser({ stripeCustomerId: 'cus_already_stored' }),
      );

      const result = await service.getOrCreateStripeCustomer('user-1');

      expect(result).toBe('cus_already_stored');
      expect(mockStripeInstance.customers.search).not.toHaveBeenCalled();
      expect(mockStripeInstance.customers.create).not.toHaveBeenCalled();
    });

    it('Tier 2: returns customer from Stripe search when not stored in DB', async () => {
      usersRepo.findOne.mockResolvedValue(fakeUser({ stripeCustomerId: null }));
      usersRepo.update.mockResolvedValue({ affected: 1 } as never);
      mockStripeInstance.customers.search.mockResolvedValue({
        data: [{ id: 'cus_from_stripe_search' }],
      } as never);

      const result = await service.getOrCreateStripeCustomer('user-1');

      expect(result).toBe('cus_from_stripe_search');
      expect(mockStripeInstance.customers.create).not.toHaveBeenCalled();
    });

    it('Tier 3: creates new customer with idempotency key when not found in DB or Stripe', async () => {
      usersRepo.findOne.mockResolvedValue(fakeUser({ stripeCustomerId: null }));
      usersRepo.update.mockResolvedValue({ affected: 1 } as never);
      mockStripeInstance.customers.search.mockResolvedValue({ data: [] } as never);
      mockStripeInstance.customers.create.mockResolvedValue({
        id: 'cus_newly_created',
      } as never);

      const result = await service.getOrCreateStripeCustomer('user-1');

      expect(result).toBe('cus_newly_created');
      expect(mockStripeInstance.customers.create).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: { userId: 'user-1' } }),
        expect.objectContaining({ idempotencyKey: 'cust:user-1' }),
      );
      // Should persist the new customer ID
      expect(usersRepo.update).toHaveBeenCalledWith('user-1', {
        stripeCustomerId: 'cus_newly_created',
      });
    });

    it('throws NotFoundException when user does not exist', async () => {
      usersRepo.findOne.mockResolvedValue(null);

      await expect(service.getOrCreateStripeCustomer('user-unknown')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
