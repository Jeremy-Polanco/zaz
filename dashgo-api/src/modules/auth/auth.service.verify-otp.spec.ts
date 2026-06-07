/**
 * Phone-only login is the DEFAULT (product pivot — no OTP verification).
 *
 * AUTH_OTP_MODE governs whether OTP is active at all:
 *   - unset / 'disabled' → phone-only: sendOtp is a no-op (requiresCode:false)
 *     and verifyOtp authenticates by phone alone via completeLogin().
 *   - 'whatsapp' / 'sandbox' → OTP is RE-ENABLED (dormant code path): a code is
 *     sent and verifyOtp enforces it.
 *
 * This spec pins the phone-only contract (the default) and the
 * OTP-enabled guard that a missing code is rejected once OTP is on.
 *
 * Repos, Twilio, Promoters, JWT and DataSource are mocked — no DB.
 */

import { BadRequestException } from '@nestjs/common';
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
import { TwilioService } from '../twilio/twilio.service';
import { PromotersService } from '../promoters/promoters.service';
import { UserRole } from '../../entities/enums';

// Stripe is imported at module load — mock so AuthService can construct.
jest.mock('stripe', () => {
  const mock = jest.fn().mockImplementation(() => ({
    customers: { del: jest.fn() },
  }));
  (mock as unknown as Record<string, unknown>)['default'] = mock;
  return mock;
});

function makeRepoMock<T>(): jest.Mocked<Repository<T>> {
  return {
    find: jest.fn(),
    findOne: jest.fn().mockResolvedValue(null),
    save: jest.fn(),
    update: jest.fn(),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
    create: jest.fn((dto: Partial<T>) => dto as T),
    count: jest.fn(),
  } as unknown as jest.Mocked<Repository<T>>;
}

