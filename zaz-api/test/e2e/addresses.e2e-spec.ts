/**
 * E2E spec: /me/addresses — client address management
 *
 * Pairs covered (Phase 3, Batch 3):
 *
 * Pair A (T25/T26) — GET /me/addresses
 *   (a1) no JWT → 401
 *   (a2) valid JWT → 200 with owned addresses (array)
 *   (a3) lat/lng are numbers, not strings (transformer check)
 *
 * Pair B (T27/T28) — POST /me/addresses
 *   (b1) valid body → 201 created; first address has isDefault:true
 *   (b2) second address has isDefault:false
 *   (b3) missing label → 400
 *   (b4) out-of-range lat → 400
 *   (b5) ADDRESS_CAP_EXCEEDED after 10 addresses
 *
 * Pair C (T29/T30) — PATCH /me/addresses/:id
 *   (c1) own address → 200 updated
 *   (c2) other user's address → 404
 *   (c3) non-existent UUID → 404
 *
 * Pair D (T31/T32) — DELETE /me/addresses/:id
 *   (d1) no JWT → 401
 *   (d2) own address → 204
 *   (d3) other user's address → 404
 *   (d4) deleting default with others present → promotes most recent
 *
 * Pair E (T33/T34) — PATCH /me/addresses/:id/set-default
 *   (e1) no JWT → 401
 *   (e2) own address → 200 with isDefault:true
 *   (e3) other user's address → 404
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

const BASE_ADDRESS = {
  label: 'Casa',
  line1: 'Av. 27 de Febrero 100',
  lat: 18.47,
  lng: -69.95,
};

describe('/me/addresses E2E', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  let clientUser: User;
  let otherUser: User;
  let clientToken: string;
  let otherToken: string;

  beforeAll(async () => {
    process.env.DB_HOST = 'localhost';
    process.env.DB_PORT = '5433';
    process.env.DB_USER = 'zaz_test';
    process.env.DB_PASSWORD = 'zaz_test';
    process.env.DB_NAME = 'zaz_test';
    process.env.STRIPE_SUBSCRIPTION_PRICE_ID = 'price_seed_test';

    app = await createTestingApp();
    dataSource = app.get(DataSource);

    clientUser = await dataSource.getRepository(User).save(
      makeUser({ role: UserRole.CLIENT }) as unknown as User,
    );
    otherUser = await dataSource.getRepository(User).save(
      makeUser({ role: UserRole.CLIENT }) as unknown as User,
    );

    clientToken = await issueTestToken(app, clientUser.id, UserRole.CLIENT);
    otherToken = await issueTestToken(app, otherUser.id, UserRole.CLIENT);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      // Cascade deletes addresses via FK ON DELETE CASCADE
      await dataSource.getRepository(User).delete({ id: clientUser.id });
      await dataSource.getRepository(User).delete({ id: otherUser.id });
    }
    if (app) await app.close();
  });

  // Clean up addresses between major describe blocks to keep tests isolated
  beforeEach(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.getRepository(UserAddress).delete({ userId: clientUser.id });
      await dataSource.getRepository(UserAddress).delete({ userId: otherUser.id });
    }
  });

  // ---------------------------------------------------------------------------
  // Pair A — GET /me/addresses
  // ---------------------------------------------------------------------------

  describe('GET /me/addresses', () => {
    it('(a1) no JWT → 401', async () => {
      const res = await request(app.getHttpServer()).get('/me/addresses');
      expect(res.status).toBe(401);
    });

    it('(a2) valid JWT → 200 with empty array when no addresses', async () => {
      const res = await request(app.getHttpServer())
        .get('/me/addresses')
        .set('Authorization', `Bearer ${clientToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(0);
    });

    it('(a3) returns addresses with lat/lng as numbers (transformer check)', async () => {
      // Create one address directly in DB
      await dataSource.getRepository(UserAddress).save({
        userId: clientUser.id,
        label: 'Test',
        line1: 'Calle 1',
        lat: 18.47,
        lng: -69.95,
        isDefault: true,
      } as Partial<UserAddress> as UserAddress);

      const res = await request(app.getHttpServer())
        .get('/me/addresses')
        .set('Authorization', `Bearer ${clientToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(typeof res.body[0].lat).toBe('number');
      expect(typeof res.body[0].lng).toBe('number');
    });

    it('(a4) only returns own addresses, not other users', async () => {
      // Create address for otherUser
      await dataSource.getRepository(UserAddress).save({
        userId: otherUser.id,
        label: 'Otro',
        line1: 'Calle 2',
        lat: 18.48,
        lng: -69.96,
        isDefault: true,
      } as Partial<UserAddress> as UserAddress);

      const res = await request(app.getHttpServer())
        .get('/me/addresses')
        .set('Authorization', `Bearer ${clientToken}`);

      expect(res.status).toBe(200);
      // clientUser has no addresses, other user's addresses are not returned
      expect(res.body).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Pair B — POST /me/addresses
  // ---------------------------------------------------------------------------

  describe('POST /me/addresses', () => {
    it('(b1) no JWT → 401', async () => {
      const res = await request(app.getHttpServer())
        .post('/me/addresses')
        .send(BASE_ADDRESS);
      expect(res.status).toBe(401);
    });

    it('(b2) valid body → 201 created; first address has isDefault:true', async () => {
      const res = await request(app.getHttpServer())
        .post('/me/addresses')
        .set('Authorization', `Bearer ${clientToken}`)
        .send(BASE_ADDRESS);

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.label).toBe('Casa');
      expect(res.body.line1).toBe('Av. 27 de Febrero 100');
      expect(res.body.isDefault).toBe(true);
      expect(res.body.userId).toBe(clientUser.id);
    });

    it('(b3) second address has isDefault:false', async () => {
      // First address
      await request(app.getHttpServer())
        .post('/me/addresses')
        .set('Authorization', `Bearer ${clientToken}`)
        .send(BASE_ADDRESS);

      // Second address
      const res = await request(app.getHttpServer())
        .post('/me/addresses')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ ...BASE_ADDRESS, label: 'Oficina' });

      expect(res.status).toBe(201);
      expect(res.body.isDefault).toBe(false);
    });

    it('(b4) missing label → 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/me/addresses')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ line1: 'Calle 5', lat: 18.47, lng: -69.9 });
      expect(res.status).toBe(400);
    });

    it('(b5) missing line1 → 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/me/addresses')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ label: 'Casa', lat: 18.47, lng: -69.9 });
      expect(res.status).toBe(400);
    });

    it('(b6) out-of-range lat (91) → 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/me/addresses')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ label: 'Casa', line1: 'Calle', lat: 91, lng: 0 });
      expect(res.status).toBe(400);
    });

    it('(b7) out-of-range lng (181) → 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/me/addresses')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ label: 'Casa', line1: 'Calle', lat: 18.47, lng: 181 });
      expect(res.status).toBe(400);
    });

    it('(b8) ADDRESS_CAP_EXCEEDED after 10 addresses → 400', async () => {
      // Insert 10 addresses directly
      for (let i = 0; i < 10; i++) {
        await dataSource.getRepository(UserAddress).save({
          userId: clientUser.id,
          label: `Addr ${i}`,
          line1: `Calle ${i}`,
          lat: 18.47 + i * 0.001,
          lng: -69.9 + i * 0.001,
          isDefault: i === 0,
        } as Partial<UserAddress> as UserAddress);
      }

      const res = await request(app.getHttpServer())
        .post('/me/addresses')
        .set('Authorization', `Bearer ${clientToken}`)
        .send(BASE_ADDRESS);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('ADDRESS_CAP_EXCEEDED');
    });
  });

  // ---------------------------------------------------------------------------
  // Pair C — PATCH /me/addresses/:id
  // ---------------------------------------------------------------------------

  describe('PATCH /me/addresses/:id', () => {
    let ownAddressId: string;
    let otherAddressId: string;

    beforeEach(async () => {
      const ownAddr = await dataSource.getRepository(UserAddress).save({
        userId: clientUser.id,
        label: 'Casa',
        line1: 'Calle Principal',
        lat: 18.47,
        lng: -69.9,
        isDefault: true,
      } as Partial<UserAddress> as UserAddress);
      ownAddressId = ownAddr.id;

      const otherAddr = await dataSource.getRepository(UserAddress).save({
        userId: otherUser.id,
        label: 'Otro',
        line1: 'Calle Otro',
        lat: 18.48,
        lng: -69.91,
        isDefault: true,
      } as Partial<UserAddress> as UserAddress);
      otherAddressId = otherAddr.id;
    });

    it('(c1) no JWT → 401', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/me/addresses/${ownAddressId}`)
        .send({ label: 'Nueva' });
      expect(res.status).toBe(401);
    });

    it('(c2) own address → 200 with updated fields', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/me/addresses/${ownAddressId}`)
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ label: 'Oficina', instructions: 'Piso 3' });

      expect(res.status).toBe(200);
      expect(res.body.label).toBe('Oficina');
      expect(res.body.instructions).toBe('Piso 3');
      expect(res.body.line1).toBe('Calle Principal'); // unchanged
    });

    it('(c3) other user\'s address → 404', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/me/addresses/${otherAddressId}`)
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ label: 'Intruder' });
      expect(res.status).toBe(404);
    });

    it('(c4) non-existent UUID → 404', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const res = await request(app.getHttpServer())
        .patch(`/me/addresses/${fakeId}`)
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ label: 'Ghost' });
      expect(res.status).toBe(404);
    });

    it('(c5) invalid (non-UUID) id → 400 from ParseUUIDPipe', async () => {
      const res = await request(app.getHttpServer())
        .patch('/me/addresses/not-a-uuid')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ label: 'Bad' });
      expect(res.status).toBe(400);
    });
  });

  // ---------------------------------------------------------------------------
  // Pair D — DELETE /me/addresses/:id
  // ---------------------------------------------------------------------------

  describe('DELETE /me/addresses/:id', () => {
    let ownAddressId: string;
    let otherAddressId: string;

    beforeEach(async () => {
      const ownAddr = await dataSource.getRepository(UserAddress).save({
        userId: clientUser.id,
        label: 'Casa',
        line1: 'Calle Principal',
        lat: 18.47,
        lng: -69.9,
        isDefault: true,
      } as Partial<UserAddress> as UserAddress);
      ownAddressId = ownAddr.id;

      const otherAddr = await dataSource.getRepository(UserAddress).save({
        userId: otherUser.id,
        label: 'Otro',
        line1: 'Calle Otro',
        lat: 18.48,
        lng: -69.91,
        isDefault: true,
      } as Partial<UserAddress> as UserAddress);
      otherAddressId = ownAddr.id; // intentionally overwrite to force distinct; reset below
      void otherAddr; // suppress unused
      otherAddressId = otherAddr.id;
    });

    it('(d1) no JWT → 401', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/me/addresses/${ownAddressId}`);
      expect(res.status).toBe(401);
    });

    it('(d2) own address → 204', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/me/addresses/${ownAddressId}`)
        .set('Authorization', `Bearer ${clientToken}`);
      expect(res.status).toBe(204);
      expect(res.body).toEqual({});
    });

    it('(d3) other user\'s address → 404', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/me/addresses/${otherAddressId}`)
        .set('Authorization', `Bearer ${clientToken}`);
      expect(res.status).toBe(404);
    });

    it('(d4) deleting default with others present → promotes most recent', async () => {
      // Create a second (non-default) address for clientUser, slightly newer
      const secondAddr = await dataSource.getRepository(UserAddress).save({
        userId: clientUser.id,
        label: 'Oficina',
        line1: 'Calle 2',
        lat: 18.48,
        lng: -69.91,
        isDefault: false,
      } as Partial<UserAddress> as UserAddress);

      // Delete the default (ownAddressId)
      const delRes = await request(app.getHttpServer())
        .delete(`/me/addresses/${ownAddressId}`)
        .set('Authorization', `Bearer ${clientToken}`);
      expect(delRes.status).toBe(204);

      // The remaining address should now be default
      const listRes = await request(app.getHttpServer())
        .get('/me/addresses')
        .set('Authorization', `Bearer ${clientToken}`);
      expect(listRes.status).toBe(200);
      expect(listRes.body).toHaveLength(1);
      expect(listRes.body[0].id).toBe(secondAddr.id);
      expect(listRes.body[0].isDefault).toBe(true);
    });

    it('(d5) deleting last address → 204, no promotion', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/me/addresses/${ownAddressId}`)
        .set('Authorization', `Bearer ${clientToken}`);
      expect(res.status).toBe(204);

      const listRes = await request(app.getHttpServer())
        .get('/me/addresses')
        .set('Authorization', `Bearer ${clientToken}`);
      expect(listRes.status).toBe(200);
      expect(listRes.body).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Pair E — PATCH /me/addresses/:id/set-default
  // ---------------------------------------------------------------------------

  describe('PATCH /me/addresses/:id/set-default', () => {
    let addr1Id: string;
    let addr2Id: string;
    let otherAddressId: string;

    beforeEach(async () => {
      const addr1 = await dataSource.getRepository(UserAddress).save({
        userId: clientUser.id,
        label: 'Casa',
        line1: 'Calle 1',
        lat: 18.47,
        lng: -69.9,
        isDefault: true,
      } as Partial<UserAddress> as UserAddress);
      addr1Id = addr1.id;

      const addr2 = await dataSource.getRepository(UserAddress).save({
        userId: clientUser.id,
        label: 'Oficina',
        line1: 'Calle 2',
        lat: 18.48,
        lng: -69.91,
        isDefault: false,
      } as Partial<UserAddress> as UserAddress);
      addr2Id = addr2.id;

      const otherAddr = await dataSource.getRepository(UserAddress).save({
        userId: otherUser.id,
        label: 'Otro',
        line1: 'Calle 3',
        lat: 18.49,
        lng: -69.92,
        isDefault: true,
      } as Partial<UserAddress> as UserAddress);
      otherAddressId = otherAddr.id;
    });

    it('(e1) no JWT → 401', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/me/addresses/${addr2Id}/set-default`);
      expect(res.status).toBe(401);
    });

    it('(e2) own address → 200 with isDefault:true; others demoted', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/me/addresses/${addr2Id}/set-default`)
        .set('Authorization', `Bearer ${clientToken}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(addr2Id);
      expect(res.body.isDefault).toBe(true);

      // Verify addr1 is no longer default
      const listRes = await request(app.getHttpServer())
        .get('/me/addresses')
        .set('Authorization', `Bearer ${clientToken}`);
      const addr1FromList = listRes.body.find((a: { id: string }) => a.id === addr1Id);
      expect(addr1FromList?.isDefault).toBe(false);
    });

    it('(e3) other user\'s address → 404', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/me/addresses/${otherAddressId}/set-default`)
        .set('Authorization', `Bearer ${clientToken}`);
      expect(res.status).toBe(404);
    });

    it('(e4) non-existent UUID → 404', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000001';
      const res = await request(app.getHttpServer())
        .patch(`/me/addresses/${fakeId}/set-default`)
        .set('Authorization', `Bearer ${clientToken}`);
      expect(res.status).toBe(404);
    });
  });
});
