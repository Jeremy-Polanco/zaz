/**
 * Unit specs for RentalsService — Phase 3 (T19–T32) + Phase 4 (T33–T48).
 *
 * Stripe is mocked at module level. Repositories and DataSource/ConfigService
 * are injected as jest mocks. No real DB or Stripe connection.
 *
 * TDD pairs (Phase 3):
 *   Pair 1 (T19/T20) — createForOrder happy path
 *   Pair 2 (T21/T22) — activateForOrder happy path
 *   Pair 3 (T23/T24) — activateForOrder Stripe failure → keep pending_setup
 *   Pair 4 (T25/T26) — one active per (userId × productId) pre-check
 *   Pair 5 (T27/T28) — listMine(userId)
 *   Pair 6 (T29/T30) — listAdmin with filters
 *   Pair 7 (T31/T32) — listDelinquent
 *
 * TDD pairs (Phase 4):
 *   Pair 1 (T33/T34) — chargeLateFee happy path (alsoCancel=false)
 *   Pair 2 (T35/T36) — chargeLateFee alsoCancel=true
 *   Pair 3 (T37/T38) — chargeLateFee lateFeeCents=0 → 503
 *   Pair 4 (T39/T40) — chargeLateFee Stripe failure → 502
 *   Pair 5 (T41/T42) — cancelAdmin happy path
 *   Pair 6 (T43/T44) — cancelAdmin idempotent (already canceled)
 *   Pair 7 (T45/T46) — retrySetup happy path
 *   Pair 8 (T47/T48) — retrySetup on non-pending_setup → 409
 */

import { ConflictException, HttpException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager, SelectQueryBuilder } from 'typeorm';
import { RentalsService } from './rentals.service';
import { Rental, RentalStatus } from '../../entities/rental.entity';
import { User } from '../../entities/user.entity';
import { Product } from '../../entities/product.entity';
import { createMockStripe, MockStripe } from '../../test-utils/stripe';

// ---------------------------------------------------------------------------
// Module-level Stripe mock
// ---------------------------------------------------------------------------
jest.mock('stripe', () => {
  const mock = jest.fn().mockImplementation(() => mockStripeInstance);
  (mock as unknown as Record<string, unknown>)['default'] = mock;
  return mock;
});

let mockStripeInstance: MockStripe;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRepoMock<T>() {
  const qb = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([]),
    getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    getCount: jest.fn().mockResolvedValue(0),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    leftJoin: jest.fn().mockReturnThis(),
    setLock: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(null),
    select: jest.fn().mockReturnThis(),
  } as unknown as jest.Mocked<SelectQueryBuilder<T>>;

  return {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    create: jest.fn((dto: Partial<T>) => dto as T),
    upsert: jest.fn(),
    createQueryBuilder: jest.fn().mockReturnValue(qb),
    count: jest.fn(),
    delete: jest.fn(),
    remove: jest.fn(),
    manager: {
      getRepository: jest.fn(),
    },
    _qb: qb,
  };
}

function makeDataSourceMock() {
  const mockEntityManager = {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    createQueryBuilder: jest.fn(),
    getRepository: jest.fn(),
  } as unknown as jest.Mocked<EntityManager>;

  const mockQueryRunner = {
    connect: jest.fn().mockResolvedValue(undefined),
    startTransaction: jest.fn().mockResolvedValue(undefined),
    commitTransaction: jest.fn().mockResolvedValue(undefined),
    rollbackTransaction: jest.fn().mockResolvedValue(undefined),
    release: jest.fn().mockResolvedValue(undefined),
    manager: mockEntityManager,
  };

  return {
    createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner),
    _mockQueryRunner: mockQueryRunner,
    _mockEntityManager: mockEntityManager,
  };
}

function fakeRental(overrides: Partial<Rental> = {}): Rental {
  return {
    id: 'rental-1',
    userId: 'user-1',
    productId: 'product-1',
    orderId: 'order-1',
    stripeSubscriptionId: null,
    stripePriceId: 'price_abc',
    status: RentalStatus.PENDING_SETUP,
    monthlyRentCents: 2000,
    lateFeeCents: 500,
    theftFeeCents: 0,
    theftFeeChargedAt: null,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    activatedAt: null,
    canceledAt: null,
    pastDueSince: null,
    lastLateFeeAt: null,
    createdAt: new Date('2024-01-01T10:00:00Z'),
    updatedAt: new Date('2024-01-01T10:00:00Z'),
    user: {} as User,
    product: {} as Product,
    order: null,
    ...overrides,
  } as Rental;
}

function fakeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    fullName: 'Test User',
    phone: '+1234567890',
    email: 'test@test.com',
    stripeCustomerId: 'cus_test_user',
    role: 'client' as any,
    ...overrides,
  } as User;
}

function fakeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'product-1',
    name: 'Water Dispenser',
    pricingMode: 'rental' as any,
    monthlyRentCents: 2000,
    lateFeeCents: 500,
    theftFeeCents: 0,
    stripePriceId: 'price_abc',
    stripeProductId: 'prod_abc',
    priceToPublic: '100.00',
    isAvailable: true,
    stock: 5,
    ...overrides,
  } as Product;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('RentalsService', () => {
  let service: RentalsService;
  let rentalRepo: ReturnType<typeof makeRepoMock>;
  let userRepo: ReturnType<typeof makeRepoMock>;
  let productRepo: ReturnType<typeof makeRepoMock>;
  let dataSource: ReturnType<typeof makeDataSourceMock>;

  beforeEach(async () => {
    mockStripeInstance = createMockStripe();

    rentalRepo = makeRepoMock<Rental>();
    userRepo = makeRepoMock<User>();
    productRepo = makeRepoMock<Product>();
    dataSource = makeDataSourceMock();

    // Default: entity manager save returns the object it receives (with an id)
    dataSource._mockEntityManager.save.mockImplementation(async (entity: unknown) => {
      if (typeof entity === 'object' && entity !== null && !('id' in entity)) {
        (entity as Record<string, unknown>)['id'] = 'rental-new-1';
      }
      return entity;
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RentalsService,
        { provide: getRepositoryToken(Rental), useValue: rentalRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(Product), useValue: productRepo },
        { provide: DataSource, useValue: dataSource },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('sk_test_stripe_key'),
          },
        },
      ],
    }).compile();

    service = module.get<RentalsService>(RentalsService);
    await service.onModuleInit();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Pair 1 (T19) — createForOrder happy path
  // ─────────────────────────────────────────────────────────────────────────

  describe('createForOrder', () => {
    it('T19: inserts Rental row with status=pending_setup, snapshots pricing, no Stripe call', async () => {
      const userId = 'user-1';
      const productId = 'product-1';
      const orderId = 'order-1';
      const product = fakeProduct({ id: productId, pricingMode: 'rental' as any, monthlyRentCents: 2000, lateFeeCents: 500, stripePriceId: 'price_abc' });

      // No active rental already
      rentalRepo.findOne.mockResolvedValue(null);

      const savedRental = fakeRental({
        userId,
        productId,
        orderId,
        status: RentalStatus.PENDING_SETUP,
        monthlyRentCents: 2000,
        lateFeeCents: 500,
        stripePriceId: 'price_abc',
      });

      dataSource._mockEntityManager.findOne.mockResolvedValueOnce(null); // no active rental check
      dataSource._mockEntityManager.save.mockResolvedValueOnce(savedRental);

      const result = await service.createForOrder({ userId, productId, orderId, product });

      // Should return the saved rental
      expect(result).toBeDefined();
      expect(result.status).toBe(RentalStatus.PENDING_SETUP);
      expect(result.monthlyRentCents).toBe(2000);
      expect(result.lateFeeCents).toBe(500);
      expect(result.stripePriceId).toBe('price_abc');
      expect(result.orderId).toBe(orderId);
      expect(result.userId).toBe(userId);
      expect(result.productId).toBe(productId);

      // No Stripe call
      expect(mockStripeInstance.subscriptions.create).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Pair 2 (T21) — activateForOrder happy path
  // ─────────────────────────────────────────────────────────────────────────

  describe('activateForOrder', () => {
    it('T21: calls stripe.subscriptions.create OUTSIDE TX, updates rental to active on success', async () => {
      const user = fakeUser({ id: 'user-1', stripeCustomerId: 'cus_abc' });
      const rental = fakeRental({
        id: 'rental-abc',
        userId: 'user-1',
        productId: 'product-1',
        orderId: 'order-1',
        status: RentalStatus.PENDING_SETUP,
        stripePriceId: 'price_abc',
      });

      const now = Math.floor(Date.now() / 1000);
      const thirtyDaysFromNow = now + 30 * 86400;

      const stripeSubResponse = {
        id: 'sub_new_123',
        status: 'trialing',
        current_period_start: now,
        current_period_end: thirtyDaysFromNow,
        items: { data: [{ current_period_start: now, current_period_end: thirtyDaysFromNow }] },
        cancel_at_period_end: false,
        canceled_at: null,
        metadata: { rentalId: 'rental-abc', userId: 'user-1', productId: 'product-1' },
      };

      mockStripeInstance.subscriptions.create.mockResolvedValueOnce(stripeSubResponse);

      // Mock repo lookups: rental found, user found
      rentalRepo.findOne.mockResolvedValueOnce(rental); // find rental
      userRepo.findOne.mockResolvedValueOnce(user);     // find user for stripeCustomerId
      rentalRepo.save.mockResolvedValueOnce({
        ...rental,
        status: RentalStatus.ACTIVE,
        stripeSubscriptionId: 'sub_new_123',
        activatedAt: new Date(),
        currentPeriodStart: new Date(now * 1000),
        currentPeriodEnd: new Date(thirtyDaysFromNow * 1000),
      });

      const result = await service.activateForOrder('rental-abc');

      // Stripe subscriptions.create called with correct params
      expect(mockStripeInstance.subscriptions.create).toHaveBeenCalledTimes(1);
      const stripeCall = mockStripeInstance.subscriptions.create.mock.calls[0][0] as Record<string, unknown>;
      expect(stripeCall['customer']).toBe('cus_abc');
      expect(stripeCall['items']).toEqual([{ price: 'price_abc' }]);
      expect((stripeCall['metadata'] as Record<string, string>)['rentalId']).toBe('rental-abc');
      expect((stripeCall['metadata'] as Record<string, string>)['userId']).toBe('user-1');
      expect((stripeCall['metadata'] as Record<string, string>)['productId']).toBe('product-1');
      expect(stripeCall['proration_behavior']).toBe('none');

      // trial_end is ~30 days out (first charge next month — no double-charge).
      const trialEnd = stripeCall['trial_end'] as number;
      const expectedTrialEnd = Math.floor(Date.now() / 1000) + 30 * 86400;
      expect(Math.abs(trialEnd - expectedTrialEnd)).toBeLessThan(5); // within 5 seconds

      // billing_cycle_anchor must NOT be sent: with a trial + proration_behavior
      // 'none', Stripe rejects an explicit anchor ("anchored invoice must be
      // prorated"). The trial alone anchors the first billing cycle.
      expect(stripeCall['billing_cycle_anchor']).toBeUndefined();

      // Result rental should be active
      expect(result.status).toBe(RentalStatus.ACTIVE);
      expect(result.stripeSubscriptionId).toBe('sub_new_123');
      expect(result.activatedAt).toBeInstanceOf(Date);
      expect(result.currentPeriodStart).toBeInstanceOf(Date);
      expect(result.currentPeriodEnd).toBeInstanceOf(Date);
    });

    it('T21: idempotency key is rental-setup-{rentalId}-{trialEnd} (retry-safe)', async () => {
      const user = fakeUser({ stripeCustomerId: 'cus_abc' });
      const rental = fakeRental({ id: 'rental-xyz', status: RentalStatus.PENDING_SETUP });

      rentalRepo.findOne.mockResolvedValueOnce(rental);
      userRepo.findOne.mockResolvedValueOnce(user);
      rentalRepo.save.mockResolvedValueOnce({ ...rental, status: RentalStatus.ACTIVE, stripeSubscriptionId: 'sub_x' });

      await service.activateForOrder('rental-xyz');

      // The key includes the trial_end so a later retry (with a fresh trial_end)
      // gets a NEW key instead of colliding with a poisoned one.
      const stripeCall = mockStripeInstance.subscriptions.create.mock.calls[0][0] as Record<string, unknown>;
      const trialEnd = stripeCall['trial_end'] as number;
      const callOptions = mockStripeInstance.subscriptions.create.mock.calls[0][1] as Record<string, unknown>;
      expect(callOptions?.['idempotencyKey']).toBe(`rental-setup-rental-xyz-${trialEnd}`);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // maintenance timer disable flag (per-user)
  // ─────────────────────────────────────────────────────────────────────────

  describe('maintenance timer — per-user disable flag', () => {
    function activationSetup(user: User, product: Product) {
      const rental = fakeRental({
        id: 'rental-mt',
        userId: user.id,
        productId: product.id,
        status: RentalStatus.PENDING_SETUP,
        nextMaintenanceAt: null,
      });
      rentalRepo.findOne.mockResolvedValueOnce(rental);
      userRepo.findOne.mockResolvedValueOnce(user);
      productRepo.findOne.mockResolvedValueOnce(product);
      mockStripeInstance.subscriptions.create.mockResolvedValueOnce({
        id: 'sub_mt',
        status: 'trialing',
        current_period_start: Math.floor(Date.now() / 1000),
        current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
        items: { data: [] },
        metadata: {},
      });
      let saved: Rental | undefined;
      (rentalRepo.save as jest.Mock).mockImplementationOnce(async (r: Rental) => {
        saved = r;
        return r;
      });
      return () => saved;
    }

    it('starts the 30-day timer on a bebedero when the user has NOT disabled it', async () => {
      const getSaved = activationSetup(
        fakeUser({ id: 'u1', stripeCustomerId: 'cus_1', maintenanceTimerDisabled: false }),
        fakeProduct({ id: 'prod-beb', requiresMaintenance: true } as Partial<Product>),
      );

      await service.activateForOrder('rental-mt');

      expect(getSaved()?.nextMaintenanceAt).toBeInstanceOf(Date);
    });

    it('does NOT start the timer when the user has it disabled', async () => {
      const getSaved = activationSetup(
        fakeUser({ id: 'u2', stripeCustomerId: 'cus_2', maintenanceTimerDisabled: true }),
        fakeProduct({ id: 'prod-beb', requiresMaintenance: true } as Partial<Product>),
      );

      await service.activateForOrder('rental-mt');

      expect(getSaved()?.nextMaintenanceAt ?? null).toBeNull();
    });

    it('resetMaintenanceForUser is a no-op when the user has the timer disabled', async () => {
      userRepo.findOne.mockResolvedValueOnce(
        fakeUser({ id: 'u3', maintenanceTimerDisabled: true }),
      );

      const reset = await service.resetMaintenanceForUser('u3');

      expect(reset).toBe(0);
      expect(rentalRepo.find).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Pair 3 (T23) — activateForOrder Stripe failure → keep pending_setup
  // ─────────────────────────────────────────────────────────────────────────

  describe('activateForOrder — Stripe failure', () => {
    it('T23: Stripe failure → rental stays pending_setup, no error thrown', async () => {
      const user = fakeUser({ stripeCustomerId: 'cus_abc' });
      const rental = fakeRental({ id: 'rental-fail', status: RentalStatus.PENDING_SETUP });

      rentalRepo.findOne.mockResolvedValueOnce(rental);
      userRepo.findOne.mockResolvedValueOnce(user);
      mockStripeInstance.subscriptions.create.mockRejectedValueOnce(new Error('Stripe connection error'));

      // Should NOT throw
      const result = await service.activateForOrder('rental-fail');

      // Rental status is unchanged (pending_setup)
      expect(result.status).toBe(RentalStatus.PENDING_SETUP);
      expect(result.stripeSubscriptionId).toBeNull();

      // rentalRepo.save should NOT have been called with status=active
      const saveCalls = rentalRepo.save.mock.calls;
      const activeSaveCalls = saveCalls.filter((args) => {
        const entity = args[0] as Partial<Rental>;
        return entity.status === RentalStatus.ACTIVE;
      });
      expect(activeSaveCalls).toHaveLength(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Pair 4 (T25) — One active per (userId × productId) pre-check
  // ─────────────────────────────────────────────────────────────────────────

  describe('createForOrder — duplicate active rental', () => {
    it('T25: throws 409 RENTAL_ALREADY_ACTIVE if user already has active rental for product', async () => {
      const existingActiveRental = fakeRental({ status: RentalStatus.ACTIVE });

      // Mock the entity manager findOne to return an existing active rental (inside TX)
      dataSource._mockEntityManager.findOne.mockResolvedValueOnce(existingActiveRental);

      await expect(
        service.createForOrder({
          userId: 'user-1',
          productId: 'product-1',
          orderId: 'order-new',
          product: fakeProduct(),
        }),
      ).rejects.toThrow(ConflictException);

      // No DB insert
      expect(dataSource._mockEntityManager.save).not.toHaveBeenCalled();
    });

    it('T25b: status=canceled → ALLOWED, creates new pending_setup row', async () => {
      // No active/pending rental found
      dataSource._mockEntityManager.findOne.mockResolvedValueOnce(null);

      const savedRental = fakeRental({ status: RentalStatus.PENDING_SETUP });
      dataSource._mockEntityManager.save.mockResolvedValueOnce(savedRental);

      const result = await service.createForOrder({
        userId: 'user-1',
        productId: 'product-1',
        orderId: 'order-new-2',
        product: fakeProduct(),
      });

      expect(result.status).toBe(RentalStatus.PENDING_SETUP);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Pair 5 (T27) — listMine(userId)
  // ─────────────────────────────────────────────────────────────────────────

  describe('ensureBebederoRatePrices', () => {
    it('reuses the existing subscriber price when its amount matches the requested plan price', async () => {
      mockStripeInstance.prices.list.mockResolvedValueOnce({
        data: [
          { id: 'price_free_existing', lookup_key: 'bebedero_free_monthly', unit_amount: 0 },
          {
            id: 'price_sub_existing',
            lookup_key: 'bebedero_subscriber_monthly',
            unit_amount: 699,
          },
        ],
      });

      const result = await service.ensureBebederoRatePrices(699);

      expect(result).toEqual({
        freePriceId: 'price_free_existing',
        subscriberPriceId: 'price_sub_existing',
      });
      expect(mockStripeInstance.prices.create).not.toHaveBeenCalled();
      expect(mockStripeInstance.products.create).not.toHaveBeenCalled();
    });

    it('regenerates the subscriber price when the subscription price changed, transferring the lookup_key and archiving the stale price', async () => {
      // Existing subscriber price is $6.99 but the plan now charges $12.99.
      mockStripeInstance.prices.list.mockResolvedValueOnce({
        data: [
          { id: 'price_free_existing', lookup_key: 'bebedero_free_monthly', unit_amount: 0 },
          {
            id: 'price_sub_stale',
            lookup_key: 'bebedero_subscriber_monthly',
            unit_amount: 699,
          },
        ],
      });
      mockStripeInstance.products.create.mockResolvedValueOnce({ id: 'prod_rate' });
      mockStripeInstance.prices.create.mockResolvedValueOnce({ id: 'price_sub_1299' });

      const result = await service.ensureBebederoRatePrices(1299);

      expect(result).toEqual({
        freePriceId: 'price_free_existing',
        subscriberPriceId: 'price_sub_1299',
      });
      // New price created at the live plan amount, moving the lookup_key onto it.
      expect(mockStripeInstance.prices.create).toHaveBeenCalledWith(
        expect.objectContaining({
          unit_amount: 1299,
          currency: 'usd',
          recurring: { interval: 'month' },
          lookup_key: 'bebedero_subscriber_monthly',
          transfer_lookup_key: true,
        }),
        expect.any(Object),
      );
      // Stale price archived (deactivated) so it can no longer be billed.
      expect(mockStripeInstance.prices.update).toHaveBeenCalledWith('price_sub_stale', {
        active: false,
      });
    });

    it('creates the $0 free price and the subscriber price at the requested amount when both are missing', async () => {
      mockStripeInstance.prices.list.mockResolvedValueOnce({ data: [] });
      mockStripeInstance.products.create.mockResolvedValueOnce({ id: 'prod_rate' });
      mockStripeInstance.prices.create
        .mockResolvedValueOnce({ id: 'price_free_new' })
        .mockResolvedValueOnce({ id: 'price_sub_new' });

      const result = await service.ensureBebederoRatePrices(1299);

      expect(result).toEqual({
        freePriceId: 'price_free_new',
        subscriberPriceId: 'price_sub_new',
      });
      expect(mockStripeInstance.prices.create).toHaveBeenCalledWith(
        expect.objectContaining({
          unit_amount: 0,
          currency: 'usd',
          recurring: { interval: 'month' },
          lookup_key: 'bebedero_free_monthly',
        }),
        expect.any(Object),
      );
      expect(mockStripeInstance.prices.create).toHaveBeenCalledWith(
        expect.objectContaining({
          unit_amount: 1299,
          currency: 'usd',
          recurring: { interval: 'month' },
          lookup_key: 'bebedero_subscriber_monthly',
        }),
        expect.any(Object),
      );
    });

    it('caches per amount — a second call at the same amount does not hit Stripe; a different amount re-resolves', async () => {
      mockStripeInstance.prices.list.mockResolvedValue({
        data: [
          { id: 'price_free_existing', lookup_key: 'bebedero_free_monthly', unit_amount: 0 },
          {
            id: 'price_sub_existing',
            lookup_key: 'bebedero_subscriber_monthly',
            unit_amount: 699,
          },
        ],
      });

      await service.ensureBebederoRatePrices(699);
      await service.ensureBebederoRatePrices(699);
      expect(mockStripeInstance.prices.list).toHaveBeenCalledTimes(1);

      // A different plan amount must bypass the cache and re-resolve.
      mockStripeInstance.products.create.mockResolvedValueOnce({ id: 'prod_rate' });
      mockStripeInstance.prices.create.mockResolvedValueOnce({ id: 'price_sub_999' });
      await service.ensureBebederoRatePrices(999);
      expect(mockStripeInstance.prices.list).toHaveBeenCalledTimes(2);
    });
  });

  describe('countBebederoRentalsForUser', () => {
    it('counts the user\'s lifetime bebedero rentals via product join (any status)', async () => {
      (rentalRepo._qb.getCount as jest.Mock).mockResolvedValueOnce(2);

      const count = await service.countBebederoRentalsForUser('user-7');

      expect(count).toBe(2);
      expect(rentalRepo.createQueryBuilder).toHaveBeenCalledWith('rental');
      expect(rentalRepo._qb.innerJoin).toHaveBeenCalledWith(
        'rental.product',
        'product',
      );
      expect(rentalRepo._qb.where).toHaveBeenCalledWith('rental.userId = :userId', {
        userId: 'user-7',
      });
      expect(rentalRepo._qb.andWhere).toHaveBeenCalledWith(
        'product.requiresMaintenance = true',
      );
    });

    it('returns 0 when the user has never rented a bebedero', async () => {
      (rentalRepo._qb.getCount as jest.Mock).mockResolvedValueOnce(0);
      const count = await service.countBebederoRentalsForUser('user-new');
      expect(count).toBe(0);
    });
  });

  describe('listMine', () => {
    it('T27: returns only user A rentals ordered by activatedAt DESC', async () => {
      const userAId = 'user-A';
      const userBId = 'user-B';
      const now = new Date();
      const earlier = new Date(now.getTime() - 86400 * 1000);

      const rentalA1 = fakeRental({
        id: 'r-a-1', userId: userAId, productId: 'p-1',
        status: RentalStatus.ACTIVE,
        activatedAt: now,
        product: fakeProduct({ id: 'p-1', name: 'Dispenser', stripePriceId: 'price_p1' }),
      });
      const rentalA2 = fakeRental({
        id: 'r-a-2', userId: userAId, productId: 'p-2',
        status: RentalStatus.PAST_DUE,
        activatedAt: earlier,
        product: fakeProduct({ id: 'p-2', name: 'Machine', stripePriceId: 'price_p2' }),
      });

      rentalRepo.find.mockResolvedValueOnce([rentalA1, rentalA2]);

      const result = await service.listMine(userAId);

      // Only user A's rentals
      expect(result).toHaveLength(2);
      result.forEach((dto) => {
        // These are CustomerRentalResponseDtos
        expect(dto.id).toBeDefined();
      });

      // Verify find was called with the right userId
      expect(rentalRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: userAId }),
        }),
      );

      // Isolation: User B's rentals not returned
      const ids = result.map((d) => d.id);
      expect(ids).not.toContain('r-b-1');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Pair 6 (T29) — listAdmin with filters
  // ─────────────────────────────────────────────────────────────────────────

  describe('listAdmin', () => {
    it('T29a: no filters → returns all rentals with pagination defaults', async () => {
      const rentals = [fakeRental({ id: 'r1' }), fakeRental({ id: 'r2' })];
      const qb = rentalRepo._qb;
      (qb.getManyAndCount as jest.Mock).mockResolvedValueOnce([rentals, 2]);

      const result = await service.listAdmin({});

      expect(result.total).toBe(2);
      expect(result.items).toHaveLength(2);
    });

    it('T29b: status filter → andWhere called with status condition', async () => {
      const qb = rentalRepo._qb;
      (qb.getManyAndCount as jest.Mock).mockResolvedValueOnce([[fakeRental({ status: RentalStatus.ACTIVE })], 1]);

      const result = await service.listAdmin({ status: [RentalStatus.ACTIVE] });

      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('status'),
        expect.objectContaining({ statuses: [RentalStatus.ACTIVE] }),
      );
      expect(result.items).toHaveLength(1);
    });

    it('T29c: userId filter → andWhere called with userId', async () => {
      const qb = rentalRepo._qb;
      (qb.getManyAndCount as jest.Mock).mockResolvedValueOnce([[fakeRental({ userId: 'user-X' })], 1]);

      await service.listAdmin({ userId: 'user-X' });

      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('userId'),
        expect.objectContaining({ userId: 'user-X' }),
      );
    });

    it('T29d: productId filter → andWhere called with productId', async () => {
      const qb = rentalRepo._qb;
      (qb.getManyAndCount as jest.Mock).mockResolvedValueOnce([[fakeRental({ productId: 'product-Y' })], 1]);

      await service.listAdmin({ productId: 'product-Y' });

      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('productId'),
        expect.objectContaining({ productId: 'product-Y' }),
      );
    });

    it('T29e: pagination → skip and take computed from page/pageSize', async () => {
      const qb = rentalRepo._qb;
      (qb.getManyAndCount as jest.Mock).mockResolvedValueOnce([[], 0]);

      await service.listAdmin({ page: 2, pageSize: 10 });

      expect(qb.skip).toHaveBeenCalledWith(10); // page=2, pageSize=10 → skip=10
      expect(qb.take).toHaveBeenCalledWith(10);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Pair 7 (T31) — listDelinquent
  // ─────────────────────────────────────────────────────────────────────────

  describe('listDelinquent', () => {
    it('T31a: past_due rental with currentPeriodEnd < NOW is included', async () => {
      const pastPeriodEnd = new Date(Date.now() - 2 * 86400 * 1000); // 2 days ago
      const delinquent = fakeRental({
        id: 'r-delinquent',
        status: RentalStatus.PAST_DUE,
        currentPeriodEnd: pastPeriodEnd,
      });

      const qb = rentalRepo._qb;
      (qb.getMany as jest.Mock).mockResolvedValueOnce([delinquent]);

      const result = await service.listDelinquent();

      expect(result.some((r) => r.id === 'r-delinquent')).toBe(true);
    });

    it('T31b: pending_setup created >24h ago is included', async () => {
      const oldCreatedAt = new Date(Date.now() - 25 * 3600 * 1000); // 25h ago
      const stale = fakeRental({
        id: 'r-stale-setup',
        status: RentalStatus.PENDING_SETUP,
        createdAt: oldCreatedAt,
      });

      const qb = rentalRepo._qb;
      (qb.getMany as jest.Mock).mockResolvedValueOnce([stale]);

      const result = await service.listDelinquent();

      expect(result.some((r) => r.id === 'r-stale-setup')).toBe(true);
    });

    it('T31c: canceled rental is excluded (query uses WHERE clause)', async () => {
      // The query filters by status — canceled never returned
      const qb = rentalRepo._qb;
      (qb.getMany as jest.Mock).mockResolvedValueOnce([]); // no results

      const result = await service.listDelinquent();

      expect(result).toHaveLength(0);

      // Verify the query builder used andWhere with the right condition
      expect(qb.where).toHaveBeenCalled();
    });

    it('T31d: pending_setup created <24h ago is excluded via WHERE', async () => {
      // Service should build a WHERE clause that excludes fresh pending_setup
      const qb = rentalRepo._qb;
      (qb.getMany as jest.Mock).mockResolvedValueOnce([]); // filtered out at DB level

      const result = await service.listDelinquent();

      expect(result).toHaveLength(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 4 — admin actions
  // ─────────────────────────────────────────────────────────────────────────

  // ─────────────────────────────────────────────────────────────────────────
  // Pair 1 (T33) — chargeLateFee happy path (alsoCancel=false)
  // ─────────────────────────────────────────────────────────────────────────

  describe('chargeLateFee', () => {
    it('T33: alsoCancel=false — creates PaymentIntent, returns ChargeLateFeeResponse, rental unchanged', async () => {
      const rental = fakeRental({
        id: 'rental-1',
        userId: 'user-1',
        lateFeeCents: 500,
        status: RentalStatus.ACTIVE,
        stripeSubscriptionId: 'sub_abc',
      });
      const user = fakeUser({ id: 'user-1', stripeCustomerId: 'cus_abc' });

      rentalRepo.findOne.mockResolvedValueOnce(rental);
      userRepo.findOne.mockResolvedValueOnce(user);

      const piResponse = {
        id: 'pi_late_fee_123',
        status: 'succeeded',
        amount: 500,
        currency: 'usd',
      };
      mockStripeInstance.paymentIntents.create.mockResolvedValueOnce(piResponse);

      const result = await service.chargeLateFee('rental-1', false);

      // PaymentIntent created with correct params
      expect(mockStripeInstance.paymentIntents.create).toHaveBeenCalledTimes(1);
      const piCall = mockStripeInstance.paymentIntents.create.mock.calls[0][0] as Record<string, unknown>;
      expect(piCall['customer']).toBe('cus_abc');
      expect(piCall['amount']).toBe(500);
      expect(piCall['currency']).toBe('usd');
      expect(piCall['off_session']).toBe(true);
      expect(piCall['confirm']).toBe(true);
      const metadata = piCall['metadata'] as Record<string, string>;
      expect(metadata['kind']).toBe('rental_late_fee');
      expect(metadata['rentalId']).toBe('rental-1');

      // Day-keyed idempotency key: late-fee-{rentalId}-{YYYY-MM-DD}
      const piCallOptions = mockStripeInstance.paymentIntents.create.mock.calls[0][1] as Record<string, unknown>;
      const todayStr = new Date().toISOString().slice(0, 10);
      expect(piCallOptions?.['idempotencyKey']).toBe(`late-fee-rental-1-${todayStr}`);

      // Return value
      expect(result.chargedCents).toBe(500);
      expect(result.paymentIntentId).toBe('pi_late_fee_123');
      expect(result.subscriptionCanceled).toBe(false);

      // subscriptions.cancel NOT called
      expect(mockStripeInstance.subscriptions.cancel).not.toHaveBeenCalled();

      // T5.6: lastLateFeeAt must be set on the rental after PI success
      expect(rentalRepo.save).toHaveBeenCalledTimes(1);
      const savedArg = rentalRepo.save.mock.calls[0][0] as Partial<Rental>;
      expect(savedArg.lastLateFeeAt).toBeInstanceOf(Date);
    });

    // ─────────────────────────────────────────────────────────────────────────
    // T5.6 — chargeLateFee sets lastLateFeeAt on Stripe success
    // ─────────────────────────────────────────────────────────────────────────

    it('T5.6: chargeLateFee sets rental.lastLateFeeAt = new Date() on successful Stripe charge', async () => {
      const before = new Date();
      const rental = fakeRental({
        id: 'rental-lf',
        userId: 'user-1',
        lateFeeCents: 500,
        status: RentalStatus.PAST_DUE,
        lastLateFeeAt: null,
      });
      const user = fakeUser({ id: 'user-1', stripeCustomerId: 'cus_lf' });

      rentalRepo.findOne.mockResolvedValueOnce(rental);
      userRepo.findOne.mockResolvedValueOnce(user);
      mockStripeInstance.paymentIntents.create.mockResolvedValueOnce({
        id: 'pi_lf_test',
        status: 'succeeded',
        amount: 500,
      });
      rentalRepo.save.mockResolvedValueOnce({ ...rental, lastLateFeeAt: new Date() });

      await service.chargeLateFee('rental-lf', false);

      // Must save rental with a recent lastLateFeeAt
      expect(rentalRepo.save).toHaveBeenCalledTimes(1);
      const savedArg = rentalRepo.save.mock.calls[0][0] as Partial<Rental>;
      expect(savedArg.lastLateFeeAt).toBeInstanceOf(Date);
      const after = new Date();
      expect(savedArg.lastLateFeeAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(savedArg.lastLateFeeAt!.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Pair 2 (T35) — chargeLateFee alsoCancel=true
    // ─────────────────────────────────────────────────────────────────────────

    it('T35: alsoCancel=true — PI succeeds, subscriptions.cancel called, rental.status=canceled', async () => {
      const rental = fakeRental({
        id: 'rental-2',
        userId: 'user-1',
        lateFeeCents: 500,
        status: RentalStatus.PAST_DUE,
        stripeSubscriptionId: 'sub_def',
      });
      const user = fakeUser({ id: 'user-1', stripeCustomerId: 'cus_abc' });

      // chargeLateFee calls findOne once for the rental, then userRepo.findOne for user
      // then calls cancelAdmin internally which also calls findOne (rental with relations)
      rentalRepo.findOne
        .mockResolvedValueOnce(rental)   // chargeLateFee's initial load
        .mockResolvedValueOnce({ ...rental, user: { fullName: 'Test User', phone: '+1' } as User, product: { name: 'Dispenser' } as Product }); // cancelAdmin's load
      userRepo.findOne.mockResolvedValueOnce(user);

      mockStripeInstance.paymentIntents.create.mockResolvedValueOnce({
        id: 'pi_late_fee_456',
        status: 'succeeded',
        amount: 500,
      });

      // T5.6: chargeLateFee now saves lastLateFeeAt FIRST, then cancelAdmin saves CANCELED.
      const rentalWithLateFee = { ...rental, lastLateFeeAt: new Date() };
      const canceledRental = { ...rental, status: RentalStatus.CANCELED, canceledAt: new Date() };
      rentalRepo.save
        .mockResolvedValueOnce(rentalWithLateFee)  // first save: lastLateFeeAt
        .mockResolvedValueOnce(canceledRental);     // second save: cancelAdmin CANCELED

      const result = await service.chargeLateFee('rental-2', true);

      // PI created
      expect(mockStripeInstance.paymentIntents.create).toHaveBeenCalledTimes(1);

      // subscriptions.cancel called with invoice_now: false
      expect(mockStripeInstance.subscriptions.cancel).toHaveBeenCalledTimes(1);
      const cancelCall = mockStripeInstance.subscriptions.cancel.mock.calls[0];
      expect(cancelCall[0]).toBe('sub_def');
      expect((cancelCall[1] as Record<string, unknown>)['invoice_now']).toBe(false);

      // Two saves total: first for lastLateFeeAt, second for CANCELED in cancelAdmin
      expect(rentalRepo.save).toHaveBeenCalledTimes(2);
      // First save: lastLateFeeAt set
      const firstSaveArg = rentalRepo.save.mock.calls[0][0] as Partial<Rental>;
      expect(firstSaveArg.lastLateFeeAt).toBeInstanceOf(Date);
      // Second save: status=CANCELED from cancelAdmin
      const secondSaveArg = rentalRepo.save.mock.calls[1][0] as Partial<Rental>;
      expect(secondSaveArg.status).toBe(RentalStatus.CANCELED);
      expect(secondSaveArg.canceledAt).toBeInstanceOf(Date);

      // Return value
      expect(result.paymentIntentId).toBe('pi_late_fee_456');
      expect(result.subscriptionCanceled).toBe(true);
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Pair 3 (T37) — chargeLateFee lateFeeCents=0 → 503
    // ─────────────────────────────────────────────────────────────────────────

    it('T37: lateFeeCents=0 → throws 503 LATE_FEE_NOT_CONFIGURED, Stripe NOT called', async () => {
      const rental = fakeRental({ id: 'rental-3', lateFeeCents: 0, status: RentalStatus.ACTIVE });
      rentalRepo.findOne.mockResolvedValueOnce(rental);

      await expect(service.chargeLateFee('rental-3', false)).rejects.toMatchObject({ status: 503 });

      // Stripe NOT called
      expect(mockStripeInstance.paymentIntents.create).not.toHaveBeenCalled();
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Pair 4 (T39) — chargeLateFee Stripe failure → 502
    // ─────────────────────────────────────────────────────────────────────────

    it('T39: Stripe PI create fails → throws 502 STRIPE_PAYMENT_FAILED', async () => {
      const rental = fakeRental({ id: 'rental-4', lateFeeCents: 500, status: RentalStatus.PAST_DUE });
      const user = fakeUser({ stripeCustomerId: 'cus_abc' });

      rentalRepo.findOne.mockResolvedValueOnce(rental);
      userRepo.findOne.mockResolvedValueOnce(user);
      mockStripeInstance.paymentIntents.create.mockRejectedValueOnce(new Error('card_declined'));

      await expect(service.chargeLateFee('rental-4', false)).rejects.toMatchObject({ status: 502 });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // chargeTheftFee — one-time replacement/theft penalty (off-session)
  //
  // Mirrors chargeLateFee but: charges rental.theftFeeCents, metadata kind
  // 'rental_theft_fee', and is GUARDED to charge at most once (theftFeeChargedAt).
  // ─────────────────────────────────────────────────────────────────────────

  describe('chargeTheftFee', () => {
    it('alsoCancel=false — charges theftFeeCents off-session, stamps theftFeeChargedAt, returns response', async () => {
      const rental = fakeRental({
        id: 'rental-t1',
        userId: 'user-1',
        theftFeeCents: 8000,
        theftFeeChargedAt: null,
        status: RentalStatus.PAST_DUE,
        stripeSubscriptionId: 'sub_abc',
      });
      const user = fakeUser({ id: 'user-1', stripeCustomerId: 'cus_abc' });

      rentalRepo.findOne.mockResolvedValueOnce(rental);
      userRepo.findOne.mockResolvedValueOnce(user);
      mockStripeInstance.paymentIntents.create.mockResolvedValueOnce({
        id: 'pi_theft_123',
        status: 'succeeded',
        amount: 8000,
      });

      const result = await service.chargeTheftFee('rental-t1', false);

      expect(mockStripeInstance.paymentIntents.create).toHaveBeenCalledTimes(1);
      const piCall = mockStripeInstance.paymentIntents.create.mock.calls[0][0] as Record<string, unknown>;
      expect(piCall['customer']).toBe('cus_abc');
      expect(piCall['amount']).toBe(8000);
      expect(piCall['off_session']).toBe(true);
      expect(piCall['confirm']).toBe(true);
      const metadata = piCall['metadata'] as Record<string, string>;
      expect(metadata['kind']).toBe('rental_theft_fee');
      expect(metadata['rentalId']).toBe('rental-t1');

      // Idempotency key is stable per rental (one-time charge).
      const piOpts = mockStripeInstance.paymentIntents.create.mock.calls[0][1] as Record<string, unknown>;
      expect(piOpts?.['idempotencyKey']).toBe('theft-fee-rental-t1');

      expect(result.chargedCents).toBe(8000);
      expect(result.paymentIntentId).toBe('pi_theft_123');
      expect(result.subscriptionCanceled).toBe(false);
      expect(mockStripeInstance.subscriptions.cancel).not.toHaveBeenCalled();

      // theftFeeChargedAt stamped on success
      expect(rentalRepo.save).toHaveBeenCalledTimes(1);
      const savedArg = rentalRepo.save.mock.calls[0][0] as Partial<Rental>;
      expect(savedArg.theftFeeChargedAt).toBeInstanceOf(Date);
    });

    it('alsoCancel=true — charges then cancels the rental', async () => {
      const rental = fakeRental({
        id: 'rental-t2',
        userId: 'user-1',
        theftFeeCents: 8000,
        status: RentalStatus.UNPAID,
        stripeSubscriptionId: 'sub_xyz',
      });
      const user = fakeUser({ id: 'user-1', stripeCustomerId: 'cus_abc' });

      // chargeTheftFee loads the rental once; cancelAdmin loads it again with relations.
      rentalRepo.findOne
        .mockResolvedValueOnce(rental)
        .mockResolvedValueOnce({
          ...rental,
          user: { fullName: 'Test User', phone: '+1' } as User,
          product: { name: 'Dispenser' } as Product,
        });
      userRepo.findOne.mockResolvedValueOnce(user);
      mockStripeInstance.paymentIntents.create.mockResolvedValueOnce({
        id: 'pi_theft_456',
        status: 'succeeded',
        amount: 8000,
      });
      mockStripeInstance.subscriptions.cancel.mockResolvedValueOnce({ id: 'sub_xyz', status: 'canceled' });
      rentalRepo.save
        .mockResolvedValueOnce({ ...rental, theftFeeChargedAt: new Date() })
        .mockResolvedValueOnce({ ...rental, status: RentalStatus.CANCELED, canceledAt: new Date() });

      const result = await service.chargeTheftFee('rental-t2', true);

      expect(result.subscriptionCanceled).toBe(true);
      expect(mockStripeInstance.subscriptions.cancel).toHaveBeenCalledTimes(1);
    });

    it('theftFeeCents=0 → 503 THEFT_FEE_NOT_CONFIGURED, no Stripe call', async () => {
      const rental = fakeRental({ id: 'rental-t3', theftFeeCents: 0 });
      rentalRepo.findOne.mockResolvedValueOnce(rental);

      await expect(service.chargeTheftFee('rental-t3', false)).rejects.toMatchObject({ status: 503 });
      expect(mockStripeInstance.paymentIntents.create).not.toHaveBeenCalled();
    });

    it('already charged (theftFeeChargedAt set) → 409, never double-charges', async () => {
      const rental = fakeRental({
        id: 'rental-t4',
        theftFeeCents: 8000,
        theftFeeChargedAt: new Date('2026-01-01T00:00:00Z'),
      });
      rentalRepo.findOne.mockResolvedValueOnce(rental);

      await expect(service.chargeTheftFee('rental-t4', false)).rejects.toMatchObject({ status: 409 });
      expect(mockStripeInstance.paymentIntents.create).not.toHaveBeenCalled();
    });

    it('Stripe failure → 502 STRIPE_PAYMENT_FAILED, theftFeeChargedAt NOT stamped', async () => {
      const rental = fakeRental({ id: 'rental-t5', userId: 'user-1', theftFeeCents: 8000 });
      const user = fakeUser({ id: 'user-1', stripeCustomerId: 'cus_abc' });
      rentalRepo.findOne.mockResolvedValueOnce(rental);
      userRepo.findOne.mockResolvedValueOnce(user);
      mockStripeInstance.paymentIntents.create.mockRejectedValueOnce(new Error('card_declined'));

      await expect(service.chargeTheftFee('rental-t5', false)).rejects.toMatchObject({ status: 502 });
      expect(rentalRepo.save).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Pair 5 (T41) — cancelAdmin happy path
  // ─────────────────────────────────────────────────────────────────────────

  describe('cancelAdmin', () => {
    it('T41: active rental — subscriptions.cancel called, rental.status=canceled, canceledAt set', async () => {
      const rental = fakeRental({
        id: 'rental-5',
        status: RentalStatus.ACTIVE,
        stripeSubscriptionId: 'sub_active_xxx',
      });
      rentalRepo.findOne.mockResolvedValueOnce(rental);

      const savedRental = { ...rental, status: RentalStatus.CANCELED, canceledAt: new Date() };
      rentalRepo.save.mockResolvedValueOnce(savedRental);

      const result = await service.cancelAdmin('rental-5');

      // Stripe cancel called with invoice_now: false
      expect(mockStripeInstance.subscriptions.cancel).toHaveBeenCalledTimes(1);
      const cancelArgs = mockStripeInstance.subscriptions.cancel.mock.calls[0];
      expect(cancelArgs[0]).toBe('sub_active_xxx');
      expect((cancelArgs[1] as Record<string, unknown>)['invoice_now']).toBe(false);

      // DB update
      expect(rentalRepo.save).toHaveBeenCalledTimes(1);
      const savedArg = rentalRepo.save.mock.calls[0][0] as Partial<Rental>;
      expect(savedArg.status).toBe(RentalStatus.CANCELED);
      expect(savedArg.canceledAt).toBeInstanceOf(Date);
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Pair 6 (T43) — cancelAdmin idempotent (already canceled)
    // ─────────────────────────────────────────────────────────────────────────

    it('T43: already-canceled rental → returns 200, no Stripe call made', async () => {
      const rental = fakeRental({
        id: 'rental-6',
        status: RentalStatus.CANCELED,
        canceledAt: new Date(),
        stripeSubscriptionId: 'sub_canceled',
      });
      rentalRepo.findOne.mockResolvedValueOnce(rental);

      const result = await service.cancelAdmin('rental-6');

      // No Stripe call
      expect(mockStripeInstance.subscriptions.cancel).not.toHaveBeenCalled();
      // No DB update
      expect(rentalRepo.save).not.toHaveBeenCalled();
      // Returns rental as-is
      expect(result).toBeDefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Pair 7 (T45) — retrySetup happy path
  // ─────────────────────────────────────────────────────────────────────────

  describe('retrySetup', () => {
    it('T45: pending_setup rental → subscriptions.create with idempotencyKey rental-setup-{id}, status=active', async () => {
      const rental = fakeRental({
        id: 'rental-7',
        status: RentalStatus.PENDING_SETUP,
        stripeSubscriptionId: null,
        stripePriceId: 'price_abc',
        userId: 'user-1',
        productId: 'product-1',
      });
      const user = fakeUser({ id: 'user-1', stripeCustomerId: 'cus_abc' });

      rentalRepo.findOne.mockResolvedValueOnce(rental);
      userRepo.findOne.mockResolvedValueOnce(user);

      const now = Math.floor(Date.now() / 1000);
      const thirtyDays = now + 30 * 86400;
      mockStripeInstance.subscriptions.create.mockResolvedValueOnce({
        id: 'sub_retry_789',
        status: 'trialing',
        current_period_start: now,
        current_period_end: thirtyDays,
        items: { data: [{ current_period_start: now, current_period_end: thirtyDays }] },
        metadata: { rentalId: 'rental-7' },
      });

      const activeRental = {
        ...rental,
        status: RentalStatus.ACTIVE,
        stripeSubscriptionId: 'sub_retry_789',
        currentPeriodStart: new Date(now * 1000),
        currentPeriodEnd: new Date(thirtyDays * 1000),
      };
      rentalRepo.save.mockResolvedValueOnce(activeRental);

      const result = await service.retrySetup('rental-7');

      // subscriptions.create called
      expect(mockStripeInstance.subscriptions.create).toHaveBeenCalledTimes(1);

      // Idempotency key is rental-setup-{rentalId}-{trialEnd} — retry-safe so a
      // re-attempt with a fresh trial_end never collides with a poisoned key.
      const stripeCall = mockStripeInstance.subscriptions.create.mock.calls[0][0] as Record<string, unknown>;
      const trialEnd = stripeCall['trial_end'] as number;
      const callOptions = mockStripeInstance.subscriptions.create.mock.calls[0][1] as Record<string, unknown>;
      expect(callOptions?.['idempotencyKey']).toBe(`rental-setup-rental-7-${trialEnd}`);

      // Result is active
      expect(result.status).toBe(RentalStatus.ACTIVE);
      expect(result.stripeSubscriptionId).toBe('sub_retry_789');
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Pair 8 (T47) — retrySetup on non-pending_setup → 409
    // ─────────────────────────────────────────────────────────────────────────

    it('T47: non-pending_setup rental (status=active) → throws 409 RENTAL_NOT_RETRYABLE, Stripe NOT called', async () => {
      const rental = fakeRental({
        id: 'rental-8',
        status: RentalStatus.ACTIVE,
        stripeSubscriptionId: 'sub_active',
      });
      rentalRepo.findOne.mockResolvedValueOnce(rental);

      await expect(service.retrySetup('rental-8')).rejects.toMatchObject({ status: 409 });

      expect(mockStripeInstance.subscriptions.create).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 4 (Batch B) — past_due webhook: pastDueSince write-once
  // ─────────────────────────────────────────────────────────────────────────

  describe('handleSubscriptionUpdated — pastDueSince write-once (T4.1–T4.3)', () => {
    it('T4.1: past_due event sets rental.status=PAST_DUE AND pastDueSince to a non-null Date', async () => {
      const rental = fakeRental({
        id: 'rental-pd-1',
        stripeSubscriptionId: 'sub_pd_abc',
        status: RentalStatus.ACTIVE,
        pastDueSince: null,
      });

      rentalRepo.findOne.mockResolvedValueOnce(rental);
      rentalRepo.save.mockResolvedValueOnce({
        ...rental,
        status: RentalStatus.PAST_DUE,
        pastDueSince: new Date(),
      });

      const event = {
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_pd_abc',
            status: 'past_due',
            metadata: { rentalId: 'rental-pd-1' },
            current_period_start: Math.floor(Date.now() / 1000) - 86400,
            current_period_end: Math.floor(Date.now() / 1000) + 86400,
          },
        },
      };

      await service.handleWebhook(event);

      // Rental was saved with status=PAST_DUE and a pastDueSince date
      expect(rentalRepo.save).toHaveBeenCalledTimes(1);
      const savedArg = rentalRepo.save.mock.calls[0][0] as Partial<Rental>;
      expect(savedArg.status).toBe(RentalStatus.PAST_DUE);
      expect(savedArg.pastDueSince).toBeInstanceOf(Date);
    });

    it('T4.2: repeated past_due events do NOT overwrite pastDueSince (write-once)', async () => {
      const firstPastDueDate = new Date('2026-01-15T03:00:00Z');
      const rental = fakeRental({
        id: 'rental-pd-2',
        stripeSubscriptionId: 'sub_pd_xyz',
        status: RentalStatus.PAST_DUE,
        pastDueSince: firstPastDueDate, // already set from first event
      });

      rentalRepo.findOne.mockResolvedValueOnce(rental);
      rentalRepo.save.mockResolvedValueOnce({
        ...rental,
        status: RentalStatus.PAST_DUE,
        pastDueSince: firstPastDueDate, // must remain unchanged
      });

      const event = {
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_pd_xyz',
            status: 'past_due',
            metadata: { rentalId: 'rental-pd-2' },
            current_period_start: Math.floor(Date.now() / 1000) - 86400,
            current_period_end: Math.floor(Date.now() / 1000) + 86400,
          },
        },
      };

      await service.handleWebhook(event);

      // pastDueSince must NOT be overwritten — must be the original date
      const savedArg = rentalRepo.save.mock.calls[0][0] as Partial<Rental>;
      expect(savedArg.pastDueSince).toEqual(firstPastDueDate);
    });

    it('T4.3: customer.subscription.deleted sets rental.status=CANCELED', async () => {
      const rental = fakeRental({
        id: 'rental-cancel-new',
        stripeSubscriptionId: 'sub_cancel_new',
        status: RentalStatus.PAST_DUE,
        canceledAt: null,
      });

      rentalRepo.findOne.mockResolvedValueOnce(rental);
      rentalRepo.save.mockResolvedValueOnce({
        ...rental,
        status: RentalStatus.CANCELED,
        canceledAt: new Date(),
      });

      const event = {
        type: 'customer.subscription.deleted',
        data: {
          object: {
            id: 'sub_cancel_new',
            metadata: { rentalId: 'rental-cancel-new' },
          },
        },
      };

      await service.handleWebhook(event);

      expect(rentalRepo.save).toHaveBeenCalledTimes(1);
      const savedArg = rentalRepo.save.mock.calls[0][0] as Partial<Rental>;
      expect(savedArg.status).toBe(RentalStatus.CANCELED);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 5 — Webhook handlers
  // ─────────────────────────────────────────────────────────────────────────

  // ─────────────────────────────────────────────────────────────────────────
  // Pair 1 (T51) — handleWebhook: customer.subscription.updated
  // ─────────────────────────────────────────────────────────────────────────

  describe('handleWebhook — customer.subscription.updated', () => {
    it('T51a: upserts Rental status and period dates from Stripe subscription', async () => {
      const now = Math.floor(Date.now() / 1000);
      const periodEnd = now + 30 * 86400;

      const rental = fakeRental({
        id: 'rental-webhook-1',
        stripeSubscriptionId: 'sub_webhook_abc',
        status: RentalStatus.ACTIVE,
      });

      rentalRepo.findOne.mockResolvedValueOnce(rental);
      rentalRepo.save.mockResolvedValueOnce({
        ...rental,
        status: RentalStatus.PAST_DUE,
        currentPeriodStart: new Date(now * 1000),
        currentPeriodEnd: new Date(periodEnd * 1000),
      });

      const event = {
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_webhook_abc',
            status: 'past_due',
            metadata: { rentalId: 'rental-webhook-1', userId: 'user-1', productId: 'product-1' },
            current_period_start: now,
            current_period_end: periodEnd,
          },
        },
      };

      await service.handleWebhook(event);

      // Rental found by stripeSubscriptionId
      expect(rentalRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: { stripeSubscriptionId: 'sub_webhook_abc' } }),
      );

      // Rental saved with updated status and period
      expect(rentalRepo.save).toHaveBeenCalledTimes(1);
      const savedArg = rentalRepo.save.mock.calls[0][0] as Partial<typeof rental>;
      expect(savedArg.status).toBe(RentalStatus.PAST_DUE);
      expect(savedArg.currentPeriodStart).toBeInstanceOf(Date);
      expect(savedArg.currentPeriodEnd).toBeInstanceOf(Date);
    });

    it('T51b: idempotent — same event delivered twice → second call is no-op save (no error)', async () => {
      const now = Math.floor(Date.now() / 1000);
      const periodEnd = now + 30 * 86400;

      const rental = fakeRental({
        id: 'rental-webhook-idem',
        stripeSubscriptionId: 'sub_idem_xyz',
        status: RentalStatus.PAST_DUE,
        currentPeriodEnd: new Date(periodEnd * 1000),
      });

      // Both calls return the same rental (already in past_due)
      rentalRepo.findOne.mockResolvedValue(rental);
      rentalRepo.save.mockResolvedValue(rental);

      const event = {
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_idem_xyz',
            status: 'past_due',
            metadata: { rentalId: 'rental-webhook-idem' },
            current_period_start: now,
            current_period_end: periodEnd,
          },
        },
      };

      // Deliver twice — no error
      await expect(service.handleWebhook(event)).resolves.toBeUndefined();
      await expect(service.handleWebhook(event)).resolves.toBeUndefined();
    });

    it('T51c: no rental found for stripeSubscriptionId → no error, no save', async () => {
      rentalRepo.findOne.mockResolvedValueOnce(null);

      const event = {
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_not_in_db',
            status: 'active',
            metadata: { rentalId: 'r-missing' },
            current_period_start: 1000000,
            current_period_end: 1002592000,
          },
        },
      };

      await expect(service.handleWebhook(event)).resolves.toBeUndefined();
      expect(rentalRepo.save).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Pair 2 (T53) — handleWebhook: customer.subscription.deleted
  // ─────────────────────────────────────────────────────────────────────────

  describe('handleWebhook — customer.subscription.deleted', () => {
    it('T53a: sets Rental.status=canceled and canceledAt=NOW', async () => {
      const rental = fakeRental({
        id: 'rental-deleted-1',
        stripeSubscriptionId: 'sub_deleted_abc',
        status: RentalStatus.ACTIVE,
      });

      rentalRepo.findOne.mockResolvedValueOnce(rental);
      rentalRepo.save.mockResolvedValueOnce({
        ...rental,
        status: RentalStatus.CANCELED,
        canceledAt: new Date(),
      });

      const event = {
        type: 'customer.subscription.deleted',
        data: {
          object: {
            id: 'sub_deleted_abc',
            metadata: { rentalId: 'rental-deleted-1', userId: 'user-1' },
          },
        },
      };

      await service.handleWebhook(event);

      // Rental found by stripeSubscriptionId
      expect(rentalRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: { stripeSubscriptionId: 'sub_deleted_abc' } }),
      );

      // Rental saved with canceled status and canceledAt date
      expect(rentalRepo.save).toHaveBeenCalledTimes(1);
      const savedArg = rentalRepo.save.mock.calls[0][0] as Partial<typeof rental>;
      expect(savedArg.status).toBe(RentalStatus.CANCELED);
      expect(savedArg.canceledAt).toBeInstanceOf(Date);
    });

    it('T53b: already-canceled rental → no save (idempotent)', async () => {
      const rental = fakeRental({
        id: 'rental-deleted-already',
        stripeSubscriptionId: 'sub_already_canceled',
        status: RentalStatus.CANCELED,
        canceledAt: new Date(),
      });

      rentalRepo.findOne.mockResolvedValueOnce(rental);

      const event = {
        type: 'customer.subscription.deleted',
        data: {
          object: {
            id: 'sub_already_canceled',
            metadata: { rentalId: 'rental-deleted-already' },
          },
        },
      };

      await service.handleWebhook(event);

      // No DB save (already canceled)
      expect(rentalRepo.save).not.toHaveBeenCalled();
    });

    it('T53c: no rental found for sub → no error, no save', async () => {
      rentalRepo.findOne.mockResolvedValueOnce(null);

      const event = {
        type: 'customer.subscription.deleted',
        data: {
          object: {
            id: 'sub_not_in_db_deleted',
            metadata: { rentalId: 'r-missing-deleted' },
          },
        },
      };

      await expect(service.handleWebhook(event)).resolves.toBeUndefined();
      expect(rentalRepo.save).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Pair 3 (T55) — handleWebhook: invoice.payment_succeeded
  // ─────────────────────────────────────────────────────────────────────────

  describe('handleWebhook — invoice.payment_succeeded', () => {
    it('T55a: refreshes Rental.currentPeriodStart/End from fetched subscription', async () => {
      const now = Math.floor(Date.now() / 1000);
      const newPeriodEnd = now + 30 * 86400;

      const rental = fakeRental({
        id: 'rental-invoice-1',
        stripeSubscriptionId: 'sub_invoice_abc',
        status: RentalStatus.ACTIVE,
        currentPeriodEnd: new Date(now * 1000), // old period end
      });

      const stripeSubResponse = {
        id: 'sub_invoice_abc',
        status: 'active',
        current_period_start: now,
        current_period_end: newPeriodEnd,
        metadata: { rentalId: 'rental-invoice-1', userId: 'user-1' },
      };

      // Service will call stripe.subscriptions.retrieve(subId) to get the new period
      mockStripeInstance.subscriptions.retrieve.mockResolvedValueOnce(stripeSubResponse);

      rentalRepo.findOne.mockResolvedValueOnce(rental);
      rentalRepo.save.mockResolvedValueOnce({
        ...rental,
        currentPeriodStart: new Date(now * 1000),
        currentPeriodEnd: new Date(newPeriodEnd * 1000),
      });

      const event = {
        type: 'invoice.payment_succeeded',
        data: {
          object: {
            id: 'in_test_abc',
            subscription: 'sub_invoice_abc',
            period_start: now,
            period_end: newPeriodEnd,
          },
        },
      };

      await service.handleWebhook(event);

      // stripe.subscriptions.retrieve called with the subscription ID
      expect(mockStripeInstance.subscriptions.retrieve).toHaveBeenCalledWith('sub_invoice_abc');

      // Rental saved with updated period dates
      expect(rentalRepo.save).toHaveBeenCalledTimes(1);
      const savedArg = rentalRepo.save.mock.calls[0][0] as Partial<typeof rental>;
      expect(savedArg.currentPeriodStart).toBeInstanceOf(Date);
      expect(savedArg.currentPeriodEnd).toBeInstanceOf(Date);
      // Period end should be ~30 days from now
      const expectedPeriodEnd = new Date(newPeriodEnd * 1000);
      expect(savedArg.currentPeriodEnd!.getTime()).toBe(expectedPeriodEnd.getTime());
    });

    it('T55b: invoice with no subscription field → no-op', async () => {
      const event = {
        type: 'invoice.payment_succeeded',
        data: {
          object: {
            id: 'in_no_sub',
            // no subscription field
          },
        },
      };

      await expect(service.handleWebhook(event)).resolves.toBeUndefined();

      expect(mockStripeInstance.subscriptions.retrieve).not.toHaveBeenCalled();
      expect(rentalRepo.save).not.toHaveBeenCalled();
    });

    it('T55c: no rental found for sub → no save', async () => {
      const now = Math.floor(Date.now() / 1000);

      mockStripeInstance.subscriptions.retrieve.mockResolvedValueOnce({
        id: 'sub_no_rental',
        status: 'active',
        current_period_start: now,
        current_period_end: now + 30 * 86400,
        metadata: { rentalId: 'r-missing' },
      });

      rentalRepo.findOne.mockResolvedValueOnce(null);

      const event = {
        type: 'invoice.payment_succeeded',
        data: {
          object: {
            id: 'in_no_rental',
            subscription: 'sub_no_rental',
          },
        },
      };

      await expect(service.handleWebhook(event)).resolves.toBeUndefined();
      expect(rentalRepo.save).not.toHaveBeenCalled();
    });
  });
});
