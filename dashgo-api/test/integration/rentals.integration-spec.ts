/**
 * Integration specs for RentalsService.
 *
 * T72 — Integration tests for the full rental lifecycle against real Postgres.
 * Stripe is mocked at the module level. The DB schema is applied via migrations.
 *
 * Test cases:
 * 1. createForOrder — persists Rental with pending_setup status
 * 2. activateForOrder — happy path: Stripe mock returns subscription, Rental.status='active'
 * 3. activateForOrder — Stripe failure: Rental stays pending_setup
 * 4. chargeLateFee — happy path + alsoCancel=true
 * 5. cancelAdmin — happy path
 * 6. retrySetup — pending_setup → active
 * 7. listDelinquent — query against real DB returns correct entries
 * 8. handleWebhook — events update Rental state
 */

import * as path from 'path';
import * as fs from 'fs';

// Stripe module mock — MUST be declared with var and before any imports.
// eslint-disable-next-line no-var
var mockStripe: {
  customers: { create: jest.Mock; search: jest.Mock; update: jest.Mock; list: jest.Mock };
  subscriptions: { create: jest.Mock; retrieve: jest.Mock; update: jest.Mock; list: jest.Mock; cancel: jest.Mock };
  checkout: { sessions: { create: jest.Mock } };
  billingPortal: { sessions: { create: jest.Mock } };
  paymentIntents: { create: jest.Mock; retrieve: jest.Mock; cancel: jest.Mock; capture: jest.Mock };
  webhooks: { constructEvent: jest.Mock };
  prices: { retrieve: jest.Mock; create: jest.Mock; update: jest.Mock };
  products: { create: jest.Mock; update: jest.Mock };
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
    create: jest.fn().mockResolvedValue({ id: 'cus_rentals_int_test' }),
    search: jest.fn().mockResolvedValue({ data: [] }),
    update: jest.fn().mockResolvedValue({}),
    list: jest.fn().mockResolvedValue({ data: [] }),
  },
  subscriptions: {
    create: jest.fn().mockResolvedValue({
      id: 'sub_rentals_int_test',
      status: 'active',
      current_period_start: NOW_UNIX,
      current_period_end: FUTURE_UNIX,
      items: { data: [{ current_period_start: NOW_UNIX, current_period_end: FUTURE_UNIX }] },
      metadata: { rentalId: '', userId: '', productId: '' },
    }),
    retrieve: jest.fn().mockResolvedValue({
      id: 'sub_rentals_int_test',
      current_period_start: NOW_UNIX,
      current_period_end: FUTURE_UNIX,
    }),
    update: jest.fn().mockResolvedValue({}),
    list: jest.fn().mockResolvedValue({ data: [] }),
    cancel: jest.fn().mockResolvedValue({ id: 'sub_rentals_int_test', status: 'canceled' }),
  },
  checkout: { sessions: { create: jest.fn().mockResolvedValue({ url: 'https://stripe.test' }) } },
  billingPortal: { sessions: { create: jest.fn().mockResolvedValue({ url: 'https://stripe.test/portal' }) } },
  paymentIntents: {
    create: jest.fn().mockResolvedValue({ id: 'pi_rentals_int_test', status: 'succeeded', amount: 500 }),
    retrieve: jest.fn().mockResolvedValue({ id: 'pi_rentals_int_test', status: 'succeeded' }),
    cancel: jest.fn().mockResolvedValue({}),
    capture: jest.fn().mockResolvedValue({}),
  },
  webhooks: { constructEvent: jest.fn() },
  prices: {
    retrieve: jest.fn().mockResolvedValue({ id: 'price_int_test', product: 'prod_int_test', unit_amount: 2000, currency: 'usd', recurring: { interval: 'month' } }),
    create: jest.fn().mockResolvedValue({ id: 'price_new_int_test', unit_amount: 2000, currency: 'usd', recurring: { interval: 'month' } }),
    update: jest.fn().mockResolvedValue({}),
  },
  products: {
    create: jest.fn().mockResolvedValue({ id: 'prod_rentals_int_test' }),
    update: jest.fn().mockResolvedValue({}),
  },
};

