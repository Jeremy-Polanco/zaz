/**
 * E2E spec: GET /admin/users/:userId/addresses — super-admin view of a user's addresses
 *
 * Pair F (T35/T36):
 *   (f1) no JWT → 401
 *   (f2) CLIENT role → 403
 *   (f3) PROMOTER role → 403
 *   (f4) SUPER_ADMIN_DELIVERY → 200 with target user's addresses
 *   (f5) SUPER_ADMIN_DELIVERY, non-existent userId (valid UUID) → 200 []
 *   (f6) SUPER_ADMIN_DELIVERY, malformed userId (not a UUID) → 400
 *   (f7) POST /admin/users/:userId/addresses → 404 (endpoint not implemented)
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
    create: jest.fn().mockResolvedValue({ id: 'price_new_test', unit_amount: 1500, currency: 'usd', recurring: { interval: 'month' } }),
    update: jest.fn().mockResolvedValue({}),
  },
  products: { update: jest.fn().mockResolvedValue({}) },
  customers: {
    create: jest.fn().mockResolvedValue({ id: 'cus_test' }),
    search: jest.fn().mockResolvedValue({ data: [] }),
    update: jest.fn(),
    list: jest.fn(),
  },
  subscriptions: { create: jest.fn(), retrieve: jest.fn(), update: jest.fn(), list: jest.fn() },
  checkout: { sessions: { create: jest.fn().mockResolvedValue({ id: 'cs_test', url: 'https://stripe.test' }) } },
  billingPortal: { sessions: { create: jest.fn().mockResolvedValue({ url: 'https://stripe.test/portal' }) } },
  paymentIntents: { create: jest.fn(), retrieve: jest.fn(), cancel: jest.fn(), capture: jest.fn() },
  webhooks: { constructEvent: jest.fn((rawBody: Buffer) => JSON.parse(rawBody.toString()) as unknown) },
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createTestingApp } from '../../src/test-utils/testing-app';
import { makeUser } from '../../src/test-utils/fixtures';
import { User } from '../../src/entities/user.entity';
import { UserAddress } from '../../src/entities/user-address.entity';
import { UserRole } from '../../src/entities/enums';
import { issueTestToken } from './helpers/auth.helper';

describe('GET /admin/users/:userId/addresses E2E', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  let targetUser: User;
  let clientUser: User;
  let promoterUser: User;
  let superUser: User;

  let clientToken: string;
  let promoterToken: string;
  let superToken: string;

  beforeAll(async () => {
    process.env.DB_HOST = 'localhost';
    process.env.DB_PORT = '5433';
    process.env.DB_USER = 'zaz_test';
    process.env.DB_PASSWORD = 'zaz_test';
    process.env.DB_NAME = 'zaz_test';
    process.env.STRIPE_SUBSCRIPTION_PRICE_ID = 'price_seed_test';

    app = await createTestingApp();
    dataSource = app.get(DataSource);

    targetUser = await dataSource.getRepository(User).save(
      makeUser({ role: UserRole.CLIENT }) as unknown as User,
    );
    clientUser = await dataSource.getRepository(User).save(
      makeUser({ role: UserRole.CLIENT }) as unknown as User,
    );
    promoterUser = await dataSource.getRepository(User).save(
      makeUser({ role: UserRole.PROMOTER }) as unknown as User,
    );
    superUser = await dataSource.getRepository(User).save(
      makeUser({ role: UserRole.SUPER_ADMIN_DELIVERY }) as unknown as User,
    );

    clientToken = await issueTestToken(app, clientUser.id, UserRole.CLIENT);
    promoterToken = await issueTestToken(app, promoterUser.id, UserRole.PROMOTER);
    superToken = await issueTestToken(app, superUser.id, UserRole.SUPER_ADMIN_DELIVERY);

    // Create 2 addresses for targetUser
    await dataSource.getRepository(UserAddress).save({
      userId: targetUser.id,
      label: 'Casa',
      line1: 'Av. Lincoln 100',
      lat: 18.47,
      lng: -69.95,
      isDefault: true,
    } as Partial<UserAddress> as UserAddress);
    await dataSource.getRepository(UserAddress).save({
      userId: targetUser.id,
      label: 'Oficina',
      line1: 'Calle El Conde 5',
      lat: 18.48,
      lng: -69.90,
      isDefault: false,
    } as Partial<UserAddress> as UserAddress);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      // Cascade deletes addresses via FK ON DELETE CASCADE
      await dataSource.getRepository(User).delete({ id: targetUser.id });
      await dataSource.getRepository(User).delete({ id: clientUser.id });
      await dataSource.getRepository(User).delete({ id: promoterUser.id });
      await dataSource.getRepository(User).delete({ id: superUser.id });
    }
    if (app) await app.close();
  });

  // ---------------------------------------------------------------------------
  // Auth guard tests (RED until admin controller is wired)
  // ---------------------------------------------------------------------------

  describe('Auth guard', () => {
    it('(f1) no JWT → 401', async () => {
      const res = await request(app.getHttpServer())
        .get(`/admin/users/${targetUser.id}/addresses`);
      expect(res.status).toBe(401);
    });

    it('(f2) CLIENT role → 403', async () => {
      const res = await request(app.getHttpServer())
        .get(`/admin/users/${targetUser.id}/addresses`)
        .set('Authorization', `Bearer ${clientToken}`);
      expect(res.status).toBe(403);
    });

    it('(f3) PROMOTER role → 403', async () => {
      const res = await request(app.getHttpServer())
        .get(`/admin/users/${targetUser.id}/addresses`)
        .set('Authorization', `Bearer ${promoterToken}`);
      expect(res.status).toBe(403);
    });
  });

  // ---------------------------------------------------------------------------
  // Happy path tests
  // ---------------------------------------------------------------------------

  describe('Happy path', () => {
    it('(f4) SUPER_ADMIN_DELIVERY → 200 with target user addresses', async () => {
      const res = await request(app.getHttpServer())
        .get(`/admin/users/${targetUser.id}/addresses`)
        .set('Authorization', `Bearer ${superToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(2);

      // Default address should come first (ordered isDefault DESC, createdAt ASC)
      expect(res.body[0].isDefault).toBe(true);
      expect(res.body[0].label).toBe('Casa');
      expect(res.body[1].isDefault).toBe(false);
      expect(res.body[1].label).toBe('Oficina');

      // lat/lng are numbers, not strings
      expect(typeof res.body[0].lat).toBe('number');
      expect(typeof res.body[0].lng).toBe('number');
    });

    it('(f5) non-existent userId (valid UUID) → 200 []', async () => {
      const fakeUserId = '00000000-0000-0000-0000-000000000099';
      const res = await request(app.getHttpServer())
        .get(`/admin/users/${fakeUserId}/addresses`)
        .set('Authorization', `Bearer ${superToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('(f6) malformed userId (not a UUID) → 400', async () => {
      const res = await request(app.getHttpServer())
        .get('/admin/users/not-a-uuid/addresses')
        .set('Authorization', `Bearer ${superToken}`);

      expect(res.status).toBe(400);
    });
  });

  // ---------------------------------------------------------------------------
  // No write endpoints (spec requirement: only GET exists)
  // ---------------------------------------------------------------------------

  describe('No write endpoints', () => {
    it('(f7) POST /admin/users/:userId/addresses → 404 (not implemented)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/admin/users/${targetUser.id}/addresses`)
        .set('Authorization', `Bearer ${superToken}`)
        .send({ label: 'Test', line1: 'Test St', lat: 18.47, lng: -69.9 });
      expect(res.status).toBe(404);
    });
  });
});
