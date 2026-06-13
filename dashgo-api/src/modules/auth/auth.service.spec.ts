/**
 * Unit specs for AuthService.deleteAccount (FIX C2).
 *
 * Apple Guideline 5.1.1(v) requires in-app account deletion. This service
 * method backs the DELETE /auth/me endpoint exposed by AuthController.
 *
 * Strategy:
 *   - Hard-delete: addresses, OTP codes, points ledger, credit movements,
 *     credit account, subscriptions, rentals, promoter commission entries
 *     where the user is the promoter, payouts the user received.
 *   - Soft-anonymize orders for 7-year tax retention (RD tax law): set
 *     customer_id=null, customer_name_snapshot='Cuenta eliminada',
 *     customer_phone_snapshot=null. Orders persist as anonymous business
 *     records.
 *   - Stripe customer is deleted if `stripeCustomerId` is set. We swallow
 *     "resource_missing" errors (customer was already deleted upstream).
 *   - Wrapped in a TypeORM transaction so a partial failure rolls back.
 *
 * Repositories and Stripe are mocked. DataSource.transaction's callback
 * receives a mock manager whose getRepository() returns the same mocks.
 */

import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { DataSource, Repository } from 'typeorm';
import { AuthService } from './auth.service';
import { OtpCode, User } from '../../entities';
import { Order } from '../../entities/order.entity';
import { UserAddress } from '../../entities/user-address.entity';
import { Subscription } from '../../entities/subscription.entity';
import { Rental } from '../../entities/rental.entity';
import { CreditAccount } from '../../entities/credit-account.entity';
import { PromoterCommissionEntry } from '../../entities/promoter-commission-entry.entity';
import { Payout } from '../../entities/payout.entity';
import { PointsLedgerEntry } from '../../entities/points-ledger-entry.entity';
import { AccountDeletion } from '../../entities/account-deletion.entity';
import { createHash } from 'crypto';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { PromotersService } from '../promoters/promoters.service';
import { UserRole } from '../../entities/enums';

// ---------------------------------------------------------------------------
// Stripe mock — must be hoisted because the auth.service imports stripe at
// module load time. The instance is replaced per-test via `mockStripeInstance`.
// ---------------------------------------------------------------------------
jest.mock('stripe', () => {
  const mock = jest.fn().mockImplementation(() => mockStripeInstance);
  (mock as unknown as Record<string, unknown>)['default'] = mock;
  return mock;
});

