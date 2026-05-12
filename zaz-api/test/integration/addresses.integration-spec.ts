/**
 * Integration spec: AddressesService — real Postgres (Docker, port 5433, tmpfs).
 *
 * T37 — Phase 4 integration tests
 *
 * Test cases:
 *   1. Bootstrap clean: TRUNCATE user_addresses; verify table starts empty.
 *   2. Idempotent migration seed (REQ-13):
 *      - User with addressDefault JSONB → 1 row seeded; re-seed stays at 1.
 *      - User with NULL addressDefault → 0 rows.
 *   3. Transactional setDefault (REQ-10, scenario 6): 3 addresses; rotate default.
 *   4. Delete default with promotion (REQ-9, scenario 7): oldest default deleted → newest promoted.
 *   5. Delete last address (scenario 8): no error, 0 rows remain.
 *   6. Cap of 10 enforced (REQ-3, scenario 3): 11th create throws 400 ADDRESS_CAP_EXCEEDED.
 *   7. Cascade delete on user removal (REQ-5): DELETE user → addresses gone.
 *
 * No Stripe calls in AddressesService, but the module graph pulls in Stripe via
 * other services (e.g. PaymentsService). Mock it at module level.
 */

// ---------------------------------------------------------------------------
// Stripe module mock — must be hoisted before any imports that load stripe.
// ---------------------------------------------------------------------------
jest.mock('stripe', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return jest.fn().mockImplementation(() => ({
    paymentIntents: {
      create: jest.fn().mockResolvedValue({ id: 'pi_test', client_secret: 'secret', status: 'requires_payment_method', amount: 1000, currency: 'usd' }),
      retrieve: jest.fn(),
      cancel: jest.fn(),
      capture: jest.fn(),
    },
    webhooks: { constructEvent: jest.fn() },
    customers: { create: jest.fn(), search: jest.fn().mockResolvedValue({ data: [] }), update: jest.fn(), list: jest.fn() },
    subscriptions: { create: jest.fn(), retrieve: jest.fn(), update: jest.fn(), list: jest.fn() },
    checkout: { sessions: { create: jest.fn().mockResolvedValue({ url: 'https://stripe.test/session' }) } },
    billingPortal: { sessions: { create: jest.fn().mockResolvedValue({ url: 'https://stripe.test/portal' }) } },
    prices: { retrieve: jest.fn(), create: jest.fn(), update: jest.fn() },
    products: { update: jest.fn() },
  }));
});

import * as path from 'path';
import * as fs from 'fs';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createTestingApp } from '../../src/test-utils/testing-app';
import { makeUser } from '../../src/test-utils/fixtures';
import { User } from '../../src/entities/user.entity';
import { UserAddress } from '../../src/entities/user-address.entity';
import { UserRole } from '../../src/entities/enums';
import { AddressesService } from '../../src/modules/addresses/addresses.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Suite: AddressesService integration tests
// ---------------------------------------------------------------------------