describe('AuthService login — phone-only default + OTP re-enable guard', () => {
  let service: AuthService;
  let users: jest.Mocked<Repository<User>>;
  let otps: jest.Mocked<Repository<OtpCode>>;
  let twilio: { sendWhatsAppOtp: jest.Mock };
  let promoters: { findPromoterByReferralCode: jest.Mock };

  // Mutable so individual tests can flip OTP back on.
  let configValues: Record<string, string | undefined>;

  beforeEach(async () => {
    configValues = {
      JWT_SECRET: 'a'.repeat(32),
      STRIPE_SECRET_KEY: 'sk_test_dummy',
      // AUTH_OTP_MODE intentionally unset → phone-only is the default.
    };

    users = makeRepoMock<User>();
    otps = makeRepoMock<OtpCode>();
    twilio = { sendWhatsAppOtp: jest.fn().mockResolvedValue(undefined) };
    promoters = { findPromoterByReferralCode: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(User), useValue: users },
        { provide: getRepositoryToken(OtpCode), useValue: otps },
        { provide: getRepositoryToken(Order), useValue: makeRepoMock<Order>() },
        {
          provide: getRepositoryToken(UserAddress),
          useValue: makeRepoMock<UserAddress>(),
        },
        {
          provide: getRepositoryToken(Subscription),
          useValue: makeRepoMock<Subscription>(),
        },
        { provide: getRepositoryToken(Rental), useValue: makeRepoMock<Rental>() },
        {
          provide: getRepositoryToken(CreditAccount),
          useValue: makeRepoMock<CreditAccount>(),
        },
        {
          provide: getRepositoryToken(PromoterCommissionEntry),
          useValue: makeRepoMock<PromoterCommissionEntry>(),
        },
        { provide: getRepositoryToken(Payout), useValue: makeRepoMock<Payout>() },
        {
          provide: getRepositoryToken(PointsLedgerEntry),
          useValue: makeRepoMock<PointsLedgerEntry>(),
        },
        {
          provide: getRepositoryToken(AccountDeletion),
          useValue: makeRepoMock<AccountDeletion>(),
        },
        { provide: DataSource, useValue: { transaction: jest.fn() } },
        {
          provide: JwtService,
          useValue: {
            signAsync: jest
              .fn()
              .mockImplementation(async () => 'signed-jwt-token'),
            verifyAsync: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(
              (key: string, fallback?: string) => configValues[key] ?? fallback,
            ),
          },
        },
        { provide: TwilioService, useValue: twilio },
        { provide: PromotersService, useValue: promoters },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    (service as unknown as { onModuleInit?: () => void }).onModuleInit?.();
  });

  function existingUser(overrides: Partial<User> = {}): User {
    return {
      id: 'user-1',
      email: null,
      fullName: 'Returning User',
      phone: '+18095550000',
      role: UserRole.CLIENT,
      addressDefault: null,
      referralCode: null,
      referredById: null,
      referredBy: null,
      stripeCustomerId: null,
      createdAt: new Date(),
      ...overrides,
    } as User;
  }

  // ── Phone-only (default) ────────────────────────────────────────────────

  it('logs in an EXISTING user by phone alone — no code, no OTP table access', async () => {
    users.findOne.mockResolvedValue(existingUser());

    const result = await service.verifyOtp({ phone: '+18095550000' });

    expect(result.accessToken).toBe('signed-jwt-token');
    expect(result.refreshToken).toBe('signed-jwt-token');
    expect(result.user.phone).toBe('+18095550000');
    expect(result.isNewUser).toBe(false);
    // The OTP machinery must be completely bypassed.
    expect(otps.findOne).not.toHaveBeenCalled();
    expect(otps.update).not.toHaveBeenCalled();
  });

  it('creates a NEW user (role CLIENT) on first phone-only login when fullName is provided', async () => {
    users.findOne.mockResolvedValue(null);
    users.save.mockImplementation(async (u: Partial<User>) =>
      existingUser({ ...u, id: 'new-1' } as Partial<User>),
    );

    const result = await service.verifyOtp({
      phone: '+18095551111',
      fullName: 'Juan Pérez',
    });

    expect(users.save).toHaveBeenCalledTimes(1);
    const created = users.create.mock.calls[0][0] as Partial<User>;
    expect(created.phone).toBe('+18095551111');
    expect(created.fullName).toBe('Juan Pérez');
    expect(created.role).toBe(UserRole.CLIENT);
    expect(result.isNewUser).toBe(true);
  });

  it('rejects a first-time phone-only login WITHOUT a name ("primer ingreso")', async () => {
    users.findOne.mockResolvedValue(null);

    await expect(
      service.verifyOtp({ phone: '+18095552222' }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.verifyOtp({ phone: '+18095552222' }),
    ).rejects.toThrow(/primer ingreso/i);
    expect(users.save).not.toHaveBeenCalled();
  });

  it('resolves a valid referralCode to referredById on first phone-only login', async () => {
    users.findOne.mockResolvedValue(null);
    promoters.findPromoterByReferralCode.mockResolvedValue({ id: 'promo-1' });
    users.save.mockImplementation(async (u: Partial<User>) =>
      existingUser({ ...u, id: 'new-2' } as Partial<User>),
    );

    await service.verifyOtp({
      phone: '+18095553333',
      fullName: 'Ana',
      referralCode: 'ABCD1234',
    });

    expect(promoters.findPromoterByReferralCode).toHaveBeenCalledWith(
      'ABCD1234',
    );
    const created = users.create.mock.calls[0][0] as Partial<User>;
    expect(created.referredById).toBe('promo-1');
  });

  it('rejects an invalid referralCode on first phone-only login', async () => {
    users.findOne.mockResolvedValue(null);
    promoters.findPromoterByReferralCode.mockResolvedValue(null);

    await expect(
      service.verifyOtp({
        phone: '+18095554444',
        fullName: 'Ana',
        referralCode: 'BADCODE1',
      }),
    ).rejects.toThrow(/referido inválido/i);
  });

  it('provisions a bootstrap-admin phone as SUPER_ADMIN_DELIVERY (phone-only)', async () => {
    configValues.AUTH_BOOTSTRAP_ADMIN_PHONES = '+18095559999';
    users.findOne.mockResolvedValue(null);
    users.save.mockImplementation(async (u: Partial<User>) =>
      existingUser({ ...u, id: 'admin-1' } as Partial<User>),
    );

    await service.verifyOtp({
      phone: '+18095559999',
      fullName: 'Operario',
    });

    const created = users.create.mock.calls[0][0] as Partial<User>;
    expect(created.role).toBe(UserRole.SUPER_ADMIN_DELIVERY);
  });

  it('sendOtp is a no-op in phone-only mode — requiresCode:false, no Twilio, no OTP row', async () => {
    const result = await service.sendOtp({ phone: '+18095550000' });

    expect(result.sent).toBe(true);
    expect((result as { requiresCode?: boolean }).requiresCode).toBe(false);
    expect(typeof result.expiresAt).toBe('string');
    expect(twilio.sendWhatsAppOtp).not.toHaveBeenCalled();
    expect(otps.save).not.toHaveBeenCalled();
  });

  // ── OTP re-enabled (dormant path) ───────────────────────────────────────

  it('when OTP is re-enabled (whatsapp), verifyOtp without a code is rejected', async () => {
    configValues.AUTH_OTP_MODE = 'whatsapp';

    await expect(
      service.verifyOtp({ phone: '+18095550000' }),
    ).rejects.toThrow(BadRequestException);
    // Must not have reached the user lookup / completeLogin.
    expect(users.findOne).not.toHaveBeenCalled();
  });
});
