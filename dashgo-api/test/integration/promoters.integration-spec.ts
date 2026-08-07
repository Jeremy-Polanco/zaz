/**
 * Integration spec: PromotersService.getAll — real Postgres (Docker, 5433).
 *
 * Reproduces the production Sentry report:
 *   QueryFailedError: column c.promoter_id does not exist
 *     at PromotersService.balancesFor → PromotersService.getAll
 *
 * `GeneralizeCommissionsToEarner1803000000000` renamed
 * `promoter_commission_entries.promoter_id` → `commission_entries.earner_id`,
 * but `balancesFor` still asked for the old column in a RAW query-builder
 * string. TypeORM only rewrites `alias.property` when the property exists on
 * the entity — `promoter_id` is not a property, so it went to Postgres
 * verbatim and the admin promoters list 500'd for every request.
 *
 * A mocked repository can never catch this: the SQL string never reaches a
 * database. That is exactly why this shipped green. This spec runs the real
 * query against the migrated schema.
 */

// Module-level Stripe mock — hoisted before any import that loads stripe.
// PromotersService never calls Stripe, but createTestingApp boots the whole
// AppModule and SubscriptionService seeds itself from `prices.retrieve` at
// bootstrap. Without this the real SDK dials api.stripe.com with the dummy
// key and the suite hangs for minutes instead of failing fast.
// MUST return the constructor directly (not { default: fn }) because the
// service uses `import Stripe = require('stripe')` (CJS interop).
jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    paymentIntents: {
      create: jest.fn(),
      retrieve: jest.fn(),
      cancel: jest.fn(),
      capture: jest.fn(),
    },
    webhooks: { constructEvent: jest.fn() },
    customers: {
      create: jest.fn(),
      search: jest.fn().mockResolvedValue({ data: [] }),
      update: jest.fn(),
      list: jest.fn(),
      del: jest.fn(),
    },
    subscriptions: {
      create: jest.fn(),
      retrieve: jest.fn(),
      update: jest.fn(),
      list: jest.fn(),
    },
    checkout: { sessions: { create: jest.fn() } },
    billingPortal: { sessions: { create: jest.fn() } },
    prices: { retrieve: jest.fn(), create: jest.fn(), update: jest.fn() },
    products: { update: jest.fn() },
  }));
});

import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createTestingApp } from '../../src/test-utils/testing-app';
import { makeUser } from '../../src/test-utils/fixtures';
import { PromotersService } from '../../src/modules/promoters/promoters.service';
import { CommissionEntry, User } from '../../src/entities';
import {
  CommissionEntryStatus,
  CommissionEntryType,
  EarnerRole,
} from '../../src/entities/commission-entry.entity';
import { UserRole } from '../../src/entities/enums';

describe('PromotersService.getAll (integration)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let promoters: PromotersService;

  // The integration project runs every spec against ONE shared database, so a
  // suite that leaves rows behind corrupts whatever runs after it.
  const createdUserIds: string[] = [];

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
    promoters = app.get(PromotersService);
  });

  afterAll(async () => {
    if (ds?.isInitialized) {
      for (const userId of createdUserIds) {
        await ds.getRepository(CommissionEntry).delete({ earnerId: userId });
        await ds.getRepository(User).delete({ id: userId });
      }
    }
    if (app) await app.close();
  });

  async function createUser(
    role: UserRole,
    overrides: Partial<User> = {},
  ): Promise<User> {
    const repo = ds.getRepository(User);
    const user = await repo.save(
      repo.create({ ...makeUser({ role }), ...overrides } as Partial<User>),
    );
    createdUserIds.push(user.id);
    return user;
  }

  async function earn(
    earnerId: string,
    earnerRole: EarnerRole,
    status: CommissionEntryStatus,
    amountCents: number,
  ): Promise<void> {
    const repo = ds.getRepository(CommissionEntry);
    await repo.save(
      repo.create({
        earnerId,
        earnerRole,
        type: CommissionEntryType.EARNED,
        status,
        amountCents,
      } as Partial<CommissionEntry>),
    );
  }

  it('lists promoters with their balances without hitting a stale column', async () => {
    // `users.referral_code` is varchar(10) and unique across the shared
    // integration database — keep it short and prefixed per test.
    const promoter = await createUser(UserRole.PROMOTER, {
      referralCode: `GA${process.pid}`.slice(0, 10),
    });

    await earn(
      promoter.id,
      EarnerRole.PROMOTER,
      CommissionEntryStatus.PENDING,
      1_000,
    );
    await earn(
      promoter.id,
      EarnerRole.PROMOTER,
      CommissionEntryStatus.CLAIMABLE,
      2_500,
    );
    await earn(
      promoter.id,
      EarnerRole.PROMOTER,
      CommissionEntryStatus.PAID,
      700,
    );

    // Before the fix this threw QueryFailedError: column c.promoter_id does
    // not exist — the whole admin list, not just this promoter's row.
    const list = await promoters.getAll();

    const row = list.find((p) => p.id === promoter.id);
    expect(row).toBeDefined();
    expect(row).toMatchObject({
      pendingCents: 1_000,
      claimableCents: 2_500,
      paidCents: 700,
    });
  });

  it('counts only promoter earnings, never a seller entry on the same user', async () => {
    // Roles change over time: a user promoted from SELLER to PROMOTER keeps
    // their old seller entries, and those are a different debt. `earner_role`
    // is what separates them — pageCommissions already filters on it.
    const converted = await createUser(UserRole.PROMOTER, {
      referralCode: `CV${process.pid}`.slice(0, 10),
    });

    await earn(
      converted.id,
      EarnerRole.PROMOTER,
      CommissionEntryStatus.CLAIMABLE,
      500,
    );
    await earn(
      converted.id,
      EarnerRole.SELLER,
      CommissionEntryStatus.CLAIMABLE,
      9_999,
    );

    const list = await promoters.getAll();
    const row = list.find((p) => p.id === converted.id);

    expect(row?.claimableCents).toBe(500);
  });
});
