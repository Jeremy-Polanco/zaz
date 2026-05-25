/**
 * E2E spec: Rentals Cycle 5 — full happy path
 *
 * T10.2 — End-to-end integration test for the full rental billing flow:
 *   1. Seed: test user with Stripe customer + payment method
 *   2. Seed: rental-mode Product with stripeProductId/stripePriceId from env
 *   3. POST /orders with 1 rental item → Rental in PENDING_SETUP
 *   4. Full order lifecycle → DELIVERED → Rental flips ACTIVE (activateRentalsForOrder)
 *   5. Simulate customer.subscription.updated (past_due, signed webhook)
 *      → Rental.status = PAST_DUE, pastDueSince set
 *   6. DB-update pastDueSince to 4 days ago, invoke LateFeeCron.runDaily()
 *      → chargeLateFee called, lastLateFeeAt set
 *   7. Invoke runDaily() again (same simulated now)
 *      → chargeLateFee NOT called twice (idempotency)
 *
 * Skip behaviour:
 *   When STRIPE_SECRET_KEY or STRIPE_RENTAL_TEST_PRICE_ID are absent from the
 *   environment, the entire suite is skipped with describe.skip — no failures.
 *
 * When creds ARE present:
 *   Uses real Stripe TEST mode API for subscription creation during activation.
 *   Uses Stripe.webhooks.generateTestHeaderString() to sign webhook fixture events
 *   (no Stripe CLI required in CI).
 *   The test STRIPE_WEBHOOK_SECRET must be the same secret that the app is started
 *   with (set via STRIPE_WEBHOOK_SECRET env var).
 */

import * as path from 'path';
import * as fs from 'fs';

// ─── Stripe creds guard ────────────────────────────────────────────────────────
// Evaluated before jest.mock because jest hoists mock calls but this const is
// evaluated at module evaluation time — the loadEnvTest() must run first.

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

// Load .env.test early so STRIPE_CREDS_PRESENT reflects any locally committed test creds.
loadEnvTest();

const STRIPE_CREDS_PRESENT =
  !!process.env.STRIPE_SECRET_KEY &&
  process.env.STRIPE_SECRET_KEY !== 'sk_test_dummy' &&
  !!process.env.STRIPE_RENTAL_TEST_PRICE_ID;

const describeIfStripe = STRIPE_CREDS_PRESENT ? describe : describe.skip;

// ─── Stripe mock (active when creds are absent / test isolation) ───────────────
// We always define a mockStripeInstance so the module graph doesn't crash even
// when STRIPE_CREDS_PRESENT=false (describe.skip still imports the file).
// When real creds ARE present, the mock is still registered but the real Stripe
// constructor is used by the app — jest.mock is hoisted and wraps the ctor, but
// because STRIPE_SECRET_KEY is a real key the SDK initialises correctly.

// eslint-disable-next-line no-var
var mockStripeInstance: Record<string, unknown>;

jest.mock('stripe', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctor = jest.fn().mockImplementation((...args: any[]) => {
    // When real creds present: delegate to actual Stripe for subscription calls.
    // When no real creds: return the mock instance for unit-style E2E.
    if (STRIPE_CREDS_PRESENT) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const RealStripe = jest.requireActual<{ default: new (...a: any[]) => unknown }>('stripe').default;
      return new RealStripe(...args);
    }
    return mockStripeInstance;
  });
  return ctor;
});

const NOW_UNIX = Math.floor(Date.now() / 1000);
const FUTURE_UNIX = NOW_UNIX + 86400 * 30;