describe('AddressesService (integration)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let service: AddressesService;

  // Two users for isolation between tests
  let user1: User;
  let user2: User;

  beforeAll(async () => {
    loadEnvTest();
    // Force test DB credentials
    process.env.DB_HOST = 'localhost';
    process.env.DB_PORT = '5433';
    process.env.DB_USER = 'zaz_test';
    process.env.DB_PASSWORD = 'zaz_test';
    process.env.DB_NAME = 'zaz_test';
    process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? 'sk_test_dummy_integration';

    app = await createTestingApp();
    dataSource = app.get(DataSource);
    service = app.get(AddressesService);

    // Create 2 test users for the suite
    user1 = await dataSource.getRepository(User).save(
      makeUser({ role: UserRole.CLIENT }) as unknown as User,
    );
    user2 = await dataSource.getRepository(User).save(
      makeUser({ role: UserRole.CLIENT }) as unknown as User,
    );
  });

  afterAll(async () => {
    // Clean up test users (cascade deletes their addresses)
    if (dataSource?.isInitialized) {
      await dataSource.getRepository(User).delete({ id: user1.id });
      await dataSource.getRepository(User).delete({ id: user2.id });
    }
    if (app) await app.close();
  });

  // Clean user_addresses rows between tests (keep users)
  beforeEach(async () => {
    await dataSource.query(
      'DELETE FROM user_addresses WHERE user_id IN ($1, $2)',
      [user1.id, user2.id],
    );
  });

  // ---------------------------------------------------------------------------
  // Test 1: Bootstrap clean — table starts empty for our test users
  // ---------------------------------------------------------------------------

  it('1. table starts empty for test users after TRUNCATE of their rows', async () => {
    const rows = await dataSource.getRepository(UserAddress).find({
      where: [{ userId: user1.id }, { userId: user2.id }],
    });
    expect(rows).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // Test 2: Idempotent migration seed (REQ-13)
  //   - U1 has addressDefault JSONB → seed inserts 1 row
  //   - U2 has NULL addressDefault → 0 rows
  //   - Running the seed query a second time leaves U1 at exactly 1 row
  // ---------------------------------------------------------------------------

  describe('2. Idempotent migration seed (REQ-13)', () => {
    it('U1 with addressDefault JSONB gets 1 row; U2 with NULL gets 0 rows', async () => {
      // Set up addressDefault JSONB for user1, leave user2 null
      await dataSource.query(
        `UPDATE users SET address_default = $1 WHERE id = $2`,
        [JSON.stringify({ text: 'Calle 1', lat: 18.5, lng: -69.9 }), user1.id],
      );
      await dataSource.query(
        `UPDATE users SET address_default = NULL WHERE id = $1`,
        [user2.id],
      );

      // Run the seed INSERT (same SQL as migration up(), scoped to our test users)
      const seedSql = `
        INSERT INTO "user_addresses" (
          "id", "user_id", "label", "line1", "lat", "lng", "is_default", "created_at", "updated_at"
        )
        SELECT
          gen_random_uuid(),
          u.id,
          'Casa',
          (u.address_default->>'text'),
          COALESCE((u.address_default->>'lat')::numeric, 0),
          COALESCE((u.address_default->>'lng')::numeric, 0),
          true,
          NOW(),
          NOW()
        FROM "users" u
        WHERE u.address_default IS NOT NULL
          AND u.address_default ? 'text'
          AND (u.address_default->>'text') IS NOT NULL
          AND (u.address_default->>'text') <> ''
          AND u.id IN ($1, $2)
          AND u.id NOT IN (SELECT user_id FROM "user_addresses");
      `;

      await dataSource.query(seedSql, [user1.id, user2.id]);

      // Assert: U1 has 1 row with correct values
      const u1Rows = await dataSource.getRepository(UserAddress).find({
        where: { userId: user1.id },
      });
      expect(u1Rows).toHaveLength(1);
      expect(u1Rows[0].label).toBe('Casa');
      expect(u1Rows[0].line1).toBe('Calle 1');
      expect(u1Rows[0].isDefault).toBe(true);
      // lat/lng should be numbers (transformer working)
      expect(typeof u1Rows[0].lat).toBe('number');
      expect(typeof u1Rows[0].lng).toBe('number');
      expect(u1Rows[0].lat).toBeCloseTo(18.5);
      expect(u1Rows[0].lng).toBeCloseTo(-69.9);

      // Assert: U2 has 0 rows
      const u2Rows = await dataSource.getRepository(UserAddress).find({
        where: { userId: user2.id },
      });
      expect(u2Rows).toHaveLength(0);
    });

    it('running the seed query a second time leaves U1 at exactly 1 row (idempotency)', async () => {
      // Set up JSONB for user1
      await dataSource.query(
        `UPDATE users SET address_default = $1 WHERE id = $2`,
        [JSON.stringify({ text: 'Calle 1', lat: 18.5, lng: -69.9 }), user1.id],
      );

      const seedSql = `
        INSERT INTO "user_addresses" (
          "id", "user_id", "label", "line1", "lat", "lng", "is_default", "created_at", "updated_at"
        )
        SELECT
          gen_random_uuid(),
          u.id,
          'Casa',
          (u.address_default->>'text'),
          COALESCE((u.address_default->>'lat')::numeric, 0),
          COALESCE((u.address_default->>'lng')::numeric, 0),
          true,
          NOW(),
          NOW()
        FROM "users" u
        WHERE u.address_default IS NOT NULL
          AND u.address_default ? 'text'
          AND (u.address_default->>'text') IS NOT NULL
          AND (u.address_default->>'text') <> ''
          AND u.id = $1
          AND u.id NOT IN (SELECT user_id FROM "user_addresses");
      `;

      // First run
      await dataSource.query(seedSql, [user1.id]);
      // Second run (idempotency check)
      await dataSource.query(seedSql, [user1.id]);

      const rows = await dataSource.getRepository(UserAddress).find({
        where: { userId: user1.id },
      });
      // Still exactly 1 row (NOT IN guard prevented duplicate)
      expect(rows).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Test 3: Transactional setDefault (REQ-10, scenario 6)
  // ---------------------------------------------------------------------------

  describe('3. Transactional setDefault (REQ-10)', () => {
    it('setDefault rotates is_default correctly across 3 addresses', async () => {
      // Create 3 addresses for user1 via service
      const addrA = await service.create(user1.id, {
        label: 'A',
        line1: 'Calle A',
        lat: 18.5,
        lng: -69.9,
      });
      const addrB = await service.create(user1.id, {
        label: 'B',
        line1: 'Calle B',
        lat: 18.6,
        lng: -69.8,
      });
      const addrC = await service.create(user1.id, {
        label: 'C',
        line1: 'Calle C',
        lat: 18.7,
        lng: -69.7,
      });

      // A is default (first created), B and C are not
      const initialA = await dataSource.getRepository(UserAddress).findOneOrFail({
        where: { id: addrA.id },
      });
      expect(initialA.isDefault).toBe(true);

      // setDefault to B
      await service.setDefault(user1.id, addrB.id);

      const repo = dataSource.getRepository(UserAddress);
      const afterFirstSetA = await repo.findOneOrFail({ where: { id: addrA.id } });
      const afterFirstSetB = await repo.findOneOrFail({ where: { id: addrB.id } });
      const afterFirstSetC = await repo.findOneOrFail({ where: { id: addrC.id } });

      expect(afterFirstSetA.isDefault).toBe(false);
      expect(afterFirstSetB.isDefault).toBe(true);
      expect(afterFirstSetC.isDefault).toBe(false);

      // setDefault to C
      await service.setDefault(user1.id, addrC.id);

      const afterSecondSetA = await repo.findOneOrFail({ where: { id: addrA.id } });
      const afterSecondSetB = await repo.findOneOrFail({ where: { id: addrB.id } });
      const afterSecondSetC = await repo.findOneOrFail({ where: { id: addrC.id } });

      expect(afterSecondSetA.isDefault).toBe(false);
      expect(afterSecondSetB.isDefault).toBe(false);
      expect(afterSecondSetC.isDefault).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Test 4: Delete default with promotion (REQ-9, scenario 7)
  // ---------------------------------------------------------------------------

  describe('4. Delete default with promotion (REQ-9)', () => {
    it('deleting the default address promotes the most-recently-created remaining address', async () => {
      // Create A (oldest/default), B (middle), C (newest)
      const addrA = await service.create(user1.id, {
        label: 'A-oldest',
        line1: 'Calle A',
        lat: 18.5,
        lng: -69.9,
      });
      // Small delay to ensure distinct created_at ordering
      await new Promise((resolve) => setTimeout(resolve, 50));
      const addrB = await service.create(user1.id, {
        label: 'B-middle',
        line1: 'Calle B',
        lat: 18.6,
        lng: -69.8,
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      const addrC = await service.create(user1.id, {
        label: 'C-newest',
        line1: 'Calle C',
        lat: 18.7,
        lng: -69.7,
      });

      // A should be default (first created)
      const initialA = await dataSource.getRepository(UserAddress).findOneOrFail({
        where: { id: addrA.id },
      });
      expect(initialA.isDefault).toBe(true);

      // Delete the default (A)
      await service.delete(user1.id, addrA.id);

      const repo = dataSource.getRepository(UserAddress);

      // A should be gone
      const deletedA = await repo.findOne({ where: { id: addrA.id } });
      expect(deletedA).toBeNull();

      // C (most recently created) should be promoted to default
      const remainingB = await repo.findOneOrFail({ where: { id: addrB.id } });
      const remainingC = await repo.findOneOrFail({ where: { id: addrC.id } });

      expect(remainingC.isDefault).toBe(true);
      expect(remainingB.isDefault).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Test 5: Delete last address (scenario 8)
  // ---------------------------------------------------------------------------

  describe('5. Delete last address (scenario 8)', () => {
    it('deleting the only address leaves 0 rows and no error', async () => {
      const addr = await service.create(user1.id, {
        label: 'Solo',
        line1: 'Calle Única',
        lat: 18.5,
        lng: -69.9,
      });

      // Verify it is default
      const initial = await dataSource.getRepository(UserAddress).findOneOrFail({
        where: { id: addr.id },
      });
      expect(initial.isDefault).toBe(true);

      // Delete it — no error
      await expect(service.delete(user1.id, addr.id)).resolves.not.toThrow();

      // 0 rows remain
      const remaining = await dataSource.getRepository(UserAddress).find({
        where: { userId: user1.id },
      });
      expect(remaining).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Test 6: Cap of 10 enforced (REQ-3 / REQ-4, scenario 3)
  // ---------------------------------------------------------------------------

  describe('6. Cap of 10 enforced (REQ-4)', () => {
    it('11th address creation throws 400 ADDRESS_CAP_EXCEEDED; row count stays 10', async () => {
      // Create 10 addresses
      for (let i = 1; i <= 10; i++) {
        await service.create(user1.id, {
          label: `Addr ${i}`,
          line1: `Calle ${i}`,
          lat: 18.5 + i * 0.001,
          lng: -69.9 + i * 0.001,
        });
      }

      // Verify count is exactly 10
      const countBefore = await dataSource.getRepository(UserAddress).count({
        where: { userId: user1.id },
      });
      expect(countBefore).toBe(10);

      // 11th should fail
      await expect(
        service.create(user1.id, {
          label: 'Too many',
          line1: 'Calle 11',
          lat: 18.51,
          lng: -69.91,
        }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'ADDRESS_CAP_EXCEEDED' }),
      });

      // Count remains 10
      const countAfter = await dataSource.getRepository(UserAddress).count({
        where: { userId: user1.id },
      });
      expect(countAfter).toBe(10);
    });
  });

  // ---------------------------------------------------------------------------
  // Test 7: Cascade delete on user removal (REQ-5)
  // ---------------------------------------------------------------------------

  describe('7. Cascade delete on user removal (REQ-5)', () => {
    it('deleting a user row cascades to their user_addresses rows', async () => {
      // Create a dedicated user for this test (so cleanup doesn't affect suite users)
      const cascadeUser = await dataSource.getRepository(User).save(
        makeUser({ role: UserRole.CLIENT }) as unknown as User,
      );

      // Create 2 addresses for this user
      await service.create(cascadeUser.id, {
        label: 'Cascade A',
        line1: 'Calle Cascade 1',
        lat: 18.5,
        lng: -69.9,
      });
      await service.create(cascadeUser.id, {
        label: 'Cascade B',
        line1: 'Calle Cascade 2',
        lat: 18.6,
        lng: -69.8,
      });

      // Verify 2 addresses exist
      const before = await dataSource.getRepository(UserAddress).count({
        where: { userId: cascadeUser.id },
      });
      expect(before).toBe(2);

      // Delete the user directly (testing CASCADE FK)
      await dataSource.query('DELETE FROM users WHERE id = $1', [cascadeUser.id]);

      // All addresses for that user should be gone
      const after = await dataSource.getRepository(UserAddress).count({
        where: { userId: cascadeUser.id },
      });
      expect(after).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Test 8: lat/lng numeric transformer (type correctness)
  // ---------------------------------------------------------------------------

  describe('8. lat/lng are numbers not strings (numeric transformer)', () => {
    it('saved and retrieved lat/lng are JavaScript numbers', async () => {
      const created = await service.create(user1.id, {
        label: 'Transformer Test',
        line1: 'Calle Transformer',
        lat: 18.4861,
        lng: -69.9312,
      });

      // Freshly returned from service.create
      expect(typeof created.lat).toBe('number');
      expect(typeof created.lng).toBe('number');
      expect(created.lat).toBeCloseTo(18.4861);
      expect(created.lng).toBeCloseTo(-69.9312);

      // Reloaded from DB
      const fromDb = await dataSource.getRepository(UserAddress).findOneOrFail({
        where: { id: created.id },
      });
      expect(typeof fromDb.lat).toBe('number');
      expect(typeof fromDb.lng).toBe('number');
      expect(fromDb.lat).toBeCloseTo(18.4861);
      expect(fromDb.lng).toBeCloseTo(-69.9312);
    });
  });
});
