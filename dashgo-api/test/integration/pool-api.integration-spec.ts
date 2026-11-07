/**
 * Integration spec — endpoints del pool (resumen, saldo propio, repartos)
 * contra Postgres REAL, pasando por JwtAuthGuard + RolesGuard de verdad.
 *
 * POR QUÉ no se afirma un `poolCents` absoluto: la base se comparte con el
 * resto de los specs y varios dejan aportes en el trimestre en curso. Se
 * verifica la forma, `nextDistributionAt` y que `associateCount` /
 * `estimatedShareCents` sean coherentes entre sí y con la base.
 */
// `jest.mock('stripe')`: sin esto el arranque de AppModule llama al Stripe real.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockStripe: any;

jest.mock('stripe', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctor = jest.fn().mockImplementation(() => mockStripe as any);
  return ctor;
});

mockStripe = {
  paymentIntents: {
    create: jest.fn(),
    retrieve: jest.fn(),
    cancel: jest.fn(),
    capture: jest.fn(),
  },
  customers: {
    create: jest.fn(),
    search: jest.fn().mockResolvedValue({ data: [] }),
    update: jest.fn(),
    list: jest.fn(),
  },
  subscriptions: {
    create: jest.fn(),
    retrieve: jest.fn(),
    update: jest.fn(),
    list: jest.fn(),
  },
  checkout: { sessions: { create: jest.fn() } },
  billingPortal: { sessions: { create: jest.fn() } },
  webhooks: { constructEvent: jest.fn() },
  prices: { retrieve: jest.fn(), create: jest.fn(), update: jest.fn() },
  products: { create: jest.fn(), update: jest.fn() },
};

import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createTestingApp } from '../../src/test-utils/testing-app';
import { makeUser } from '../../src/test-utils/fixtures';
import { issueTestToken } from '../e2e/helpers/auth.helper';
import {
  AssociateBalanceEntry,
  AssociateBalanceEntryType,
  PoolDistribution,
  User,
} from '../../src/entities';
import { UserRole } from '../../src/entities/enums';
import { nextDistributionAt } from '../../src/modules/pool/quarter';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');

// Trimestre de los 1950: ningún otro spec (ni un reparto real) lo usa.
const SEEDED_QUARTER = '1955-Q3';

describe('Pool API (integration)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let client: User;
  let associate: User;
  let admin: User;
  let distribution: PoolDistribution;
  const createdUserIds: string[] = [];

  async function createUser(role: UserRole): Promise<User> {
    const repo = ds.getRepository(User);
    const user = await repo.save(repo.create(makeUser({ role }) as Partial<User>));
    createdUserIds.push(user.id);
    return user;
  }

  const auth = async (user: User) => ({
    Authorization: `Bearer ${await issueTestToken(app, user.id, user.role)}`,
  });

  beforeAll(async () => {
    process.env.DB_HOST = 'localhost';
    process.env.DB_PORT = '5433';
    process.env.DB_USER = 'dashgo_test';
    process.env.DB_PASSWORD = 'dashgo_test';
    process.env.DB_NAME = 'dashgo_test';
    process.env.STRIPE_SECRET_KEY =
      process.env.STRIPE_SECRET_KEY ?? 'sk_test_dummy_integration';

    app = await createTestingApp();
    ds = app.get(DataSource);

    client = await createUser(UserRole.CLIENT);
    associate = await createUser(UserRole.ASSOCIATE);
    admin = await createUser(UserRole.SUPER_ADMIN_DELIVERY);

    distribution = await ds.getRepository(PoolDistribution).save(
      ds.getRepository(PoolDistribution).create({
        quarter: SEEDED_QUARTER,
        totalCents: 1000,
        associateCount: 1,
        shareCents: 1000,
        remainderCents: 0,
      }),
    );
    await ds.getRepository(AssociateBalanceEntry).save(
      ds.getRepository(AssociateBalanceEntry).create({
        userId: associate.id,
        type: AssociateBalanceEntryType.ALLOCATION,
        amountCents: 1000,
        distributionId: distribution.id,
      }),
    );
  });

  afterAll(async () => {
    if (ds?.isInitialized) {
      // Borrar al usuario arrastra su libro (CASCADE); el reparto sintético va
      // después porque el libro lo referencia.
      for (const id of createdUserIds) {
        await ds.getRepository(User).delete({ id });
      }
      await ds
        .getRepository(PoolDistribution)
        .delete({ quarter: SEEDED_QUARTER });
    }
    if (app) await app.close();
  });

  describe('GET /pool/summary', () => {
    it('devuelve el resumen a un asociado', async () => {
      const res = await request(app.getHttpServer())
        .get('/pool/summary')
        .set(await auth(associate))
        .expect(200);

      expect(res.body.nextDistributionAt).toBe(
        nextDistributionAt(new Date()).toISOString(),
      );
      expect(typeof res.body.quarter).toBe('string');
      expect(res.body.quarter).toMatch(/^\d{4}-Q[1-4]$/);
      expect(Number.isInteger(res.body.poolCents)).toBe(true);

      const associates = await ds
        .getRepository(User)
        .count({ where: { role: UserRole.ASSOCIATE } });
      expect(res.body.associateCount).toBe(associates);
      expect(res.body.estimatedShareCents).toBe(
        associates > 0 ? Math.floor(res.body.poolCents / associates) : 0,
      );
    });

    it('también lo ve el super admin', async () => {
      await request(app.getHttpServer())
        .get('/pool/summary')
        .set(await auth(admin))
        .expect(200);
    });

    it('un cliente recibe 403', async () => {
      await request(app.getHttpServer())
        .get('/pool/summary')
        .set(await auth(client))
        .expect(403);
    });

    it('sin token recibe 401', async () => {
      await request(app.getHttpServer()).get('/pool/summary').expect(401);
    });
  });

  describe('GET /pool/me', () => {
    it('un cliente recibe saldo 0 y sin movimientos', async () => {
      const res = await request(app.getHttpServer())
        .get('/pool/me')
        .set(await auth(client))
        .expect(200);

      expect(res.body).toEqual({ balanceCents: 0, entries: [] });
    });

    it('un asociado ve su asignación con el trimestre del reparto', async () => {
      const res = await request(app.getHttpServer())
        .get('/pool/me')
        .set(await auth(associate))
        .expect(200);

      expect(res.body.balanceCents).toBe(1000);
      expect(res.body.entries).toHaveLength(1);
      expect(res.body.entries[0]).toEqual({
        id: expect.any(String),
        type: 'allocation',
        amountCents: 1000,
        orderId: null,
        quarter: SEEDED_QUARTER,
        createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      });
    });
  });

  describe('GET /pool/distributions', () => {
    it('un asociado recibe 403', async () => {
      await request(app.getHttpServer())
        .get('/pool/distributions')
        .set(await auth(associate))
        .expect(403);
    });

    it('el super admin recibe la lista de repartos', async () => {
      const res = await request(app.getHttpServer())
        .get('/pool/distributions')
        .set(await auth(admin))
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      const mine = res.body.find(
        (d: { quarter: string }) => d.quarter === SEEDED_QUARTER,
      );
      expect(mine).toEqual({
        id: distribution.id,
        quarter: SEEDED_QUARTER,
        totalCents: 1000,
        associateCount: 1,
        shareCents: 1000,
        remainderCents: 0,
        createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      });
    });
  });
});