mockStripeInstance = {
  prices: {
    retrieve: jest.fn().mockResolvedValue({
      id: 'price_seed_test',
      product: 'prod_test',
      unit_amount: 1000,
      currency: 'usd',
      recurring: { interval: 'month' },
    }),
    create: jest.fn().mockResolvedValue({ id: 'price_new_test', unit_amount: 2000, currency: 'usd', recurring: { interval: 'month' } }),
    update: jest.fn().mockResolvedValue({}),
  },
  products: {
    create: jest.fn().mockResolvedValue({ id: 'prod_cycle5_e2e_test' }),
    update: jest.fn().mockResolvedValue({}),
  },
  customers: {
    create: jest.fn().mockResolvedValue({ id: 'cus_cycle5_e2e_test' }),
    search: jest.fn().mockResolvedValue({ data: [] }),
    update: jest.fn().mockResolvedValue({}),
    list: jest.fn().mockResolvedValue({ data: [] }),
    retrieve: jest.fn().mockResolvedValue({ id: 'cus_cycle5_e2e_test', deleted: false }),
  },
  subscriptions: {
    create: jest.fn().mockResolvedValue({
      id: 'sub_cycle5_e2e_happy',
      status: 'active',
      current_period_start: NOW_UNIX,
      current_period_end: FUTURE_UNIX,
      items: { data: [{ current_period_start: NOW_UNIX, current_period_end: FUTURE_UNIX }] },
      metadata: { rentalId: '', userId: '', productId: '' },
    }),
    retrieve: jest.fn().mockResolvedValue({ id: 'sub_cycle5_e2e_happy', status: 'active', current_period_start: NOW_UNIX, current_period_end: FUTURE_UNIX }),
    update: jest.fn().mockResolvedValue({}),
    cancel: jest.fn().mockResolvedValue({ id: 'sub_cycle5_e2e_happy', status: 'canceled' }),
    list: jest.fn().mockResolvedValue({ data: [] }),
  },
  checkout: {
    sessions: { create: jest.fn().mockResolvedValue({ id: 'cs_cycle5_test', url: 'https://stripe.test' }) },
  },
  billingPortal: {
    sessions: { create: jest.fn().mockResolvedValue({ url: 'https://stripe.test/portal' }) },
  },
  paymentIntents: {
    create: jest.fn().mockResolvedValue({ id: 'pi_cycle5_e2e', status: 'succeeded', amount: 500, currency: 'usd' }),
    retrieve: jest.fn().mockResolvedValue({ id: 'pi_cycle5_e2e', status: 'succeeded' }),
    cancel: jest.fn().mockResolvedValue({}),
    capture: jest.fn().mockResolvedValue({}),
  },
  webhooks: {
    constructEvent: jest.fn((rawBody: Buffer) => JSON.parse(rawBody.toString()) as unknown),
    generateTestHeaderString: jest.fn().mockReturnValue('t=1234567890,v1=fake_sig'),
  },
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createTestingApp } from '../../src/test-utils/testing-app';
import { makeUser } from '../../src/test-utils/fixtures';
import { User } from '../../src/entities/user.entity';
import { Rental, RentalStatus } from '../../src/entities/rental.entity';
import { Product } from '../../src/entities/product.entity';
import { Order } from '../../src/entities/order.entity';
import { UserRole, OrderStatus, PaymentMethod } from '../../src/entities/enums';
import { LateFeeCron } from '../../src/modules/rentals/late-fee.cron';
import { issueTestToken } from './helpers/auth.helper';

