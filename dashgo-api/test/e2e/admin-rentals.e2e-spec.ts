/**
 * E2E spec: Admin rentals management
 *
 * T68 — Admin rentals controller tests (Phase 7, Batch 7)
 *
 * Tests per endpoint:
 *
 * GET /admin/rentals
 *   (a) no JWT → 401
 *   (b) CLIENT role → 403
 *   (c) super-admin + status filter → 200 filtered list
 *   (d) super-admin + userId filter → 200 filtered list
 *   (e) super-admin + productId filter → 200 filtered list
 *   (f) super-admin no filters → 200 all rentals (paginated)
 *
 * GET /admin/rentals/delinquent
 *   (g) no JWT → 401
 *   (h) CLIENT role → 403
 *   (i) super-admin → 200 returns only delinquent rentals
 *
 * POST /admin/rentals/:id/charge-late-fee
 *   (j) no JWT → 401
 *   (k) CLIENT role → 403
 *   (l) happy path → 200 ChargeLateFeeResponseDto
 *   (m) lateFeeCents=0 → 503 LATE_FEE_NOT_CONFIGURED
 *   (n) Stripe failure → 502 STRIPE_PAYMENT_FAILED
 *
 * POST /admin/rentals/:id/cancel
 *   (o) no JWT → 401
 *   (p) CLIENT role → 403
 *   (q) happy path (active rental) → 200
 *   (r) already-canceled → idempotent 200
 *   (s) rental not found → 404
 *
 * POST /admin/rentals/:id/retry-setup
 *   (t) no JWT → 401
 *   (u) CLIENT role → 403
 *   (v) happy path (pending_setup) → 200
 *   (w) wrong status (not pending_setup) → 409
 */

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
    retrieve: jest.fn().mockResolvedValue({ id: 'price_seed_test', product: 'prod_test', unit_amount: 1000, currency: 'usd', recurring: { interval: 'month' } }),
    create: jest.fn().mockResolvedValue({ id: 'price_new_test', unit_amount: 2000, currency: 'usd', recurring: { interval: 'month' } }),
    update: jest.fn().mockResolvedValue({}),
  },
  products: {
    create: jest.fn().mockResolvedValue({ id: 'prod_test_rental' }),
    update: jest.fn().mockResolvedValue({}),
  },
  customers: {
    create: jest.fn().mockResolvedValue({ id: 'cus_admin_rental_test' }),
    search: jest.fn().mockResolvedValue({ data: [] }),
    update: jest.fn().mockResolvedValue({}),
    list: jest.fn().mockResolvedValue({ data: [] }),
  },
  subscriptions: {
    create: jest.fn().mockResolvedValue({
      id: 'sub_admin_rental_test',
      status: 'active',
      current_period_start: NOW_UNIX,
      current_period_end: FUTURE_UNIX,
      items: { data: [{ current_period_start: NOW_UNIX, current_period_end: FUTURE_UNIX }] },
      metadata: { rentalId: '', userId: '', productId: '' },
    }),
    retrieve: jest.fn().mockResolvedValue({ id: 'sub_admin_rental_test', current_period_start: NOW_UNIX, current_period_end: FUTURE_UNIX }),
    update: jest.fn().mockResolvedValue({}),
    cancel: jest.fn().mockResolvedValue({ id: 'sub_admin_rental_test', status: 'canceled' }),
    list: jest.fn().mockResolvedValue({ data: [] }),
  },
  checkout: {
    sessions: { create: jest.fn().mockResolvedValue({ id: 'cs_test', url: 'https://stripe.test' }) },
  },
  billingPortal: {
    sessions: { create: jest.fn().mockResolvedValue({ url: 'https://stripe.test/portal' }) },
  },
  paymentIntents: {
    create: jest.fn().mockResolvedValue({ id: 'pi_late_fee_test', status: 'succeeded', amount: 500, currency: 'usd' }),
    retrieve: jest.fn().mockResolvedValue({ id: 'pi_late_fee_test', status: 'succeeded' }),
    cancel: jest.fn().mockResolvedValue({}),
    capture: jest.fn().mockResolvedValue({}),
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
import { Rental, RentalStatus } from '../../src/entities/rental.entity';
import { Product } from '../../src/entities/product.entity';
import { UserRole } from '../../src/entities/enums';
import { issueTestToken } from './helpers/auth.helper';

describe('Admin Rentals E2E', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  let clientUser: User;
  let superUser: User;
  let rentalProduct: Product;

  let clientToken: string;
  let superToken: string;

  // IDs to track for cleanup
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    process.env.DB_HOST = 'localhost';
    process.env.DB_PORT = '5433';
    process.env.DB_USER = 'dashgo_test';
    process.env.DB_PASSWORD = 'dashgo_test';
    process.env.DB_NAME = 'dashgo_test';
    process.env.STRIPE_SUBSCRIPTION_PRICE_ID = 'price_seed_test';

    app = await createTestingApp();
    dataSource = app.get(DataSource);

    clientUser = await dataSource.getRepository(User).save(
      makeUser({ role: UserRole.CLIENT }) as unknown as User,
    );
    superUser = await dataSource.getRepository(User).save(
      makeUser({ role: UserRole.SUPER_ADMIN_DELIVERY }) as unknown as User,
    );
    createdUserIds.push(clientUser.id, superUser.id);

    clientToken = await issueTestToken(app, clientUser.id, UserRole.CLIENT);
    superToken = await issueTestToken(app, superUser.id, UserRole.SUPER_ADMIN_DELIVERY);

    // Create a test product with rental pricing
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rentalProduct = await dataSource.getRepository(Product).save({
      name: 'Test Rental Product E2E',
      description: 'Integration test rental product',
      priceCents: 0,
      priceToPublic: '0.00',
      stock: 10,
      pricingMode: 'rental',
      monthlyRentCents: 2000,
      lateFeeCents: 500,
      stripePriceId: 'price_rental_e2e_test',
      stripeProductId: 'prod_rental_e2e_test',
    } as unknown as Product);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.getRepository(Rental).delete({ userId: clientUser.id });
      await dataSource.getRepository(Product).delete({ id: rentalProduct.id });
      for (const userId of createdUserIds) {
        await dataSource.getRepository(User).delete({ id: userId });
      }
    }
    if (app) await app.close();
  });

  // Clean rentals between tests
  beforeEach(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.getRepository(Rental).delete({ userId: clientUser.id });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // GET /admin/rentals — auth guard
  // ─────────────────────────────────────────────────────────────────────────

  describe('GET /admin/rentals — auth guard', () => {
    it('(a) no JWT → 401', async () => {
      const res = await request(app.getHttpServer()).get('/admin/rentals');
      expect(res.status).toBe(401);
    });

    it('(b) CLIENT role → 403', async () => {
      const res = await request(app.getHttpServer())
        .get('/admin/rentals')
        .set('Authorization', `Bearer ${clientToken}`);
      expect(res.status).toBe(403);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // GET /admin/rentals — happy path + filters
  // ─────────────────────────────────────────────────────────────────────────

  describe('GET /admin/rentals — super-admin', () => {
    it('(c) super-admin + status filter → 200 filtered by status', async () => {
      // Create two rentals: one active, one canceled
      await dataSource.getRepository(Rental).save({
        userId: clientUser.id,
        productId: rentalProduct.id,
        orderId: null,
        stripePriceId: 'price_rental_e2e_test',
        monthlyRentCents: 2000,
        lateFeeCents: 500,
        status: RentalStatus.ACTIVE,
        stripeSubscriptionId: 'sub_filter_active',
      } as unknown as Rental);
      await dataSource.getRepository(Rental).save({
        userId: clientUser.id,
        productId: rentalProduct.id,
        orderId: null,
        stripePriceId: 'price_rental_e2e_test',
        monthlyRentCents: 2000,
        lateFeeCents: 500,
        status: RentalStatus.CANCELED,
        stripeSubscriptionId: 'sub_filter_canceled',
      } as unknown as Rental);

      const res = await request(app.getHttpServer())
        .get('/admin/rentals')
        .query({ status: RentalStatus.ACTIVE })
        .set('Authorization', `Bearer ${superToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('items');
      expect(res.body).toHaveProperty('total');
      const items = res.body.items as Array<{ status: string }>;
      expect(items.every((r) => r.status === RentalStatus.ACTIVE)).toBe(true);
    });

    it('(d) super-admin + userId filter → 200 filtered by userId', async () => {
      await dataSource.getRepository(Rental).save({
        userId: clientUser.id,
        productId: rentalProduct.id,
        orderId: null,
        stripePriceId: 'price_rental_e2e_test',
        monthlyRentCents: 2000,
        lateFeeCents: 500,
        status: RentalStatus.ACTIVE,
        stripeSubscriptionId: 'sub_user_filter_test',
      } as unknown as Rental);

      const res = await request(app.getHttpServer())
        .get('/admin/rentals')
        .query({ userId: clientUser.id })
        .set('Authorization', `Bearer ${superToken}`);

      expect(res.status).toBe(200);
      const items = res.body.items as Array<{ userId: string }>;
      expect(items.every((r) => r.userId === clientUser.id)).toBe(true);
    });

    it('(e) super-admin + productId filter → 200 filtered by productId', async () => {
      await dataSource.getRepository(Rental).save({
        userId: clientUser.id,
        productId: rentalProduct.id,
        orderId: null,
        stripePriceId: 'price_rental_e2e_test',
        monthlyRentCents: 2000,
        lateFeeCents: 500,
        status: RentalStatus.PENDING_SETUP,
        stripeSubscriptionId: null,
      } as unknown as Rental);

      const res = await request(app.getHttpServer())
        .get('/admin/rentals')
        .query({ productId: rentalProduct.id })
        .set('Authorization', `Bearer ${superToken}`);

      expect(res.status).toBe(200);
      const items = res.body.items as Array<{ productId: string }>;
      expect(items.every((r) => r.productId === rentalProduct.id)).toBe(true);
    });

    it('(f) super-admin no filters → 200 with items + total', async () => {
      const res = await request(app.getHttpServer())
        .get('/admin/rentals')
        .set('Authorization', `Bearer ${superToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('items');
      expect(res.body).toHaveProperty('total');
      expect(Array.isArray(res.body.items)).toBe(true);
      expect(typeof res.body.total).toBe('number');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // GET /admin/rentals/delinquent — auth guard + happy path
  // ─────────────────────────────────────────────────────────────────────────

  describe('GET /admin/rentals/delinquent', () => {
    it('(g) no JWT → 401', async () => {
      const res = await request(app.getHttpServer()).get('/admin/rentals/delinquent');
      expect(res.status).toBe(401);
    });

    it('(h) CLIENT role → 403', async () => {
      const res = await request(app.getHttpServer())
        .get('/admin/rentals/delinquent')
        .set('Authorization', `Bearer ${clientToken}`);
      expect(res.status).toBe(403);
    });

    it('(i) super-admin → 200 returns delinquent only', async () => {
      const pastDate = new Date(Date.now() - 2 * 86400 * 1000); // 2 days ago
      // Insert a past_due rental with overdue currentPeriodEnd
      await dataSource.getRepository(Rental).save({
        userId: clientUser.id,
        productId: rentalProduct.id,
        orderId: null,
        stripePriceId: 'price_rental_e2e_test',
        monthlyRentCents: 2000,
        lateFeeCents: 500,
        status: RentalStatus.PAST_DUE,
        stripeSubscriptionId: 'sub_delinquent_test',
        currentPeriodEnd: pastDate,
      } as unknown as Rental);

      const res = await request(app.getHttpServer())
        .get('/admin/rentals/delinquent')
        .set('Authorization', `Bearer ${superToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      // Should contain the delinquent rental
      const delinquent = res.body as Array<{ status: string }>;
      const hasDelinquent = delinquent.some((r) => r.status === RentalStatus.PAST_DUE);
      expect(hasDelinquent).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // POST /admin/rentals/:id/charge-late-fee
  // ─────────────────────────────────────────────────────────────────────────

  describe('POST /admin/rentals/:id/charge-late-fee', () => {
    it('(j) no JWT → 401', async () => {
      const res = await request(app.getHttpServer())
        .post('/admin/rentals/00000000-0000-0000-0000-000000000001/charge-late-fee')
        .send({});
      expect(res.status).toBe(401);
    });

    it('(k) CLIENT role → 403', async () => {
      const res = await request(app.getHttpServer())
        .post('/admin/rentals/00000000-0000-0000-0000-000000000001/charge-late-fee')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({});
      expect(res.status).toBe(403);
    });

    it('(l) happy path → 200 ChargeLateFeeResponseDto', async () => {
      // User needs a stripeCustomerId for the late fee charge
      await dataSource.getRepository(User).update(clientUser.id, { stripeCustomerId: 'cus_admin_rental_test' });

      const rental = await dataSource.getRepository(Rental).save({
        userId: clientUser.id,
        productId: rentalProduct.id,
        orderId: null,
        stripePriceId: 'price_rental_e2e_test',
        monthlyRentCents: 2000,
        lateFeeCents: 500,
        status: RentalStatus.PAST_DUE,
        stripeSubscriptionId: 'sub_late_fee_happy',
      } as unknown as Rental);

      const piMock = mockStripeInstance.paymentIntents as Record<string, jest.Mock>;
      piMock.create.mockResolvedValueOnce({ id: 'pi_late_fee_happy', status: 'succeeded', amount: 500, currency: 'usd' });

      const res = await request(app.getHttpServer())
        .post(`/admin/rentals/${rental.id}/charge-late-fee`)
        .set('Authorization', `Bearer ${superToken}`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('chargedCents', 500);
      expect(res.body).toHaveProperty('paymentIntentId');
      expect(res.body).toHaveProperty('subscriptionCanceled', false);
    });

    it('(m) lateFeeCents=0 → 503 LATE_FEE_NOT_CONFIGURED', async () => {
      const noFeeProduct = await dataSource.getRepository(Product).save({
        name: 'No Late Fee Product E2E',
        description: 'No late fee test product',
        priceCents: 0,
        priceToPublic: '0.00',
        stock: 10,
        pricingMode: 'rental',
        monthlyRentCents: 2000,
        lateFeeCents: 0,
        stripePriceId: 'price_no_fee_e2e',
        stripeProductId: 'prod_no_fee_e2e',
      } as unknown as Product);

      const rental = await dataSource.getRepository(Rental).save({
        userId: clientUser.id,
        productId: noFeeProduct.id,
        orderId: null,
        stripePriceId: 'price_no_fee_e2e',
        monthlyRentCents: 2000,
        lateFeeCents: 0,
        status: RentalStatus.PAST_DUE,
        stripeSubscriptionId: 'sub_no_fee_test',
      } as unknown as Rental);

      const res = await request(app.getHttpServer())
        .post(`/admin/rentals/${rental.id}/charge-late-fee`)
        .set('Authorization', `Bearer ${superToken}`)
        .send({});

      expect(res.status).toBe(503);

      // cleanup
      await dataSource.getRepository(Rental).delete({ id: rental.id });
      await dataSource.getRepository(Product).delete({ id: noFeeProduct.id });
    });

    it('(n) Stripe failure → 502 STRIPE_PAYMENT_FAILED', async () => {
      await dataSource.getRepository(User).update(clientUser.id, { stripeCustomerId: 'cus_admin_rental_test' });

      const rental = await dataSource.getRepository(Rental).save({
        userId: clientUser.id,
        productId: rentalProduct.id,
        orderId: null,
        stripePriceId: 'price_rental_e2e_test',
        monthlyRentCents: 2000,
        lateFeeCents: 500,
        status: RentalStatus.PAST_DUE,
        stripeSubscriptionId: 'sub_stripe_fail_test',
      } as unknown as Rental);

      const piMock = mockStripeInstance.paymentIntents as Record<string, jest.Mock>;
      piMock.create.mockRejectedValueOnce(new Error('Stripe connection error'));

      const res = await request(app.getHttpServer())
        .post(`/admin/rentals/${rental.id}/charge-late-fee`)
        .set('Authorization', `Bearer ${superToken}`)
        .send({});

      expect(res.status).toBe(502);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // POST /admin/rentals/:id/cancel
  // ─────────────────────────────────────────────────────────────────────────

  describe('POST /admin/rentals/:id/cancel', () => {
    it('(o) no JWT → 401', async () => {
      const res = await request(app.getHttpServer())
        .post('/admin/rentals/00000000-0000-0000-0000-000000000002/cancel');
      expect(res.status).toBe(401);
    });

    it('(p) CLIENT role → 403', async () => {
      const res = await request(app.getHttpServer())
        .post('/admin/rentals/00000000-0000-0000-0000-000000000002/cancel')
        .set('Authorization', `Bearer ${clientToken}`);
      expect(res.status).toBe(403);
    });

    it('(q) happy path — active rental → 200 canceled', async () => {
      const rental = await dataSource.getRepository(Rental).save({
        userId: clientUser.id,
        productId: rentalProduct.id,
        orderId: null,
        stripePriceId: 'price_rental_e2e_test',
        monthlyRentCents: 2000,
        lateFeeCents: 500,
        status: RentalStatus.ACTIVE,
        stripeSubscriptionId: 'sub_cancel_happy_test',
      } as unknown as Rental);

      const subsMock = mockStripeInstance.subscriptions as Record<string, jest.Mock>;
      subsMock.cancel.mockResolvedValueOnce({ id: 'sub_cancel_happy_test', status: 'canceled' });

      const res = await request(app.getHttpServer())
        .post(`/admin/rentals/${rental.id}/cancel`)
        .set('Authorization', `Bearer ${superToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status', RentalStatus.CANCELED);
      expect(res.body).toHaveProperty('canceledAt');
    });

    it('(r) already-canceled rental → idempotent 200', async () => {
      const rental = await dataSource.getRepository(Rental).save({
        userId: clientUser.id,
        productId: rentalProduct.id,
        orderId: null,
        stripePriceId: 'price_rental_e2e_test',
        monthlyRentCents: 2000,
        lateFeeCents: 500,
        status: RentalStatus.CANCELED,
        stripeSubscriptionId: 'sub_already_canceled',
        canceledAt: new Date(),
      } as unknown as Rental);

      const res = await request(app.getHttpServer())
        .post(`/admin/rentals/${rental.id}/cancel`)
        .set('Authorization', `Bearer ${superToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status', RentalStatus.CANCELED);
    });

    it('(s) rental not found → 404', async () => {
      const res = await request(app.getHttpServer())
        .post('/admin/rentals/00000000-0000-0000-0000-000000000003/cancel')
        .set('Authorization', `Bearer ${superToken}`);
      expect(res.status).toBe(404);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // POST /admin/rentals/:id/retry-setup
  // ─────────────────────────────────────────────────────────────────────────

  describe('POST /admin/rentals/:id/retry-setup', () => {
    it('(t) no JWT → 401', async () => {
      const res = await request(app.getHttpServer())
        .post('/admin/rentals/00000000-0000-0000-0000-000000000004/retry-setup');
      expect(res.status).toBe(401);
    });

    it('(u) CLIENT role → 403', async () => {
      const res = await request(app.getHttpServer())
        .post('/admin/rentals/00000000-0000-0000-0000-000000000004/retry-setup')
        .set('Authorization', `Bearer ${clientToken}`);
      expect(res.status).toBe(403);
    });

    it('(v) happy path — pending_setup rental → 200 active', async () => {
      await dataSource.getRepository(User).update(clientUser.id, { stripeCustomerId: 'cus_admin_rental_test' });

      const rental = await dataSource.getRepository(Rental).save({
        userId: clientUser.id,
        productId: rentalProduct.id,
        orderId: null,
        stripePriceId: 'price_rental_e2e_test',
        monthlyRentCents: 2000,
        lateFeeCents: 500,
        status: RentalStatus.PENDING_SETUP,
        stripeSubscriptionId: null,
      } as unknown as Rental);

      const subsMock = mockStripeInstance.subscriptions as Record<string, jest.Mock>;
      subsMock.create.mockResolvedValueOnce({
        id: 'sub_retry_setup_result',
        status: 'active',
        current_period_start: NOW_UNIX,
        current_period_end: FUTURE_UNIX,
        items: { data: [{ current_period_start: NOW_UNIX, current_period_end: FUTURE_UNIX }] },
        metadata: { rentalId: rental.id, userId: clientUser.id, productId: rentalProduct.id },
      });

      const res = await request(app.getHttpServer())
        .post(`/admin/rentals/${rental.id}/retry-setup`)
        .set('Authorization', `Bearer ${superToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status', RentalStatus.ACTIVE);
      expect(res.body).toHaveProperty('stripeSubscriptionId', 'sub_retry_setup_result');
    });

    it('(w) wrong status (not pending_setup) → 409', async () => {
      const rental = await dataSource.getRepository(Rental).save({
        userId: clientUser.id,
        productId: rentalProduct.id,
        orderId: null,
        stripePriceId: 'price_rental_e2e_test',
        monthlyRentCents: 2000,
        lateFeeCents: 500,
        status: RentalStatus.ACTIVE,
        stripeSubscriptionId: 'sub_retry_wrong_status',
      } as unknown as Rental);

      const res = await request(app.getHttpServer())
        .post(`/admin/rentals/${rental.id}/retry-setup`)
        .set('Authorization', `Bearer ${superToken}`);

      expect(res.status).toBe(409);
    });
  });
});