import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createTestingApp } from '../../src/test-utils/testing-app';
import { makeUser } from '../../src/test-utils/fixtures';
import { User } from '../../src/entities/user.entity';
import { Product } from '../../src/entities/product.entity';
import { Rental, RentalStatus } from '../../src/entities/rental.entity';
import { UserRole } from '../../src/entities/enums';
import { RentalsService } from '../../src/modules/rentals/rentals.service';

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

describe('RentalsService (integration)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let rentalsService: RentalsService;

  let testUser: User;
  let testProduct: Product;

  // Track created IDs for cleanup
  const createdRentalIds: string[] = [];

  beforeAll(async () => {
    loadEnvTest();
    app = await createTestingApp();
    dataSource = app.get(DataSource);
    rentalsService = app.get(RentalsService);

    // Create a persistent test user with a stripeCustomerId so Stripe calls don't need extra setup
    testUser = await dataSource.getRepository(User).save({
      ...makeUser({ role: UserRole.CLIENT }),
      stripeCustomerId: 'cus_rentals_int_test',
    } as unknown as User);

    // Create a rental product
    testProduct = await dataSource.getRepository(Product).save({
      name: 'Integration Test Rental Product',
      description: 'Used in integration tests',
      priceCents: 0,
      priceToPublic: '0.00',
      stock: 20,
      pricingMode: 'rental',
      monthlyRentCents: 2000,
      lateFeeCents: 500,
      stripePriceId: 'price_int_test',
      stripeProductId: 'prod_rentals_int_test',
    } as unknown as Product);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      // Clean up rentals first (FK), then product/user
      for (const id of createdRentalIds) {
        await dataSource.getRepository(Rental).delete({ id });
      }
      // Extra cleanup: any stray rentals pointing to our test product
      await dataSource.getRepository(Rental).delete({ productId: testProduct.id });
      await dataSource.getRepository(Product).delete({ id: testProduct.id });
      await dataSource.getRepository(User).delete({ id: testUser.id });
    }
    if (app) await app.close();
  });

  beforeEach(async () => {
    jest.clearAllMocks();

    // Clean up any rentals from the previous test for the same (user, product) pair
    // so the RENTAL_ALREADY_ACTIVE pre-check doesn't fire between tests.
    if (dataSource?.isInitialized && testUser && testProduct) {
      await dataSource.getRepository(Rental).delete({
        userId: testUser.id,
        productId: testProduct.id,
      });
    }

    // Reset Stripe mocks to defaults
    mockStripe.subscriptions.create.mockResolvedValue({
      id: 'sub_rentals_int_test',
      status: 'active',
      current_period_start: NOW_UNIX,
      current_period_end: FUTURE_UNIX,
      items: { data: [{ current_period_start: NOW_UNIX, current_period_end: FUTURE_UNIX }] },
      metadata: { rentalId: '', userId: '', productId: '' },
    });
    mockStripe.subscriptions.retrieve.mockResolvedValue({
      id: 'sub_rentals_int_test',
      current_period_start: NOW_UNIX,
      current_period_end: FUTURE_UNIX,
    });
    mockStripe.paymentIntents.create.mockResolvedValue({
      id: 'pi_rentals_int_test',
      status: 'succeeded',
      amount: 500,
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 1. createForOrder — persists Rental with pending_setup status
  // ─────────────────────────────────────────────────────────────────────────

  describe('createForOrder', () => {
    it('persists a Rental row with status=pending_setup', async () => {
      const rental = await rentalsService.createForOrder({
        userId: testUser.id,
        productId: testProduct.id,
        orderId: null as unknown as string,
        product: testProduct,
      });

      createdRentalIds.push(rental.id);

      expect(rental.id).toBeDefined();
      expect(rental.status).toBe(RentalStatus.PENDING_SETUP);
      expect(rental.userId).toBe(testUser.id);
      expect(rental.productId).toBe(testProduct.id);
      expect(rental.monthlyRentCents).toBe(2000);
      expect(rental.lateFeeCents).toBe(500);
      expect(rental.stripePriceId).toBe('price_int_test');

      // Verify persisted to DB
      const fromDb = await dataSource.getRepository(Rental).findOne({ where: { id: rental.id } });
      expect(fromDb).not.toBeNull();
      expect(fromDb!.status).toBe(RentalStatus.PENDING_SETUP);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 2. activateForOrder — Stripe success → status='active'
  // ─────────────────────────────────────────────────────────────────────────

  describe('activateForOrder — happy path', () => {
    it('updates Rental.status to active and persists stripeSubscriptionId', async () => {
      // Create a pending_setup rental first
      const rental = await rentalsService.createForOrder({
        userId: testUser.id,
        productId: testProduct.id,
        orderId: null as unknown as string,
        product: testProduct,
      });
      createdRentalIds.push(rental.id);

      mockStripe.subscriptions.create.mockResolvedValueOnce({
        id: 'sub_activate_happy',
        status: 'active',
        current_period_start: NOW_UNIX,
        current_period_end: FUTURE_UNIX,
        items: { data: [{ current_period_start: NOW_UNIX, current_period_end: FUTURE_UNIX }] },
        metadata: { rentalId: rental.id, userId: testUser.id, productId: testProduct.id },
      });

      const activated = await rentalsService.activateForOrder(rental.id);

      expect(activated.status).toBe(RentalStatus.ACTIVE);
      expect(activated.stripeSubscriptionId).toBe('sub_activate_happy');
      expect(activated.currentPeriodEnd).toBeDefined();
      expect(activated.currentPeriodEnd).not.toBeNull();

      // Verify persisted
      const fromDb = await dataSource.getRepository(Rental).findOne({ where: { id: rental.id } });
      expect(fromDb!.status).toBe(RentalStatus.ACTIVE);
      expect(fromDb!.stripeSubscriptionId).toBe('sub_activate_happy');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 3. activateForOrder — Stripe failure → Rental stays pending_setup
  // ─────────────────────────────────────────────────────────────────────────

  describe('activateForOrder — Stripe failure', () => {
    it('leaves Rental in pending_setup when Stripe subscriptions.create throws', async () => {
      const rental = await rentalsService.createForOrder({
        userId: testUser.id,
        productId: testProduct.id,
        orderId: null as unknown as string,
        product: testProduct,
      });
      createdRentalIds.push(rental.id);

      mockStripe.subscriptions.create.mockRejectedValueOnce(new Error('Stripe unavailable'));

      const result = await rentalsService.activateForOrder(rental.id);

      // Should still return the rental (unchanged)
      expect(result.status).toBe(RentalStatus.PENDING_SETUP);
      expect(result.stripeSubscriptionId).toBeNull();

      // Verify DB row is still pending_setup
      const fromDb = await dataSource.getRepository(Rental).findOne({ where: { id: rental.id } });
      expect(fromDb!.status).toBe(RentalStatus.PENDING_SETUP);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 4. chargeLateFee — happy path + alsoCancel=true
  // ─────────────────────────────────────────────────────────────────────────

  describe('chargeLateFee', () => {
    it('happy path — charges the late fee and returns correct DTO', async () => {
      const rental = await dataSource.getRepository(Rental).save({
        userId: testUser.id,
        productId: testProduct.id,
        orderId: null,
        stripePriceId: 'price_int_test',
        monthlyRentCents: 2000,
        lateFeeCents: 500,
        status: RentalStatus.PAST_DUE,
        stripeSubscriptionId: 'sub_charge_fee_test',
      } as unknown as Rental);
      createdRentalIds.push(rental.id);

      mockStripe.paymentIntents.create.mockResolvedValueOnce({
        id: 'pi_late_fee_integration',
        status: 'succeeded',
        amount: 500,
      });

      const result = await rentalsService.chargeLateFee(rental.id, false);

      expect(result.chargedCents).toBe(500);
      expect(result.paymentIntentId).toBe('pi_late_fee_integration');
      expect(result.subscriptionCanceled).toBe(false);
      expect(mockStripe.paymentIntents.create).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 500, customer: 'cus_rentals_int_test' }),
        expect.anything(),
      );
    });

    it('alsoCancel=true — charges fee and cancels Rental', async () => {
      const rental = await dataSource.getRepository(Rental).save({
        userId: testUser.id,
        productId: testProduct.id,
        orderId: null,
        stripePriceId: 'price_int_test',
        monthlyRentCents: 2000,
        lateFeeCents: 500,
        status: RentalStatus.PAST_DUE,
        stripeSubscriptionId: 'sub_also_cancel_test',
      } as unknown as Rental);
      createdRentalIds.push(rental.id);

      mockStripe.paymentIntents.create.mockResolvedValueOnce({
        id: 'pi_also_cancel_test',
        status: 'succeeded',
        amount: 500,
      });
      mockStripe.subscriptions.cancel.mockResolvedValueOnce({
        id: 'sub_also_cancel_test',
        status: 'canceled',
      });

      const result = await rentalsService.chargeLateFee(rental.id, true);

      expect(result.subscriptionCanceled).toBe(true);
      expect(mockStripe.subscriptions.cancel).toHaveBeenCalled();

      // DB rental should be canceled
      const fromDb = await dataSource.getRepository(Rental).findOne({ where: { id: rental.id } });
      expect(fromDb!.status).toBe(RentalStatus.CANCELED);
      expect(fromDb!.canceledAt).not.toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 5. cancelAdmin — happy path
  // ─────────────────────────────────────────────────────────────────────────

  describe('cancelAdmin', () => {
    it('cancels an active rental and persists canceledAt', async () => {
      const rental = await dataSource.getRepository(Rental).save({
        userId: testUser.id,
        productId: testProduct.id,
        orderId: null,
        stripePriceId: 'price_int_test',
        monthlyRentCents: 2000,
        lateFeeCents: 500,
        status: RentalStatus.ACTIVE,
        stripeSubscriptionId: 'sub_cancel_admin_test',
      } as unknown as Rental);
      createdRentalIds.push(rental.id);

      mockStripe.subscriptions.cancel.mockResolvedValueOnce({
        id: 'sub_cancel_admin_test',
        status: 'canceled',
      });

      const dto = await rentalsService.cancelAdmin(rental.id);

      expect(dto.status).toBe(RentalStatus.CANCELED);
      expect(dto.canceledAt).not.toBeNull();

      // Verify DB
      const fromDb = await dataSource.getRepository(Rental).findOne({ where: { id: rental.id } });
      expect(fromDb!.status).toBe(RentalStatus.CANCELED);
      expect(mockStripe.subscriptions.cancel).toHaveBeenCalledWith(
        'sub_cancel_admin_test',
        expect.objectContaining({ invoice_now: false }),
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 6. retrySetup — pending_setup → active
  // ─────────────────────────────────────────────────────────────────────────

  describe('retrySetup', () => {
    it('activates a pending_setup rental via Stripe subscription create', async () => {
      const rental = await dataSource.getRepository(Rental).save({
        userId: testUser.id,
        productId: testProduct.id,
        orderId: null,
        stripePriceId: 'price_int_test',
        monthlyRentCents: 2000,
        lateFeeCents: 500,
        status: RentalStatus.PENDING_SETUP,
        stripeSubscriptionId: null,
      } as unknown as Rental);
      createdRentalIds.push(rental.id);

      mockStripe.subscriptions.create.mockResolvedValueOnce({
        id: 'sub_retry_integration',
        status: 'active',
        current_period_start: NOW_UNIX,
        current_period_end: FUTURE_UNIX,
        items: { data: [{ current_period_start: NOW_UNIX, current_period_end: FUTURE_UNIX }] },
        metadata: { rentalId: rental.id, userId: testUser.id, productId: testProduct.id },
      });

      const dto = await rentalsService.retrySetup(rental.id);

      expect(dto.status).toBe(RentalStatus.ACTIVE);
      expect(dto.stripeSubscriptionId).toBe('sub_retry_integration');

      // Verify idempotency key passed
      expect(mockStripe.subscriptions.create).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ idempotencyKey: `rental-setup-${rental.id}` }),
      );

      // Verify DB updated
      const fromDb = await dataSource.getRepository(Rental).findOne({ where: { id: rental.id } });
      expect(fromDb!.status).toBe(RentalStatus.ACTIVE);
      expect(fromDb!.stripeSubscriptionId).toBe('sub_retry_integration');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 7. listDelinquent — real DB query returns correct entries
  // ─────────────────────────────────────────────────────────────────────────

  describe('listDelinquent', () => {
    it('returns past_due rentals with overdue currentPeriodEnd', async () => {
      const pastDate = new Date(Date.now() - 2 * 86400 * 1000); // 2 days ago
      const futureDate = new Date(Date.now() + 5 * 86400 * 1000); // 5 days from now

      // Delinquent: past_due + period expired
      const delinquentRental = await dataSource.getRepository(Rental).save({
        userId: testUser.id,
        productId: testProduct.id,
        orderId: null,
        stripePriceId: 'price_int_test',
        monthlyRentCents: 2000,
        lateFeeCents: 500,
        status: RentalStatus.PAST_DUE,
        stripeSubscriptionId: 'sub_delinquent_int',
        currentPeriodEnd: pastDate,
      } as unknown as Rental);
      createdRentalIds.push(delinquentRental.id);

      // Non-delinquent: past_due but period NOT yet expired
      const notDelinquent = await dataSource.getRepository(Rental).save({
        userId: testUser.id,
        productId: testProduct.id,
        orderId: null,
        stripePriceId: 'price_int_test',
        monthlyRentCents: 2000,
        lateFeeCents: 500,
        status: RentalStatus.PAST_DUE,
        stripeSubscriptionId: 'sub_not_delinquent_int',
        currentPeriodEnd: futureDate,
      } as unknown as Rental);
      createdRentalIds.push(notDelinquent.id);

      const results = await rentalsService.listDelinquent();

      const ids = results.map((r) => r.id);
      expect(ids).toContain(delinquentRental.id);
      expect(ids).not.toContain(notDelinquent.id);
    });

    it('returns pending_setup rentals stuck > 24 hours', async () => {
      const oldDate = new Date(Date.now() - 25 * 3600 * 1000); // 25 hours ago

      // Insert a stale pending_setup rental
      // We need to set createdAt manually via raw SQL since TypeORM's @CreateDateColumn
      // uses the current timestamp and can't be overridden by save.
      const rental = await dataSource.getRepository(Rental).save({
        userId: testUser.id,
        productId: testProduct.id,
        orderId: null,
        stripePriceId: 'price_int_test',
        monthlyRentCents: 2000,
        lateFeeCents: 500,
        status: RentalStatus.PENDING_SETUP,
        stripeSubscriptionId: null,
      } as unknown as Rental);
      createdRentalIds.push(rental.id);

      // Manually backdate the createdAt column to simulate stale pending
      await dataSource.query(
        `UPDATE rentals SET created_at = $1 WHERE id = $2`,
        [oldDate, rental.id],
      );

      const results = await rentalsService.listDelinquent();
      const ids = results.map((r) => r.id);
      expect(ids).toContain(rental.id);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 8. handleWebhook — events update Rental state
  // ─────────────────────────────────────────────────────────────────────────

  describe('handleWebhook', () => {
    it('customer.subscription.updated — updates status and period dates', async () => {
      const rental = await dataSource.getRepository(Rental).save({
        userId: testUser.id,
        productId: testProduct.id,
        orderId: null,
        stripePriceId: 'price_int_test',
        monthlyRentCents: 2000,
        lateFeeCents: 500,
        status: RentalStatus.ACTIVE,
        stripeSubscriptionId: 'sub_webhook_updated',
        currentPeriodEnd: new Date(NOW_UNIX * 1000),
      } as unknown as Rental);
      createdRentalIds.push(rental.id);

      const newPeriodEnd = FUTURE_UNIX + 86400 * 30; // advance another month

      await rentalsService.handleWebhook({
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_webhook_updated',
            status: 'past_due',
            metadata: { rentalId: rental.id },
            current_period_start: NOW_UNIX,
            current_period_end: newPeriodEnd,
          },
        },
      });

      const fromDb = await dataSource.getRepository(Rental).findOne({ where: { id: rental.id } });
      expect(fromDb!.status).toBe(RentalStatus.PAST_DUE);
      const periodEndMs = fromDb!.currentPeriodEnd?.getTime() ?? 0;
      const expected = newPeriodEnd * 1000;
      expect(Math.abs(periodEndMs - expected)).toBeLessThan(1500);
    });

    it('customer.subscription.deleted — sets status=canceled', async () => {
      const rental = await dataSource.getRepository(Rental).save({
        userId: testUser.id,
        productId: testProduct.id,
        orderId: null,
        stripePriceId: 'price_int_test',
        monthlyRentCents: 2000,
        lateFeeCents: 500,
        status: RentalStatus.ACTIVE,
        stripeSubscriptionId: 'sub_webhook_deleted',
      } as unknown as Rental);
      createdRentalIds.push(rental.id);

      await rentalsService.handleWebhook({
        type: 'customer.subscription.deleted',
        data: {
          object: {
            id: 'sub_webhook_deleted',
            metadata: { rentalId: rental.id },
          },
        },
      });

      const fromDb = await dataSource.getRepository(Rental).findOne({ where: { id: rental.id } });
      expect(fromDb!.status).toBe(RentalStatus.CANCELED);
      expect(fromDb!.canceledAt).not.toBeNull();
    });

    it('invoice.payment_succeeded — refreshes period bounds', async () => {
      const rental = await dataSource.getRepository(Rental).save({
        userId: testUser.id,
        productId: testProduct.id,
        orderId: null,
        stripePriceId: 'price_int_test',
        monthlyRentCents: 2000,
        lateFeeCents: 500,
        status: RentalStatus.ACTIVE,
        stripeSubscriptionId: 'sub_webhook_invoice',
        currentPeriodEnd: new Date(NOW_UNIX * 1000),
      } as unknown as Rental);
      createdRentalIds.push(rental.id);

      const newPeriodEnd = FUTURE_UNIX + 86400 * 30;

      mockStripe.subscriptions.retrieve.mockResolvedValueOnce({
        id: 'sub_webhook_invoice',
        current_period_start: NOW_UNIX + 86400 * 30,
        current_period_end: newPeriodEnd,
      });

      await rentalsService.handleWebhook({
        type: 'invoice.payment_succeeded',
        data: {
          object: {
            subscription: 'sub_webhook_invoice',
            period_start: NOW_UNIX + 86400 * 30,
            period_end: newPeriodEnd,
          },
        },
      });

      const fromDb = await dataSource.getRepository(Rental).findOne({ where: { id: rental.id } });
      const periodEndMs = fromDb!.currentPeriodEnd?.getTime() ?? 0;
      const expectedMs = newPeriodEnd * 1000;
      expect(Math.abs(periodEndMs - expectedMs)).toBeLessThan(1500);
    });
  });
});