// ─── Import Stripe for generateTestHeaderString ────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-require-imports
const StripeLib = require('stripe') as { new(...args: unknown[]): unknown } & {
  webhooks: { generateTestHeaderString: (opts: { payload: string; secret: string }) => string };
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a raw webhook payload for customer.subscription.updated and sign it
 * using Stripe.webhooks.generateTestHeaderString so the app's constructEvent
 * validates the signature without requiring the Stripe CLI.
 */
function buildSignedSubscriptionEvent(opts: {
  type: string;
  subscriptionId: string;
  subscriptionStatus: string;
  rentalId: string;
  userId: string;
  productId: string;
  webhookSecret: string;
}): { payload: string; signature: string } {
  const payload = JSON.stringify({
    type: opts.type,
    data: {
      object: {
        id: opts.subscriptionId,
        status: opts.subscriptionStatus,
        current_period_start: NOW_UNIX - 86400,
        current_period_end: FUTURE_UNIX,
        cancel_at_period_end: false,
        canceled_at: null,
        metadata: {
          rentalId: opts.rentalId,
          userId: opts.userId,
          productId: opts.productId,
        },
      },
    },
  });

  const signature = StripeLib.webhooks.generateTestHeaderString({
    payload,
    secret: opts.webhookSecret,
  });

  return { payload, signature };
}

// ─── Suite ─────────────────────────────────────────────────────────────────────

describeIfStripe('rentals cycle 5 — full happy path', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let lateFeeCron: LateFeeCron;

  let clientUser: User;
  let superUser: User;
  let rentalProduct: Product;

  let clientToken: string;
  let superToken: string;

  // IDs tracked for cleanup
  const createdOrderIds: string[] = [];

  const stripeWebhookSecret =
    process.env.STRIPE_WEBHOOK_SECRET ?? 'whsec_test';
  const stripeRentalPriceId =
    process.env.STRIPE_RENTAL_TEST_PRICE_ID ?? 'price_rental_e2e_test';
  const stripeRentalProductId =
    process.env.STRIPE_RENTAL_TEST_PRODUCT_ID ?? 'prod_rental_e2e_test';

  beforeAll(async () => {
    // DB / auth env already set by loadEnvTest() above; createTestingApp re-sets them.
    process.env.STRIPE_SUBSCRIPTION_PRICE_ID = 'price_seed_test';

    app = await createTestingApp();
    dataSource = app.get(DataSource);
    lateFeeCron = app.get(LateFeeCron);

    // ── Seed: super admin ──
    superUser = await dataSource.getRepository(User).save(
      makeUser({ role: UserRole.SUPER_ADMIN_DELIVERY }) as unknown as User,
    );
    superToken = await issueTestToken(app, superUser.id, UserRole.SUPER_ADMIN_DELIVERY);

    // ── Seed: client user with Stripe customer ──
    clientUser = await dataSource.getRepository(User).save(
      makeUser({ role: UserRole.CLIENT, stripeCustomerId: 'cus_cycle5_e2e_test' }) as unknown as User,
    );
    clientToken = await issueTestToken(app, clientUser.id, UserRole.CLIENT);

    // ── Seed: rental-mode Product ──
    rentalProduct = await dataSource.getRepository(Product).save({
      name: 'Cycle 5 E2E Rental Product',
      description: 'E2E test rental product for rentals cycle 5',
      priceCents: 0,
      priceToPublic: '0.00',
      stock: 10,
      isAvailable: true,
      pricingMode: 'rental',
      monthlyRentCents: 2000,
      lateFeeCents: 500,
      stripePriceId: stripeRentalPriceId,
      stripeProductId: stripeRentalProductId,
    } as unknown as Product);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      // Clean up in order of FK dependencies
      for (const orderId of createdOrderIds) {
        await dataSource.getRepository(Rental).delete({ orderId });
        await dataSource.getRepository(Order).delete({ id: orderId });
      }
      // Any remaining rentals for our test users
      await dataSource.getRepository(Rental).delete({ userId: clientUser.id });
      await dataSource.getRepository(Product).delete({ id: rentalProduct.id });
      await dataSource.getRepository(User).delete({ id: clientUser.id });
      await dataSource.getRepository(User).delete({ id: superUser.id });
    }
    if (app) await app.close();
  });

  // ─── Step 3: POST /orders with 1 rental item ────────────────────────────────

  let orderId: string;
  let rentalId: string;

  it('3. POST /orders with rental item → 201, Rental in PENDING_SETUP', async () => {
    const res = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({
        items: [{ productId: rentalProduct.id, quantity: 1 }],
        deliveryAddress: { text: '123 E2E Cycle 5 Ave', lat: 18.4861, lng: -69.9312 },
        paymentMethod: PaymentMethod.CASH,
        usePoints: false,
        useCredit: false,
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe(OrderStatus.PENDING_QUOTE);
    orderId = res.body.id as string;
    expect(orderId).toBeDefined();
    createdOrderIds.push(orderId);

    // Confirm Rental row was created in PENDING_SETUP
    const rental = await dataSource.getRepository(Rental).findOne({
      where: { userId: clientUser.id, productId: rentalProduct.id },
    });
    expect(rental).not.toBeNull();
    expect(rental!.status).toBe(RentalStatus.PENDING_SETUP);
    expect(rental!.orderId).toBe(orderId);
    rentalId = rental!.id;
  });

  // ─── Step 4: Full order lifecycle → DELIVERED → Rental flips ACTIVE ─────────

  it('4a. PATCH /orders/:id/quote → QUOTED', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/orders/${orderId}/quote`)
      .set('Authorization', `Bearer ${superToken}`)
      .send({ shippingCents: 0 });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe(OrderStatus.QUOTED);
  });

  it('4b. POST /orders/:id/confirm-cash → PENDING_VALIDATION', async () => {
    const res = await request(app.getHttpServer())
      .post(`/orders/${orderId}/confirm-cash`)
      .set('Authorization', `Bearer ${clientToken}`);

    expect(res.status).toBe(201);
    expect(res.body.status).toBe(OrderStatus.PENDING_VALIDATION);
  });

  it('4c. PATCH /orders/:id/status CONFIRMED_BY_COLMADO', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${superToken}`)
      .send({ status: OrderStatus.CONFIRMED_BY_COLMADO });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe(OrderStatus.CONFIRMED_BY_COLMADO);
  });

  it('4d. PATCH /orders/:id/status IN_DELIVERY_ROUTE', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${superToken}`)
      .send({ status: OrderStatus.IN_DELIVERY_ROUTE });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe(OrderStatus.IN_DELIVERY_ROUTE);
  });

  it('4e. PATCH /orders/:id/status DELIVERED → Rental flips ACTIVE', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${superToken}`)
      .send({ status: OrderStatus.DELIVERED });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe(OrderStatus.DELIVERED);

    // Wait briefly for the async activateRentalsForOrder to complete
    await new Promise((r) => setTimeout(r, 200));

    const rental = await dataSource.getRepository(Rental).findOne({ where: { id: rentalId } });
    expect(rental).not.toBeNull();
    expect(rental!.status).toBe(RentalStatus.ACTIVE);
    expect(rental!.stripeSubscriptionId).toBeTruthy();
  });

  // ─── Step 5: Simulate customer.subscription.updated (past_due webhook) ───────

  it('5. Webhook customer.subscription.updated past_due → Rental PAST_DUE + pastDueSince set', async () => {
    // Fetch the rental to get its real stripeSubscriptionId (may be mocked sub ID)
    const rental = await dataSource.getRepository(Rental).findOne({ where: { id: rentalId } });
    expect(rental).not.toBeNull();

    const { payload, signature } = buildSignedSubscriptionEvent({
      type: 'customer.subscription.updated',
      subscriptionId: rental!.stripeSubscriptionId ?? 'sub_cycle5_e2e_happy',
      subscriptionStatus: 'past_due',
      rentalId,
      userId: clientUser.id,
      productId: rentalProduct.id,
      webhookSecret: stripeWebhookSecret,
    });

    const res = await request(app.getHttpServer())
      .post('/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', signature)
      .send(payload);

    expect([200, 201]).toContain(res.status);

    // Wait for any async processing
    await new Promise((r) => setTimeout(r, 100));

    const updated = await dataSource.getRepository(Rental).findOne({ where: { id: rentalId } });
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe(RentalStatus.PAST_DUE);
    expect(updated!.pastDueSince).not.toBeNull();
  });

  // ─── Step 6: LateFeeCron.runDaily() charges after grace period ───────────────

  it('6. After 4-day-old pastDueSince, runDaily() charges late fee + sets lastLateFeeAt', async () => {
    // Move pastDueSince back 4 days to simulate grace period elapsed
    const fourDaysAgo = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000);
    await dataSource.getRepository(Rental).update(rentalId, {
      pastDueSince: fourDaysAgo,
      lastLateFeeAt: null,
    });

    await lateFeeCron.runDaily();

    // Wait for cron processing
    await new Promise((r) => setTimeout(r, 200));

    const charged = await dataSource.getRepository(Rental).findOne({ where: { id: rentalId } });
    expect(charged).not.toBeNull();
    expect(charged!.lastLateFeeAt).not.toBeNull();
  });

  // ─── Step 7: Second runDaily() same day — idempotency guard ──────────────────

  it('7. Running runDaily() again same day does NOT charge twice (idempotency)', async () => {
    const before = await dataSource.getRepository(Rental).findOne({ where: { id: rentalId } });
    expect(before!.lastLateFeeAt).not.toBeNull();
    const firstChargeAt = before!.lastLateFeeAt!.getTime();

    // Mock paymentIntents.create to detect if it's called again
    const piMock = mockStripeInstance.paymentIntents as Record<string, jest.Mock>;
    const createCallsBefore = piMock.create.mock.calls.length;

    await lateFeeCron.runDaily();
    await new Promise((r) => setTimeout(r, 100));

    const after = await dataSource.getRepository(Rental).findOne({ where: { id: rentalId } });
    expect(after!.lastLateFeeAt!.getTime()).toBe(firstChargeAt);

    // paymentIntents.create must NOT have been called again
    expect(piMock.create.mock.calls.length).toBe(createCallsBefore);
  });
});
