/**
 * E2E spec: /me/rentals — customer rental list
 *
 * T70 — Me rentals controller tests (Phase 7, Batch 7)
 *
 * Tests:
 *   (a) no JWT → 401
 *   (b) client JWT → 200 own rentals (CustomerRentalResponseDto shape)
 *   (c) scope isolation — customer cannot see other customers' rentals
 *   (d) empty list → 200 []
 */

// Stripe must be mocked BEFORE any imports that load it.
// eslint-disable-next-line no-var
var mockStripeInstance: Record<string, unknown>;

jest.mock('stripe', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctor = jest.fn().mockImplementation(() => mockStripeInstance as any);
  return ctor;
});

mockStripeInstance = {
  prices: {
    retrieve: jest.fn().mockResolvedValue({ id: 'price_seed_test', product: 'prod_test', unit_amount: 1000, currency: 'usd', recurring: { interval: 'month' } }),
    create: jest.fn().mockResolvedValue({ id: 'price_new_test', unit_amount: 2000, currency: 'usd', recurring: { interval: 'month' } }),
    update: jest.fn().mockResolvedValue({}),
  },
  products: {
    create: jest.fn().mockResolvedValue({ id: 'prod_me_rentals_test' }),
    update: jest.fn().mockResolvedValue({}),
  },
  customers: {
    create: jest.fn().mockResolvedValue({ id: 'cus_me_rentals_test' }),
    search: jest.fn().mockResolvedValue({ data: [] }),
    update: jest.fn().mockResolvedValue({}),
    list: jest.fn().mockResolvedValue({ data: [] }),
  },
  subscriptions: {
    create: jest.fn().mockResolvedValue({ id: 'sub_me_test', status: 'active' }),
    retrieve: jest.fn().mockResolvedValue({ id: 'sub_me_test', status: 'active' }),
    update: jest.fn().mockResolvedValue({}),
    cancel: jest.fn().mockResolvedValue({ id: 'sub_me_test', status: 'canceled' }),
    list: jest.fn().mockResolvedValue({ data: [] }),
  },
  checkout: {
    sessions: { create: jest.fn().mockResolvedValue({ id: 'cs_me_test', url: 'https://stripe.test' }) },
  },
  billingPortal: {
    sessions: { create: jest.fn().mockResolvedValue({ url: 'https://stripe.test/portal' }) },
  },
  paymentIntents: {
    create: jest.fn().mockResolvedValue({ id: 'pi_me_test', status: 'succeeded' }),
    retrieve: jest.fn().mockResolvedValue({ id: 'pi_me_test', status: 'succeeded' }),
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

describe('/me/rentals E2E', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  let clientUserA: User;
  let clientUserB: User;
  let rentalProduct: Product;

  let tokenA: string;

  const createdUserIds: string[] = [];

  beforeAll(async () => {
    process.env.DB_HOST = 'localhost';
    process.env.DB_PORT = '5433';
    process.env.DB_USER = 'zaz_test';
    process.env.DB_PASSWORD = 'zaz_test';
    process.env.DB_NAME = 'zaz_test';
    process.env.STRIPE_SUBSCRIPTION_PRICE_ID = 'price_seed_test';

    app = await createTestingApp();
    dataSource = app.get(DataSource);

    clientUserA = await dataSource.getRepository(User).save(
      makeUser({ role: UserRole.CLIENT }) as unknown as User,
    );
    clientUserB = await dataSource.getRepository(User).save(
      makeUser({ role: UserRole.CLIENT }) as unknown as User,
    );
    createdUserIds.push(clientUserA.id, clientUserB.id);

    tokenA = await issueTestToken(app, clientUserA.id, UserRole.CLIENT);

    rentalProduct = await dataSource.getRepository(Product).save({
      name: 'Me Rentals Test Product',
      description: 'Integration test rental product for me/rentals spec',
      priceCents: 0,
      priceToPublic: '0.00',
      stock: 5,
      pricingMode: 'rental',
      monthlyRentCents: 2000,
      lateFeeCents: 500,
      stripePriceId: 'price_me_rentals_e2e',
      stripeProductId: 'prod_me_rentals_e2e',
    } as unknown as Product);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.getRepository(Rental).delete({ productId: rentalProduct.id });
      await dataSource.getRepository(Product).delete({ id: rentalProduct.id });
      for (const userId of createdUserIds) {
        await dataSource.getRepository(User).delete({ id: userId });
      }
    }
    if (app) await app.close();
  });

  beforeEach(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.getRepository(Rental).delete({ productId: rentalProduct.id });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // (a) Unauthenticated request
  // ─────────────────────────────────────────────────────────────────────────

  it('(a) no JWT → 401', async () => {
    const res = await request(app.getHttpServer()).get('/me/rentals');
    expect(res.status).toBe(401);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // (b) Customer sees own rentals with correct shape
  // ─────────────────────────────────────────────────────────────────────────

  it('(b) client JWT → 200 own rentals with CustomerRentalResponseDto shape', async () => {
    const nextCharge = new Date(Date.now() + 86400 * 29 * 1000);
    await dataSource.getRepository(Rental).save({
      userId: clientUserA.id,
      productId: rentalProduct.id,
      orderId: null,
      stripePriceId: 'price_me_rentals_e2e',
      monthlyRentCents: 2000,
      lateFeeCents: 500,
      status: RentalStatus.ACTIVE,
      stripeSubscriptionId: 'sub_me_test_a1',
      currentPeriodEnd: nextCharge,
    } as unknown as Rental);

    const res = await request(app.getHttpServer())
      .get('/me/rentals')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);

    const rental = res.body[0] as Record<string, unknown>;
    // CustomerRentalResponseDto fields
    expect(rental).toHaveProperty('id');
    expect(rental).toHaveProperty('productId', rentalProduct.id);
    expect(rental).toHaveProperty('productName');
    expect(rental).toHaveProperty('monthlyRentCents', 2000);
    expect(rental).toHaveProperty('status', RentalStatus.ACTIVE);
    expect(rental).toHaveProperty('nextChargeAt');
    expect(rental).toHaveProperty('activatedAt');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // (c) Scope isolation — Customer A cannot see Customer B's rentals
  // ─────────────────────────────────────────────────────────────────────────

  it('(c) scope isolation — customer cannot see other users rentals', async () => {
    // Create rental for User B
    await dataSource.getRepository(Rental).save({
      userId: clientUserB.id,
      productId: rentalProduct.id,
      orderId: null,
      stripePriceId: 'price_me_rentals_e2e',
      monthlyRentCents: 2000,
      lateFeeCents: 500,
      status: RentalStatus.ACTIVE,
      stripeSubscriptionId: 'sub_me_test_b1',
    } as unknown as Rental);

    // Call with User A's token
    const res = await request(app.getHttpServer())
      .get('/me/rentals')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    // User A has no rentals → should return empty array
    expect(res.body).toHaveLength(0);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // (d) Empty list
  // ─────────────────────────────────────────────────────────────────────────

  it('(d) no rentals → 200 empty array', async () => {
    const res = await request(app.getHttpServer())
      .get('/me/rentals')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(0);
  });
});
