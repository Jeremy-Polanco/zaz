/**
 * Unit specs for SubscriptionService.
 *
 * Stripe is mocked at module level. Repositories and ConfigService are
 * injected as jest mocks. No real DB or Stripe connection.
 */

import { ConflictException, HttpException, HttpStatus, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { SubscriptionService } from './subscription.service';
import { Subscription, SubscriptionStatus } from '../../entities/subscription.entity';
import { User } from '../../entities/user.entity';
import { SubscriptionPlan } from '../../entities/subscription-plan.entity';
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
  let plansRepo: jest.Mocked<Repository<SubscriptionPlan>>;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    // Create a fresh mock Stripe instance for each test
    mockStripeInstance = createMockStripe();

    subscriptionsRepo = makeRepoMock<Subscription>();
    usersRepo = makeRepoMock<User>();
    plansRepo = makeRepoMock<SubscriptionPlan>();
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

    // Stub plans.findOne to return an existing row so onModuleInit skips seeding
    // (existing tests do not exercise the seed path)
    plansRepo.findOne.mockResolvedValue({
      id: 'existing-plan',
      stripeProductId: 'prod_test',
      activeStripePriceId: 'price_test_monthly',
      unitAmountCents: 1000,
      currency: 'usd',
      interval: 'month',
    } as SubscriptionPlan);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionService,
        { provide: getRepositoryToken(Subscription), useValue: subscriptionsRepo },
        { provide: getRepositoryToken(User), useValue: usersRepo },
        { provide: getRepositoryToken(SubscriptionPlan), useValue: plansRepo },
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

// ---------------------------------------------------------------------------
// Bootstrap seed + getPlan — Phase 2 tests (T7 + T9)
//
// These run in a SEPARATE describe block with a dedicated beforeEach that
// wires up the SubscriptionPlan repository mock.  The outer describe above
// does NOT include plansRepo and calls onModuleInit() in its beforeEach, so
// we manage onModuleInit() manually here for full control.
// ---------------------------------------------------------------------------

describe('SubscriptionService — bootstrap seed (T7)', () => {
  let service: SubscriptionService;
  let plansRepo: jest.Mocked<Repository<SubscriptionPlan>>;
  let subscriptionsRepo: jest.Mocked<Repository<Subscription>>;
  let usersRepo: jest.Mocked<Repository<User>>;
  let configService: jest.Mocked<ConfigService>;

  function makeRepoMockLocal<T>(): jest.Mocked<Repository<T>> {
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

  beforeEach(async () => {
    mockStripeInstance = createMockStripe();

    plansRepo = makeRepoMockLocal<SubscriptionPlan>();
    subscriptionsRepo = makeRepoMockLocal<Subscription>();
    usersRepo = makeRepoMockLocal<User>();
    configService = {
      get: jest.fn(),
      getOrThrow: jest.fn(),
    } as unknown as jest.Mocked<ConfigService>;

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
        { provide: getRepositoryToken(SubscriptionPlan), useValue: plansRepo },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<SubscriptionService>(SubscriptionService);
    // Do NOT call onModuleInit() here — each test controls it
  });

  // T7a: no DB row + env var present → calls prices.retrieve + inserts row
  it('seeds a subscription_plan row from env when no row exists and env var is set', async () => {
    plansRepo.findOne.mockResolvedValue(null); // no existing row

    mockStripeInstance.prices.retrieve.mockResolvedValue({
      id: 'price_test_monthly',
      product: 'prod_abc123',
      unit_amount: 1000,
      currency: 'usd',
      recurring: { interval: 'month' },
    } as never);

    plansRepo.save.mockResolvedValue({
      id: 'plan-uuid-1',
      stripeProductId: 'prod_abc123',
      activeStripePriceId: 'price_test_monthly',
      unitAmountCents: 1000,
      currency: 'usd',
      interval: 'month',
    } as never);

    await service.onModuleInit();

    // Must call prices.retrieve exactly once with the env price id
    expect(mockStripeInstance.prices.retrieve).toHaveBeenCalledTimes(1);
    expect(mockStripeInstance.prices.retrieve).toHaveBeenCalledWith('price_test_monthly');

    // Must save a row with values derived from the Stripe price response
    expect(plansRepo.save).toHaveBeenCalledTimes(1);
    const savedArg = plansRepo.save.mock.calls[0][0] as Partial<SubscriptionPlan>;
    expect(savedArg.stripeProductId).toBe('prod_abc123');
    expect(savedArg.activeStripePriceId).toBe('price_test_monthly');
    expect(savedArg.unitAmountCents).toBe(1000);
    expect(savedArg.currency).toBe('usd');
    expect(savedArg.interval).toBe('month');
  });

  // T7a triangulation: product field is an object (expand=product) → use product.id
  it('uses product.id when Stripe returns expanded product object', async () => {
    plansRepo.findOne.mockResolvedValue(null);

    mockStripeInstance.prices.retrieve.mockResolvedValue({
      id: 'price_test_monthly',
      product: { id: 'prod_expanded', name: 'Basic Plan' },
      unit_amount: 2000,
      currency: 'usd',
      recurring: { interval: 'month' },
    } as never);

    plansRepo.save.mockResolvedValue({} as never);

    await service.onModuleInit();

    const savedArg = plansRepo.save.mock.calls[0][0] as Partial<SubscriptionPlan>;
    expect(savedArg.stripeProductId).toBe('prod_expanded');
    expect(savedArg.unitAmountCents).toBe(2000);
  });

  // T7b: row exists → no Stripe call, no insert
  it('skips seeding when a subscription_plan row already exists', async () => {
    plansRepo.findOne.mockResolvedValue({
      id: 'existing-plan-uuid',
      stripeProductId: 'prod_existing',
      activeStripePriceId: 'price_existing',
      unitAmountCents: 999,
      currency: 'usd',
      interval: 'month',
    } as SubscriptionPlan);

    await service.onModuleInit();

    expect(mockStripeInstance.prices.retrieve).not.toHaveBeenCalled();
    expect(plansRepo.save).not.toHaveBeenCalled();
  });

  // T7c: no DB row + no env var → no Stripe call, no insert, logs warning
  it('skips seeding and does not throw when STRIPE_SUBSCRIPTION_PRICE_ID is absent', async () => {
    configService.get.mockImplementation((key: string) => {
      if (key === 'STRIPE_SECRET_KEY') return 'sk_test_dummy';
      // STRIPE_SUBSCRIPTION_PRICE_ID intentionally omitted (undefined)
      return undefined;
    });

    plansRepo.findOne.mockResolvedValue(null);

    await expect(service.onModuleInit()).resolves.not.toThrow();

    expect(mockStripeInstance.prices.retrieve).not.toHaveBeenCalled();
    expect(plansRepo.save).not.toHaveBeenCalled();
  });

  // T7d: prices.retrieve throws → service starts, no row inserted, no crash
  it('catches Stripe retrieve error, does not insert a row, and does not crash', async () => {
    plansRepo.findOne.mockResolvedValue(null);
    mockStripeInstance.prices.retrieve.mockRejectedValue(new Error('Stripe network error'));

    await expect(service.onModuleInit()).resolves.not.toThrow();

    expect(plansRepo.save).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// updatePlan — Phase 3 tests (T11–T22)
// ---------------------------------------------------------------------------

describe('SubscriptionService — updatePlan (T11–T22)', () => {
  let service: SubscriptionService;
  let plansRepo: jest.Mocked<Repository<SubscriptionPlan>>;
  let subscriptionsRepo: jest.Mocked<Repository<Subscription>>;
  let usersRepo: jest.Mocked<Repository<User>>;
  let configService: jest.Mocked<ConfigService>;

  const existingPlan: SubscriptionPlan = {
    id: 'plan-uuid-existing',
    stripeProductId: 'prod_existing',
    activeStripePriceId: 'price_OLD',
    unitAmountCents: 1000,
    currency: 'usd',
    interval: 'month',
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
    updatedAt: new Date('2025-01-01T00:00:00.000Z'),
  };

  function makeRepoMockLocal<T>(): jest.Mocked<Repository<T>> {
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

  beforeEach(async () => {
    mockStripeInstance = createMockStripe();

    plansRepo = makeRepoMockLocal<SubscriptionPlan>();
    subscriptionsRepo = makeRepoMockLocal<Subscription>();
    usersRepo = makeRepoMockLocal<User>();
    configService = {
      get: jest.fn(),
      getOrThrow: jest.fn(),
    } as unknown as jest.Mocked<ConfigService>;

    configService.get.mockImplementation((key: string) => {
      if (key === 'STRIPE_SECRET_KEY') return 'sk_test_dummy';
      if (key === 'STRIPE_SUBSCRIPTION_PRICE_ID') return 'price_test_monthly';
      return undefined;
    });

    // Stub findOne to return existingPlan by default so onModuleInit skips seeding
    plansRepo.findOne.mockResolvedValue({ ...existingPlan });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionService,
        { provide: getRepositoryToken(Subscription), useValue: subscriptionsRepo },
        { provide: getRepositoryToken(User), useValue: usersRepo },
        { provide: getRepositoryToken(SubscriptionPlan), useValue: plansRepo },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<SubscriptionService>(SubscriptionService);
    await service.onModuleInit();

    // Reset call counts after onModuleInit so we start clean
    jest.clearAllMocks();

    // Re-apply the default stubs after clearAllMocks
    plansRepo.findOne.mockResolvedValue({ ...existingPlan });
    mockStripeInstance.prices.create.mockResolvedValue({
      id: 'price_NEW',
      product: 'prod_existing',
      unit_amount: 1500,
      currency: 'usd',
      recurring: { interval: 'month' },
    } as never);
    mockStripeInstance.products.update.mockResolvedValue({} as never);
    mockStripeInstance.prices.update.mockResolvedValue({} as never);
    plansRepo.save.mockResolvedValue({
      ...existingPlan,
      activeStripePriceId: 'price_NEW',
      unitAmountCents: 1500,
      updatedAt: new Date(),
    } as SubscriptionPlan);
  });

  // T11 — Happy path
  it('T11: happy path — calls prices.create, products.update, prices.update(archive), plans.save; returns updated plan', async () => {
    const result = await service.updatePlan(1500);

    // Step 1: prices.create called with correct args + idempotency key
    expect(mockStripeInstance.prices.create).toHaveBeenCalledTimes(1);
    const createCall = mockStripeInstance.prices.create.mock.calls[0];
    expect(createCall[0]).toMatchObject({
      unit_amount: 1500,
      currency: 'usd',
      recurring: { interval: 'month' },
      product: 'prod_existing',
    });
    // Idempotency key is present and matches expected pattern
    expect(createCall[1]).toMatchObject({
      idempotencyKey: expect.stringMatching(/^plan-price:plan-uuid-existing:\d+:\d+$/),
    });

    // Step 2: products.update called with new price as default_price
    expect(mockStripeInstance.products.update).toHaveBeenCalledTimes(1);
    expect(mockStripeInstance.products.update).toHaveBeenCalledWith('prod_existing', {
      default_price: 'price_NEW',
    });

    // Step 3: prices.update called on OLD price to archive it
    expect(mockStripeInstance.prices.update).toHaveBeenCalledTimes(1);
    expect(mockStripeInstance.prices.update).toHaveBeenCalledWith('price_OLD', { active: false });

    // Step 4: plans.save called with updated fields
    expect(plansRepo.save).toHaveBeenCalledTimes(1);
    const saveArg = plansRepo.save.mock.calls[0][0] as Partial<SubscriptionPlan>;
    expect(saveArg.activeStripePriceId).toBe('price_NEW');
    expect(saveArg.unitAmountCents).toBe(1500);

    // Returns updated plan
    expect(result.activeStripePriceId).toBe('price_NEW');
    expect(result.unitAmountCents).toBe(1500);
  });

  // T13 — No plan row → throws 503
  it('T13: no DB row → throws ServiceUnavailableException with SUBSCRIPTION_PLAN_NOT_CONFIGURED', async () => {
    plansRepo.findOne.mockResolvedValue(null);

    await expect(service.updatePlan(1500)).rejects.toThrow(ServiceUnavailableException);

    // Stripe must NOT be called
    expect(mockStripeInstance.prices.create).not.toHaveBeenCalled();
    expect(mockStripeInstance.products.update).not.toHaveBeenCalled();
    expect(mockStripeInstance.prices.update).not.toHaveBeenCalled();
    expect(plansRepo.save).not.toHaveBeenCalled();
  });

  // T13 — prices.create fails → throws 502 and stops further Stripe calls
  it('T13: prices.create failure → throws HttpException 502 SUBSCRIPTION_STRIPE_PRICE_CREATE_FAILED; products.update not called', async () => {
    mockStripeInstance.prices.create.mockRejectedValue(new Error('Stripe network error'));

    await expect(service.updatePlan(1500)).rejects.toThrow(HttpException);

    try {
      await service.updatePlan(1500);
    } catch (err) {
      const httpErr = err as HttpException;
      expect(httpErr.getStatus()).toBe(HttpStatus.BAD_GATEWAY);
      const body = httpErr.getResponse() as Record<string, unknown>;
      expect(body.code).toBe('SUBSCRIPTION_STRIPE_PRICE_CREATE_FAILED');
    }

    expect(mockStripeInstance.products.update).not.toHaveBeenCalled();
    expect(mockStripeInstance.prices.update).not.toHaveBeenCalled();
    expect(plansRepo.save).not.toHaveBeenCalled();
  });

  // T15 — products.update fails → throws 502 with orphan price ID logged
  it('T15: products.update failure → throws HttpException 502 SUBSCRIPTION_STRIPE_PRODUCT_UPDATE_FAILED with orphanPriceId', async () => {
    mockStripeInstance.products.update.mockRejectedValue(new Error('Stripe product error'));

    let caughtError: HttpException | null = null;
    try {
      await service.updatePlan(1500);
    } catch (err) {
      caughtError = err as HttpException;
    }

    expect(caughtError).not.toBeNull();
    expect(caughtError!.getStatus()).toBe(HttpStatus.BAD_GATEWAY);
    const body = caughtError!.getResponse() as Record<string, unknown>;
    expect(body.code).toBe('SUBSCRIPTION_STRIPE_PRODUCT_UPDATE_FAILED');
    // orphanPriceId must reference the newly created price
    expect(body.orphanPriceId).toBe('price_NEW');

    // prices.update(archive) must NOT be called
    expect(mockStripeInstance.prices.update).not.toHaveBeenCalled();
    // plans.save must NOT be called
    expect(plansRepo.save).not.toHaveBeenCalled();
  });

  // T17 — prices.update (archive) fails → TOLERATED; plans.save still called
  it('T17: prices.update (archive) failure → non-blocking; plans.save IS called; returns updated plan', async () => {
    mockStripeInstance.prices.update.mockRejectedValue(new Error('Archive failed'));

    const result = await service.updatePlan(1500);

    // plans.save must still be called
    expect(plansRepo.save).toHaveBeenCalledTimes(1);
    // Returns updated plan despite archive failure
    expect(result.activeStripePriceId).toBe('price_NEW');
    expect(result.unitAmountCents).toBe(1500);
  });

  // T19 — plans.save fails after Stripe success → throws 500 with retry-safe message
  it('T19: plans.save failure after Stripe success → throws HttpException 500 SUBSCRIPTION_PLAN_DB_WRITE_FAILED', async () => {
    plansRepo.save.mockRejectedValue(new Error('DB error'));

    let caughtError: HttpException | null = null;
    try {
      await service.updatePlan(1500);
    } catch (err) {
      caughtError = err as HttpException;
    }

    expect(caughtError).not.toBeNull();
    expect(caughtError!.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    const body = caughtError!.getResponse() as Record<string, unknown>;
    expect(body.code).toBe('SUBSCRIPTION_PLAN_DB_WRITE_FAILED');
    // message must mention retry safety
    expect(String(body.message).toLowerCase()).toMatch(/retry/i);
    // payload must include newStripePriceId
    expect(body.newStripePriceId).toBe('price_NEW');
  });

  // T21 — idempotency key shape
  it('T21: idempotency key on prices.create matches expected pattern /^plan-price:[\\w-]+:\\d+:\\d+$/', async () => {
    await service.updatePlan(1500);

    const createCall = mockStripeInstance.prices.create.mock.calls[0];
    const idempotencyKey = (createCall[1] as { idempotencyKey: string }).idempotencyKey;
    expect(idempotencyKey).toMatch(/^plan-price:[\w-]+:\d+:\d+$/);
  });
});

// ---------------------------------------------------------------------------
// createCheckoutSession — Phase 4 tests (T23)
// ---------------------------------------------------------------------------

describe('SubscriptionService — createCheckoutSession plan source (T23)', () => {
  let service: SubscriptionService;
  let plansRepo: jest.Mocked<Repository<SubscriptionPlan>>;
  let subscriptionsRepo: jest.Mocked<Repository<Subscription>>;
  let usersRepo: jest.Mocked<Repository<User>>;
  let configService: jest.Mocked<ConfigService>;

  function makeRepoMockLocal<T>(): jest.Mocked<Repository<T>> {
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

  beforeEach(async () => {
    mockStripeInstance = createMockStripe();

    plansRepo = makeRepoMockLocal<SubscriptionPlan>();
    subscriptionsRepo = makeRepoMockLocal<Subscription>();
    usersRepo = makeRepoMockLocal<User>();
    configService = {
      get: jest.fn(),
      getOrThrow: jest.fn(),
    } as unknown as jest.Mocked<ConfigService>;

    configService.get.mockImplementation((key: string) => {
      if (key === 'STRIPE_SECRET_KEY') return 'sk_test_dummy';
      if (key === 'STRIPE_SUBSCRIPTION_PRICE_ID') return 'price_test_monthly';
      return undefined;
    });

    // DB row exists so onModuleInit skips seeding
    plansRepo.findOne.mockResolvedValue({
      id: 'plan-uuid-checkout',
      stripeProductId: 'prod_checkout',
      activeStripePriceId: 'price_FROM_DB',
      unitAmountCents: 1000,
      currency: 'usd',
      interval: 'month',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as SubscriptionPlan);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionService,
        { provide: getRepositoryToken(Subscription), useValue: subscriptionsRepo },
        { provide: getRepositoryToken(User), useValue: usersRepo },
        { provide: getRepositoryToken(SubscriptionPlan), useValue: plansRepo },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<SubscriptionService>(SubscriptionService);
    await service.onModuleInit();

    // Reset counts after init; re-stub with the same plan row
    jest.clearAllMocks();
    plansRepo.findOne.mockResolvedValue({
      id: 'plan-uuid-checkout',
      stripeProductId: 'prod_checkout',
      activeStripePriceId: 'price_FROM_DB',
      unitAmountCents: 1000,
      currency: 'usd',
      interval: 'month',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as SubscriptionPlan);

    // isActiveSubscriber: not already subscribed
    const mockQb = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue(undefined),
    };
    subscriptionsRepo.createQueryBuilder.mockReturnValue(mockQb as never);

    // getOrCreateStripeCustomer: user exists, has stripeCustomerId
    usersRepo.findOne.mockResolvedValue({
      id: 'user-1',
      email: 'test@example.com',
      fullName: 'Test User',
      stripeCustomerId: 'cus_test_1',
    } as unknown as User);
  });

  // T23-1: reads activeStripePriceId from DB plan, NOT any in-memory field
  it('T23-1: uses activeStripePriceId from DB plan row in checkout line_items', async () => {
    await service.createCheckoutSession(
      'user-1',
      'https://app.zaz.com/subscription?session=success',
      'https://app.zaz.com/subscription?session=canceled',
    );

    expect(mockStripeInstance.checkout.sessions.create).toHaveBeenCalledTimes(1);
    const createCall = mockStripeInstance.checkout.sessions.create.mock.calls[0][0] as Record<string, unknown>;
    const lineItems = createCall.line_items as Array<{ price: string; quantity: number }>;
    expect(lineItems).toHaveLength(1);
    expect(lineItems[0].price).toBe('price_FROM_DB');
    expect(lineItems[0].quantity).toBe(1);
  });

  // T23-2: no DB row → throws ServiceUnavailableException; sessions.create NOT called
  it('T23-2: throws ServiceUnavailableException when no DB plan row exists', async () => {
    plansRepo.findOne.mockResolvedValue(null);

    await expect(
      service.createCheckoutSession(
        'user-1',
        'https://app.zaz.com/subscription?session=success',
        'https://app.zaz.com/subscription?session=canceled',
      ),
    ).rejects.toThrow(ServiceUnavailableException);

    expect(mockStripeInstance.checkout.sessions.create).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// getAdminPlan — Phase 4 tests (T25)
// ---------------------------------------------------------------------------

describe('SubscriptionService — getAdminPlan (T25)', () => {
  let service: SubscriptionService;
  let plansRepo: jest.Mocked<Repository<SubscriptionPlan>>;
  let subscriptionsRepo: jest.Mocked<Repository<Subscription>>;
  let usersRepo: jest.Mocked<Repository<User>>;
  let configService: jest.Mocked<ConfigService>;

  function makeRepoMockLocal<T>(): jest.Mocked<Repository<T>> {
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

  const fullPlanRow: SubscriptionPlan = {
    id: 'plan-admin-uuid',
    stripeProductId: 'prod_admin_123',
    activeStripePriceId: 'price_admin_abc',
    unitAmountCents: 2000,
    currency: 'usd',
    interval: 'month',
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
    updatedAt: new Date('2025-06-01T00:00:00.000Z'),
  };

  beforeEach(async () => {
    mockStripeInstance = createMockStripe();

    plansRepo = makeRepoMockLocal<SubscriptionPlan>();
    subscriptionsRepo = makeRepoMockLocal<Subscription>();
    usersRepo = makeRepoMockLocal<User>();
    configService = {
      get: jest.fn(),
      getOrThrow: jest.fn(),
    } as unknown as jest.Mocked<ConfigService>;

    configService.get.mockImplementation((key: string) => {
      if (key === 'STRIPE_SECRET_KEY') return 'sk_test_dummy';
      if (key === 'STRIPE_SUBSCRIPTION_PRICE_ID') return 'price_test_monthly';
      return undefined;
    });

    // DB row exists so onModuleInit skips seeding
    plansRepo.findOne.mockResolvedValue({ ...fullPlanRow });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionService,
        { provide: getRepositoryToken(Subscription), useValue: subscriptionsRepo },
        { provide: getRepositoryToken(User), useValue: usersRepo },
        { provide: getRepositoryToken(SubscriptionPlan), useValue: plansRepo },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<SubscriptionService>(SubscriptionService);
    await service.onModuleInit();

    jest.clearAllMocks();
    plansRepo.findOne.mockResolvedValue({ ...fullPlanRow });
  });

  // T25-1: row exists → returns full AdminPlanResponseDto with all fields
  it('T25-1: returns AdminPlanResponseDto with all fields when row exists', async () => {
    const result = await service.getAdminPlan();

    expect(result).not.toBeNull();
    expect(result!.id).toBe('plan-admin-uuid');
    expect(result!.stripeProductId).toBe('prod_admin_123');
    expect(result!.activeStripePriceId).toBe('price_admin_abc');
    expect(result!.unitAmountCents).toBe(2000);
    expect(result!.currency).toBe('usd');
    expect(result!.interval).toBe('month');
    expect(result!.updatedAt).toBeInstanceOf(Date);
  });

  // T25-2: no row → throws ServiceUnavailableException (consistent with getActivePlanRow helper)
  it('T25-2: throws ServiceUnavailableException when no plan row exists', async () => {
    plansRepo.findOne.mockResolvedValue(null);

    await expect(service.getAdminPlan()).rejects.toThrow(ServiceUnavailableException);
  });
});

// ---------------------------------------------------------------------------
// getPlan — Phase 2 tests (T9)
// ---------------------------------------------------------------------------

describe('SubscriptionService — getPlan (T9)', () => {
  let service: SubscriptionService;
  let plansRepo: jest.Mocked<Repository<SubscriptionPlan>>;
  let subscriptionsRepo: jest.Mocked<Repository<Subscription>>;
  let usersRepo: jest.Mocked<Repository<User>>;
  let configService: jest.Mocked<ConfigService>;

  function makeRepoMockLocal<T>(): jest.Mocked<Repository<T>> {
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

  beforeEach(async () => {
    mockStripeInstance = createMockStripe();

    plansRepo = makeRepoMockLocal<SubscriptionPlan>();
    subscriptionsRepo = makeRepoMockLocal<Subscription>();
    usersRepo = makeRepoMockLocal<User>();
    configService = {
      get: jest.fn(),
      getOrThrow: jest.fn(),
    } as unknown as jest.Mocked<ConfigService>;

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
        { provide: getRepositoryToken(SubscriptionPlan), useValue: plansRepo },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<SubscriptionService>(SubscriptionService);
    // Skip onModuleInit to avoid seeding side-effects; just test getPlan directly
  });

  // T9f: getPlan reads from DB row → returns { priceCents, currency, interval }
  it('returns plan DTO from the DB row when one exists', async () => {
    plansRepo.findOne.mockResolvedValue({
      id: 'plan-uuid-1',
      stripeProductId: 'prod_abc',
      activeStripePriceId: 'price_abc',
      unitAmountCents: 1500,
      currency: 'usd',
      interval: 'month',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as SubscriptionPlan);

    const result = await service.getPlan();

    expect(result).not.toBeNull();
    expect(result!.priceCents).toBe(1500);
    expect(result!.currency).toBe('usd');
    expect(result!.interval).toBe('month');
  });

  // T9f triangulation: different price value from DB
  it('returns priceCents matching the stored unitAmountCents regardless of value', async () => {
    plansRepo.findOne.mockResolvedValue({
      id: 'plan-uuid-2',
      stripeProductId: 'prod_xyz',
      activeStripePriceId: 'price_xyz',
      unitAmountCents: 4999,
      currency: 'usd',
      interval: 'month',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as SubscriptionPlan);

    const result = await service.getPlan();

    expect(result).not.toBeNull();
    expect(result!.priceCents).toBe(4999);
  });

  // T9g: no row → returns null (per REQ-4)
  it('returns null when no subscription_plan row exists', async () => {
    plansRepo.findOne.mockResolvedValue(null);

    const result = await service.getPlan();

    expect(result).toBeNull();
  });
});
