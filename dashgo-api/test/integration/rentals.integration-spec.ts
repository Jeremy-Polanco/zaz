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
import {
  Subscription,
  SubscriptionStatus,
} from '../../src/entities/subscription.entity';
import { UserRole } from '../../src/entities/enums';
import { RentalsService } from '../../src/modules/rentals/rentals.service';
import { PlanDelinquencyListener } from '../../src/modules/rentals/plan-delinquency.listener';

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
      // El plan del usuario de prueba: subscriptions.user_id tiene FK RESTRICT,
      // así que borrarlo ANTES del user o el delete de abajo falla.
      await dataSource.getRepository(Subscription).delete({ userId: testUser.id });
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

    // El bebedero gratuito de un suscriptor ($0/mes) tiene su PROPIA suscripción
    // de Stripe de $0: su `currentPeriodEnd` se renueva siempre y jamás vence.
    // Quien se atrasa es el PLAN que lo paga, y eso se marca con
    // `planPastDueSince`. Sin la tercera rama del WHERE el alquiler moroso nunca
    // aparecía en el panel. Este caso corre contra Postgres REAL a propósito:
    // el WHERE es un string crudo que ni el compilador ni los tests con mocks
    // validan (la misma clase de bug que ya causó dos 500 en producción).
    it('incluye un alquiler marcado por mora del PLAN aunque su propio currentPeriodEnd sea futuro', async () => {
      const futureDate = new Date(Date.now() + 25 * 86400 * 1000);

      const mirrored = await dataSource.getRepository(Rental).save({
        userId: testUser.id,
        productId: testProduct.id,
        orderId: null,
        stripePriceId: 'price_int_test',
        monthlyRentCents: 0,
        lateFeeCents: 500,
        status: RentalStatus.PAST_DUE,
        stripeSubscriptionId: 'sub_plan_mirrored_int',
        currentPeriodEnd: futureDate,
        planPastDueSince: new Date(Date.now() - 6 * 86400 * 1000),
        pastDueSince: new Date(Date.now() - 6 * 86400 * 1000),
      } as unknown as Rental);
      createdRentalIds.push(mirrored.id);

      // Control: mismo alquiler de $0 con período futuro pero SIN el marcador.
      const unmarked = await dataSource.getRepository(Rental).save({
        userId: testUser.id,
        productId: testProduct.id,
        orderId: null,
        stripePriceId: 'price_int_test',
        monthlyRentCents: 0,
        lateFeeCents: 500,
        status: RentalStatus.PAST_DUE,
        stripeSubscriptionId: 'sub_plan_unmarked_int',
        currentPeriodEnd: futureDate,
        planPastDueSince: null,
      } as unknown as Rental);
      createdRentalIds.push(unmarked.id);

      const results = await rentalsService.listDelinquent();
      const ids = results.map((r) => r.id);

      expect(ids).toContain(mirrored.id);
      expect(ids).not.toContain(unmarked.id);

      // daysDelinquent se cuenta desde la mora del PLAN, no desde el período
      // (futuro) de la suscripción de $0 del propio alquiler.
      const dto = results.find((r) => r.id === mirrored.id)!;
      expect(dto.daysDelinquent).toBe(6);
      expect(dto.planPastDueSince).not.toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 7b. PlanDelinquencyListener — el barrido del reconcile contra Postgres real
  //
  // `syncAll` arranca con un `.select('DISTINCT rental.userId', 'userId')`:
  // string crudo, sin tipar, que TypeORM tiene que traducir a `rental.user_id`.
  // El spec unitario del listener mockea el QueryBuilder entero, así que es
  // ciego a esa traducción — y un error ahí no rompe nada visible: el listener
  // atrapa la excepción, la loguea y el barrido horario deja de curar moras en
  // silencio. Por eso este caso lo ejecuta de verdad.
  // ─────────────────────────────────────────────────────────────────────────

  describe('PlanDelinquencyListener (integration)', () => {
    let listener: PlanDelinquencyListener;

    beforeAll(() => {
      listener = app.get(PlanDelinquencyListener);
    });

    afterEach(async () => {
      await dataSource
        .getRepository(Subscription)
        .delete({ userId: testUser.id });
    });

    async function givenPlan(status: SubscriptionStatus): Promise<void> {
      await dataSource.getRepository(Subscription).delete({ userId: testUser.id });
      await dataSource.getRepository(Subscription).save({
        userId: testUser.id,
        stripeSubscriptionId: 'sub_plan_int_test',
        status,
        tier: 'standard',
        currentPeriodStart: new Date(Date.now() - 30 * 86400 * 1000),
        currentPeriodEnd: new Date(Date.now() + 86400 * 1000),
        cancelAtPeriodEnd: false,
        canceledAt: null,
      } as unknown as Subscription);
    }

    async function givenZeroRental(status: RentalStatus, subId: string): Promise<Rental> {
      const r = await dataSource.getRepository(Rental).save({
        userId: testUser.id,
        productId: testProduct.id,
        orderId: null,
        stripePriceId: 'price_int_test',
        monthlyRentCents: 0,
        lateFeeCents: 500,
        status,
        stripeSubscriptionId: subId,
        currentPeriodEnd: new Date(Date.now() + 25 * 86400 * 1000),
      } as unknown as Rental);
      createdRentalIds.push(r.id);
      return r;
    }

    it('syncAll marca el bebedero de $0 cuando el plan del usuario está en mora', async () => {
      const rental = await givenZeroRental(RentalStatus.ACTIVE, 'sub_zero_sweep_1');
      await givenPlan(SubscriptionStatus.PAST_DUE);

      await listener.syncAll();

      const after = await dataSource
        .getRepository(Rental)
        .findOneByOrFail({ id: rental.id });
      expect(after.status).toBe(RentalStatus.PAST_DUE);
      expect(after.planPastDueSince).not.toBeNull();
      // pastDueSince es lo que mira el cron de recargos: sin él, la mora
      // espejada nunca acumularía el recargo diario tras los 3 días de gracia.
      expect(after.pastDueSince).not.toBeNull();
    });

    it('syncAll restaura el bebedero marcado cuando el plan vuelve a active', async () => {
      const rental = await givenZeroRental(RentalStatus.ACTIVE, 'sub_zero_sweep_2');
      await givenPlan(SubscriptionStatus.PAST_DUE);
      await listener.syncAll();

      // Precondición explícita: si el barrido no marcó nada, el "restaurado"
      // de abajo sería un falso verde (el alquiler ya estaba ACTIVE).
      const marked = await dataSource
        .getRepository(Rental)
        .findOneByOrFail({ id: rental.id });
      expect(marked.status).toBe(RentalStatus.PAST_DUE);
      expect(marked.planPastDueSince).not.toBeNull();

      await givenPlan(SubscriptionStatus.ACTIVE);
      await listener.syncAll();

      const after = await dataSource
        .getRepository(Rental)
        .findOneByOrFail({ id: rental.id });
      expect(after.status).toBe(RentalStatus.ACTIVE);
      expect(after.planPastDueSince).toBeNull();
      expect(after.pastDueSince).toBeNull();
    });

    it('syncAll no toca un alquiler en pending_setup ni uno cancelado', async () => {
      const pending = await givenZeroRental(RentalStatus.PENDING_SETUP, 'sub_zero_sweep_3');
      const canceled = await givenZeroRental(RentalStatus.CANCELED, 'sub_zero_sweep_4');
      await givenPlan(SubscriptionStatus.CANCELED);

      await listener.syncAll();

      const rentalsRepo = dataSource.getRepository(Rental);
      const afterPending = await rentalsRepo.findOneByOrFail({ id: pending.id });
      const afterCanceled = await rentalsRepo.findOneByOrFail({ id: canceled.id });
      expect(afterPending.status).toBe(RentalStatus.PENDING_SETUP);
      expect(afterPending.planPastDueSince).toBeNull();
      expect(afterCanceled.status).toBe(RentalStatus.CANCELED);
      expect(afterCanceled.planPastDueSince).toBeNull();
    });

    // F1 — `subscriptions.user_id` YA NO es UNIQUE (migración
    // 1811000000000-DropSubscriptionsUserIdUnique). Antes, cancelar y
    // volver a suscribirse hacía que el segundo INSERT tirara duplicate key
    // sobre "user_id" (upsertSubscription conflictea por
    // stripe_subscription_id, nunca por user_id) — la fila `canceled` vieja
    // quedaba como única fila del usuario y el bebedero de $0 de un cliente
    // que SÍ pagaba terminaba UNPAID. Este caso corre contra Postgres REAL
    // porque es justo la constraint la que hay que probar, no algo que un
    // repo mockeado pueda validar.
    it('permite una fila canceled + una fila active para el mismo usuario, y syncForUser resuelve ACTIVE', async () => {
      const subsRepo = dataSource.getRepository(Subscription);

      const canceledRow = await subsRepo.save({
        userId: testUser.id,
        stripeSubscriptionId: 'sub_plan_old_canceled',
        status: SubscriptionStatus.CANCELED,
        tier: 'standard',
        currentPeriodStart: new Date(Date.now() - 60 * 86400 * 1000),
        currentPeriodEnd: new Date(Date.now() - 30 * 86400 * 1000),
        cancelAtPeriodEnd: false,
        canceledAt: new Date(Date.now() - 30 * 86400 * 1000),
      } as unknown as Subscription);

      // Antes de la migración, este segundo INSERT para el MISMO user_id
      // tiraba "duplicate key value violates unique constraint
      // UQ_d0a95ef8a28188364c546eb65c1".
      const activeRow = await subsRepo.save({
        userId: testUser.id,
        stripeSubscriptionId: 'sub_plan_new_active',
        status: SubscriptionStatus.ACTIVE,
        tier: 'standard',
        currentPeriodStart: new Date(Date.now() - 86400 * 1000),
        currentPeriodEnd: new Date(Date.now() + 29 * 86400 * 1000),
        cancelAtPeriodEnd: false,
        canceledAt: null,
      } as unknown as Subscription);

      const rowsForUser = await subsRepo.find({ where: { userId: testUser.id } });
      expect(rowsForUser.map((r) => r.id).sort()).toEqual(
        [canceledRow.id, activeRow.id].sort(),
      );

      const rental = await givenZeroRental(RentalStatus.ACTIVE, 'sub_zero_resub_1');

      const outcome = await listener.syncForUser(testUser.id);

      expect(outcome).toEqual({ marked: 0, unpaid: 0, restored: 0 });
      const after = await dataSource
        .getRepository(Rental)
        .findOneByOrFail({ id: rental.id });
      expect(after.status).toBe(RentalStatus.ACTIVE);
      expect(after.planPastDueSince).toBeNull();
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