let mockStripeInstance: {
  customers: { del: jest.Mock };
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRepoMock<T>(): jest.Mocked<Repository<T>> {
  return {
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    create: jest.fn((dto: Partial<T>) => dto as T),
    count: jest.fn(),
  } as unknown as jest.Mocked<Repository<T>>;
}

type Repos = {
  users: jest.Mocked<Repository<User>>;
  otps: jest.Mocked<Repository<OtpCode>>;
  orders: jest.Mocked<Repository<Order>>;
  addresses: jest.Mocked<Repository<UserAddress>>;
  subscriptions: jest.Mocked<Repository<Subscription>>;
  rentals: jest.Mocked<Repository<Rental>>;
  credit: jest.Mocked<Repository<CreditAccount>>;
  promoterCommissions: jest.Mocked<Repository<PromoterCommissionEntry>>;
  payouts: jest.Mocked<Repository<Payout>>;
  pointsLedger: jest.Mocked<Repository<PointsLedgerEntry>>;
  accountDeletions: jest.Mocked<Repository<AccountDeletion>>;
};

function makeAllRepos(): Repos {
  return {
    users: makeRepoMock<User>(),
    otps: makeRepoMock<OtpCode>(),
    orders: makeRepoMock<Order>(),
    addresses: makeRepoMock<UserAddress>(),
    subscriptions: makeRepoMock<Subscription>(),
    rentals: makeRepoMock<Rental>(),
    credit: makeRepoMock<CreditAccount>(),
    promoterCommissions: makeRepoMock<PromoterCommissionEntry>(),
    payouts: makeRepoMock<Payout>(),
    pointsLedger: makeRepoMock<PointsLedgerEntry>(),
    accountDeletions: makeRepoMock<AccountDeletion>(),
  };
}

function makeDataSourceMock(
  repos: Repos,
): jest.Mocked<Pick<DataSource, 'transaction'>> {
  const mgr = {
    getRepository: jest.fn((target: { name?: string } | string) => {
      // Resolve repo by entity ctor or token-like name
      const name = typeof target === 'string' ? target : (target.name ?? '');
      switch (name) {
        case 'User':
          return repos.users;
        case 'OtpCode':
          return repos.otps;
        case 'Order':
          return repos.orders;
        case 'UserAddress':
          return repos.addresses;
        case 'Subscription':
          return repos.subscriptions;
        case 'Rental':
          return repos.rentals;
        case 'CreditAccount':
          return repos.credit;
        case 'PromoterCommissionEntry':
          return repos.promoterCommissions;
        case 'Payout':
          return repos.payouts;
        case 'PointsLedgerEntry':
          return repos.pointsLedger;
        case 'AccountDeletion':
          return repos.accountDeletions;
        default:
          throw new Error(`Unknown entity in mock getRepository: ${name}`);
      }
    }),
  };
  return {
    transaction: jest
      .fn()
      .mockImplementation(async (cb: (m: unknown) => Promise<unknown>) =>
        cb(mgr),
      ),
  };
}

function fakeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: null,
    fullName: 'Test User',
    phone: '+18095550000',
    role: UserRole.CLIENT,
    addressDefault: null,
    referralCode: null,
    referredById: null,
    referredBy: null,
    stripeCustomerId: null,
    createdAt: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('AuthService.deleteAccount (FIX C2)', () => {
  let service: AuthService;
  let repos: Repos;
  let dataSource: jest.Mocked<Pick<DataSource, 'transaction'>>;

  beforeEach(async () => {
    mockStripeInstance = {
      customers: { del: jest.fn().mockResolvedValue({ deleted: true }) },
    };
    repos = makeAllRepos();
    dataSource = makeDataSourceMock(repos);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(User), useValue: repos.users },
        { provide: getRepositoryToken(OtpCode), useValue: repos.otps },
        { provide: getRepositoryToken(Order), useValue: repos.orders },
        { provide: getRepositoryToken(UserAddress), useValue: repos.addresses },
        {
          provide: getRepositoryToken(Subscription),
          useValue: repos.subscriptions,
        },
        { provide: getRepositoryToken(Rental), useValue: repos.rentals },
        { provide: getRepositoryToken(CreditAccount), useValue: repos.credit },
        {
          provide: getRepositoryToken(PromoterCommissionEntry),
          useValue: repos.promoterCommissions,
        },
        { provide: getRepositoryToken(Payout), useValue: repos.payouts },
        {
          provide: getRepositoryToken(PointsLedgerEntry),
          useValue: repos.pointsLedger,
        },
        {
          provide: getRepositoryToken(AccountDeletion),
          useValue: repos.accountDeletions,
        },
        { provide: DataSource, useValue: dataSource },
        {
          provide: JwtService,
          useValue: { signAsync: jest.fn(), verifyAsync: jest.fn() },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockImplementation((key: string) => {
              if (key === 'STRIPE_SECRET_KEY') return 'sk_test_dummy';
              // FIX HIGH-G6 — phone/email hashing for the durable
              // AccountDeletion audit row. We salt with JWT_SECRET so the
              // hash is unique per deployment.
              if (key === 'JWT_SECRET') return 'a'.repeat(32);
              return undefined;
            }),
          },
        },
        { provide: WhatsAppService, useValue: { sendOtp: jest.fn() } },
        {
          provide: PromotersService,
          useValue: { findPromoterByReferralCode: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    // Wire Stripe client lazily (mirrors how PaymentsService.onModuleInit works).
    (service as unknown as { onModuleInit?: () => void }).onModuleInit?.();
  });

  it('throws NotFoundException when the user does not exist', async () => {
    repos.users.findOne.mockResolvedValue(null);

    await expect(service.deleteAccount('user-missing')).rejects.toThrow(
      NotFoundException,
    );
    expect(repos.users.delete).not.toHaveBeenCalled();
  });

  it('hard-deletes all PII tables and the user row when the user has no orders', async () => {
    const user = fakeUser({ phone: '+18095550000' });
    repos.users.findOne.mockResolvedValue(user);
    repos.orders.count.mockResolvedValue(0);
    repos.orders.update.mockResolvedValue({ affected: 0 } as never);
    repos.users.delete.mockResolvedValue({ affected: 1 } as never);

    await service.deleteAccount('user-1');

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(repos.addresses.delete).toHaveBeenCalledWith({ userId: 'user-1' });
    expect(repos.otps.delete).toHaveBeenCalledWith({ phone: '+18095550000' });
    expect(repos.subscriptions.delete).toHaveBeenCalledWith({
      userId: 'user-1',
    });
    expect(repos.rentals.delete).toHaveBeenCalledWith({ userId: 'user-1' });
    expect(repos.credit.delete).toHaveBeenCalledWith({ userId: 'user-1' });
    expect(repos.pointsLedger.delete).toHaveBeenCalledWith({
      userId: 'user-1',
    });
    expect(repos.promoterCommissions.delete).toHaveBeenCalledWith({
      promoterId: 'user-1',
    });
    expect(repos.payouts.delete).toHaveBeenCalledWith({ promoterId: 'user-1' });
    expect(repos.users.delete).toHaveBeenCalledWith('user-1');
  });

  it('soft-anonymizes orders (FK→null, name→"Cuenta eliminada", phone→null) when the user has orders', async () => {
    const user = fakeUser({ phone: '+18095550000', fullName: 'Jane Doe' });
    repos.users.findOne.mockResolvedValue(user);
    repos.orders.count.mockResolvedValue(2);
    repos.orders.update.mockResolvedValue({ affected: 2 } as never);
    repos.users.delete.mockResolvedValue({ affected: 1 } as never);

    await service.deleteAccount('user-1');

    expect(repos.orders.update).toHaveBeenCalledWith(
      { customerId: 'user-1' },
      {
        customerId: null,
        customerNameSnapshot: 'Cuenta eliminada',
        customerPhoneSnapshot: null,
        // FIX CRITICAL-N1 — delivery_address jsonb scrub is now part of
        // the soft-anonymization patch (was previously left untouched,
        // which kept the full street address forever).
        deliveryAddress: {
          text: 'Cuenta eliminada',
          lat: null,
          lng: null,
        },
      },
    );
    // After anonymization, the user row is still hard-deleted.
    expect(repos.users.delete).toHaveBeenCalledWith('user-1');
  });

  it('calls Stripe customers.del when stripeCustomerId is set', async () => {
    const user = fakeUser({ stripeCustomerId: 'cus_abc123' });
    repos.users.findOne.mockResolvedValue(user);
    repos.orders.count.mockResolvedValue(0);
    repos.users.delete.mockResolvedValue({ affected: 1 } as never);

    await service.deleteAccount('user-1');

    expect(mockStripeInstance.customers.del).toHaveBeenCalledWith('cus_abc123');
  });

  it('does NOT call Stripe customers.del when stripeCustomerId is null', async () => {
    const user = fakeUser({ stripeCustomerId: null });
    repos.users.findOne.mockResolvedValue(user);
    repos.orders.count.mockResolvedValue(0);
    repos.users.delete.mockResolvedValue({ affected: 1 } as never);

    await service.deleteAccount('user-1');

    expect(mockStripeInstance.customers.del).not.toHaveBeenCalled();
  });

  it('swallows Stripe "resource_missing" errors (customer already deleted)', async () => {
    const user = fakeUser({ stripeCustomerId: 'cus_gone' });
    repos.users.findOne.mockResolvedValue(user);
    repos.orders.count.mockResolvedValue(0);
    repos.users.delete.mockResolvedValue({ affected: 1 } as never);
    const err = Object.assign(new Error('No such customer: cus_gone'), {
      code: 'resource_missing',
    });
    mockStripeInstance.customers.del.mockRejectedValueOnce(err);

    // Should NOT throw — deletion proceeds.
    await expect(service.deleteAccount('user-1')).resolves.toBeUndefined();
    expect(repos.users.delete).toHaveBeenCalledWith('user-1');
  });

  it('does NOT swallow non-"resource_missing" Stripe errors', async () => {
    const user = fakeUser({ stripeCustomerId: 'cus_bad' });
    repos.users.findOne.mockResolvedValue(user);
    repos.orders.count.mockResolvedValue(0);
    mockStripeInstance.customers.del.mockRejectedValueOnce(
      Object.assign(new Error('rate limited'), { code: 'rate_limit' }),
    );

    await expect(service.deleteAccount('user-1')).rejects.toThrow(
      'rate limited',
    );
  });

  it('runs the entire DB operation inside a single transaction', async () => {
    const user = fakeUser();
    repos.users.findOne.mockResolvedValue(user);
    repos.orders.count.mockResolvedValue(0);
    repos.users.delete.mockResolvedValue({ affected: 1 } as never);

    await service.deleteAccount('user-1');

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
  });

  it('leaves the referral chain intact (FK is ON DELETE SET NULL, no explicit nulling needed)', async () => {
    // User A referred user B. Deleting A nulls B.referredById via DB-level FK,
    // not by AuthService. We assert: no call to users.update on referrals.
    const userA = fakeUser({ id: 'user-A' });
    repos.users.findOne.mockResolvedValue(userA);
    repos.orders.count.mockResolvedValue(0);
    repos.users.delete.mockResolvedValue({ affected: 1 } as never);

    await service.deleteAccount('user-A');

    // No manual update touching referredById — relying on DB FK semantics.
    expect(repos.users.update).not.toHaveBeenCalled();
    expect(repos.users.delete).toHaveBeenCalledWith('user-A');
  });

  // ---------------------------------------------------------------------------
  // FIX CRITICAL-N1 — delivery_address jsonb scrub.
  //
  // Soft-anonymization previously nulled customer_id and overwrote
  // customer_name_snapshot / customer_phone_snapshot, but orders.delivery_address
  // (jsonb { text, lat, lng }) still contained the user's full street address
  // forever. Right-to-erasure scrub must overwrite the jsonb blob too.
  // ---------------------------------------------------------------------------
  it('scrubs orders.delivery_address jsonb on soft-anonymization (FIX CRITICAL-N1)', async () => {
    const user = fakeUser({ phone: '+18095550000', fullName: 'Jane Doe' });
    repos.users.findOne.mockResolvedValue(user);
    repos.orders.count.mockResolvedValue(1);
    repos.orders.update.mockResolvedValue({ affected: 1 } as never);
    repos.users.delete.mockResolvedValue({ affected: 1 } as never);

    await service.deleteAccount('user-1');

    // Inspect the patch passed to orders.update — it must overwrite
    // delivery_address with the redaction sentinel { text, lat: null, lng: null }.
    const updateCall = repos.orders.update.mock.calls[0];
    expect(updateCall).toBeDefined();
    const patch = updateCall[1] as Record<string, unknown> & {
      deliveryAddress?: { text?: string; lat?: number | null; lng?: number | null };
    };
    expect(patch.deliveryAddress).toBeDefined();
    expect(patch.deliveryAddress?.text).toBe('Cuenta eliminada');
    expect(patch.deliveryAddress?.lat).toBeNull();
    expect(patch.deliveryAddress?.lng).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // FIX HIGH-G5 — payouts.created_by_user_id SET NULL with snapshot.
  //
  // A super_admin who issued payouts cannot delete their own account because
  // payouts.created_by_user_id has ON DELETE RESTRICT. The fix:
  //   - migration switches the FK to ON DELETE SET NULL
  //   - adds payouts.created_by_name_snapshot text NULL
  //   - service snapshots the admin's full name into that column BEFORE the
  //     FK becomes null so the audit display survives.
  //
  // This test asserts the service-side step: any payout created by the
  // deleted admin gets created_by_name_snapshot = user.fullName.
  // ---------------------------------------------------------------------------
  it('snapshots fullName on payouts.created_by_user_id before clearing the admin FK (FIX HIGH-G5)', async () => {
    const admin = fakeUser({
      id: 'admin-1',
      role: UserRole.SUPER_ADMIN_DELIVERY,
      fullName: 'Admin Operario',
    });
    repos.users.findOne.mockResolvedValue(admin);
    repos.orders.count.mockResolvedValue(0);
    repos.users.delete.mockResolvedValue({ affected: 1 } as never);

    await service.deleteAccount('admin-1');

    // Service must have written the snapshot into every payout created
    // by this admin BEFORE the user row is deleted (DB-level SET NULL
    // would otherwise drop the FK and lose the audit trail).
    expect(repos.payouts.update).toHaveBeenCalledWith(
      { createdByUserId: 'admin-1' },
      { createdByNameSnapshot: 'Admin Operario' },
    );
  });

  // ---------------------------------------------------------------------------
  // FIX HIGH-G6 — AccountDeletion durable audit entity for GDPR defensibility.
  //
  // logger.warn is ephemeral. For GDPR defensibility we need a durable trail
  // that the deletion happened — without holding onto PII. Solution:
  // hash the phone + email with a server secret (JWT_SECRET) and store the
  // hashes + Stripe customer id + requestedVia + timestamp in a dedicated
  // account_deletions table.
  //
  // This test asserts that a row was inserted INSIDE the transaction (so
  // failure rolls back together with everything else) with hashedPhone =
  // sha256(phone + JWT_SECRET).
  // ---------------------------------------------------------------------------
  it('inserts an AccountDeletion audit row with a hashed phone (FIX HIGH-G6)', async () => {
    const user = fakeUser({
      phone: '+18095550000',
      email: 'jane@example.com',
      stripeCustomerId: 'cus_xyz',
    });
    repos.users.findOne.mockResolvedValue(user);
    repos.orders.count.mockResolvedValue(0);
    repos.users.delete.mockResolvedValue({ affected: 1 } as never);

    await service.deleteAccount('user-1');

    expect(repos.accountDeletions.save).toHaveBeenCalledTimes(1);
    const saved = repos.accountDeletions.save.mock.calls[0][0] as {
      hashedPhone?: string;
      hashedEmail?: string | null;
      stripeCustomerId?: string | null;
    };

    const expectedPhoneHash = createHash('sha256')
      .update('+18095550000' + 'a'.repeat(32))
      .digest('hex');
    const expectedEmailHash = createHash('sha256')
      .update('jane@example.com' + 'a'.repeat(32))
      .digest('hex');

    expect(saved.hashedPhone).toBe(expectedPhoneHash);
    expect(saved.hashedEmail).toBe(expectedEmailHash);
    expect(saved.stripeCustomerId).toBe('cus_xyz');
  });

  it('inserts an AccountDeletion audit row with null hashedEmail when user has no email (FIX HIGH-G6)', async () => {
    const user = fakeUser({ phone: '+18095550000', email: null });
    repos.users.findOne.mockResolvedValue(user);
    repos.orders.count.mockResolvedValue(0);
    repos.users.delete.mockResolvedValue({ affected: 1 } as never);

    await service.deleteAccount('user-1');

    const saved = repos.accountDeletions.save.mock.calls[0][0] as {
      hashedPhone?: string;
      hashedEmail?: string | null;
    };
    expect(saved.hashedEmail).toBeNull();
    expect(typeof saved.hashedPhone).toBe('string');
    expect(saved.hashedPhone?.length).toBe(64);
  });
});
