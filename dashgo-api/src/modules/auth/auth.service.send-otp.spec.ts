/**
 * FIX MOBILE-G1 — auth.service.sendOtp WhatsApp failure handling.
 *
 * The mobile sign-in screen matches against stable error codes
 * (e.g. `WHATSAPP_SEND_FAILED`) wrapped in a 503 ServiceUnavailableException.
 * This spec covers the service-side contract against the Meta WhatsApp Cloud
 * API sender (WhatsAppService.sendOtp):
 *
 *   1. Happy path — whatsapp.sendOtp resolves, sendOtp returns
 *      `{ sent: true, expiresAt }` and the OTP row stays.
 *   2. Send failure — sendOtp re-throws ServiceUnavailableException with
 *      body `{ code: 'WHATSAPP_SEND_FAILED', message: '...' }`.
 *   3. Send failure — the just-saved OTP row is deleted so the user does
 *      NOT get punished with the 30s resend cooldown for a server outage.
 *   4. AUTH_BYPASS phones still bypass the sender entirely and never touch the
 *      failure path.
 *   5. FIX HIGH-G7 — Meta numeric error codes classify into the four buckets.
 *
 * Repositories, WhatsAppService, Promoters and JWT are mocked. We do NOT
 * exercise the DB — the goal here is the failure-handling contract.
 */

import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { WHATSAPP_ERROR_CODES } from './whatsapp-error-codes';
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
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { PromotersService } from '../promoters/promoters.service';

// Stripe is imported at module load — mock so AuthService can construct
// without a real key.
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

describe('AuthService.sendOtp — WhatsApp (Meta Cloud API) failure handling (FIX MOBILE-G1)', () => {
  let service: AuthService;
  let otps: jest.Mocked<Repository<OtpCode>>;
  let whatsapp: { sendOtp: jest.Mock };

  const configValues: Record<string, string | undefined> = {
    JWT_SECRET: 'a'.repeat(32),
    STRIPE_SECRET_KEY: 'sk_test_dummy',
    AUTH_BYPASS_OTP_CODE: '000000',
    AUTH_BYPASS_PHONES: '+15555550000',
    // OTP is opt-in now (phone-only is the default). These specs exercise the
    // re-enabled WhatsApp delivery path, so turn it on explicitly.
    AUTH_OTP_MODE: 'whatsapp',
  };

  beforeEach(async () => {
    otps = makeRepoMock<OtpCode>();
    // The service saves an OTP and then issues whatsapp.sendOtp.
    // We need save() to return an object with a stable `id` so the rollback
    // delete call can target it.
    otps.save.mockImplementation(async (entity: any) => ({
      id: 'otp-1',
      ...entity,
    }));
    whatsapp = { sendOtp: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(User), useValue: makeRepoMock<User>() },
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
        {
          provide: getRepositoryToken(Rental),
          useValue: makeRepoMock<Rental>(),
        },
        {
          provide: getRepositoryToken(CreditAccount),
          useValue: makeRepoMock<CreditAccount>(),
        },
        {
          provide: getRepositoryToken(PromoterCommissionEntry),
          useValue: makeRepoMock<PromoterCommissionEntry>(),
        },
        {
          provide: getRepositoryToken(Payout),
          useValue: makeRepoMock<Payout>(),
        },
        {
          provide: getRepositoryToken(PointsLedgerEntry),
          useValue: makeRepoMock<PointsLedgerEntry>(),
        },
        {
          provide: getRepositoryToken(AccountDeletion),
          useValue: makeRepoMock<AccountDeletion>(),
        },
        {
          provide: DataSource,
          useValue: { transaction: jest.fn() },
        },
        {
          provide: JwtService,
          useValue: { signAsync: jest.fn(), verifyAsync: jest.fn() },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(
              (key: string, fallback?: string) => configValues[key] ?? fallback,
            ),
          },
        },
        { provide: WhatsAppService, useValue: whatsapp },
        {
          provide: PromotersService,
          useValue: { findPromoterByReferralCode: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    (service as unknown as { onModuleInit?: () => void }).onModuleInit?.();
  });

  it('returns { sent: true, expiresAt } when whatsapp resolves', async () => {
    whatsapp.sendOtp.mockResolvedValueOnce(undefined);

    const result = await service.sendOtp({ phone: '+18095550001' });

    expect(result.sent).toBe(true);
    expect(typeof result.expiresAt).toBe('string');
    expect(whatsapp.sendOtp).toHaveBeenCalledTimes(1);
    // OTP row stays — no rollback delete.
    expect(otps.delete).not.toHaveBeenCalled();
  });

  it('throws ServiceUnavailableException with WHATSAPP_SEND_FAILED code when whatsapp fails', async () => {
    whatsapp.sendOtp.mockRejectedValueOnce(
      new Error('Meta 500 Internal Server Error'),
    );

    let captured: unknown = null;
    try {
      await service.sendOtp({ phone: '+18095550002' });
    } catch (err) {
      captured = err;
    }

    expect(captured).toBeInstanceOf(ServiceUnavailableException);
    const body = (captured as ServiceUnavailableException).getResponse() as {
      code?: string;
      message?: string;
    };
    expect(body.code).toBe('WHATSAPP_SEND_FAILED');
    expect(typeof body.message).toBe('string');
    expect(body.message?.length).toBeGreaterThan(0);
  });

  it('rolls back the just-saved OTP row when whatsapp fails so the user is not stuck on cooldown', async () => {
    whatsapp.sendOtp.mockRejectedValueOnce(new Error('rate limited'));

    await expect(service.sendOtp({ phone: '+18095550003' })).rejects.toThrow(
      ServiceUnavailableException,
    );

    expect(otps.save).toHaveBeenCalledTimes(1);
    expect(otps.delete).toHaveBeenCalledWith('otp-1');
  });

  it('still throws the ServiceUnavailableException even if the OTP rollback delete itself fails', async () => {
    whatsapp.sendOtp.mockRejectedValueOnce(new Error('Meta 503'));
    // Cleanup failure must NOT mask the original send failure — the user
    // experience that matters is "WhatsApp didn't work, here's what to do".
    otps.delete.mockRejectedValueOnce(new Error('DB unavailable'));

    await expect(service.sendOtp({ phone: '+18095550004' })).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('does NOT call whatsapp for AUTH_BYPASS phones (bypass path is unchanged)', async () => {
    await service.sendOtp({ phone: '+15555550000' });

    expect(whatsapp.sendOtp).not.toHaveBeenCalled();
    // No rollback either — bypass never enters the WhatsApp branch.
    expect(otps.delete).not.toHaveBeenCalled();
  });

  // ── FIX HIGH-G7 — Distinct error codes per WhatsApp failure type ──────────
  //
  // Each Meta failure is rebuilt here as a plain object that mirrors the
  // WhatsAppApiError shape ({ status, code, message }). We do NOT import the
  // service's error class because the production code only inspects those
  // fields via the classifyWhatsAppError helper.

  /**
   * Build a Meta-shaped error. Both `status` (HTTP) and `code` (Meta's numeric
   * error code) are what classifyWhatsAppError dispatches on.
   */
  function metaError(opts: {
    status?: number;
    code?: number;
    message?: string;
  }): Error {
    const err = Object.assign(new Error(opts.message ?? 'meta graph error'), {
      status: opts.status,
      code: opts.code,
    });
    return err;
  }

  it('throws ServiceUnavailableException with WHATSAPP_RATE_LIMITED for HTTP 429', async () => {
    whatsapp.sendOtp.mockRejectedValueOnce(
      metaError({ status: 429, message: 'Too Many Requests' }),
    );

    let captured: unknown = null;
    try {
      await service.sendOtp({ phone: '+18095550010' });
    } catch (err) {
      captured = err;
    }

    expect(captured).toBeInstanceOf(ServiceUnavailableException);
    const body = (captured as ServiceUnavailableException).getResponse() as {
      code?: string;
    };
    expect(body.code).toBe(WHATSAPP_ERROR_CODES.WHATSAPP_RATE_LIMITED);
    // OTP row still rolled back so the user isn't cooldown-locked.
    expect(otps.delete).toHaveBeenCalledWith('otp-1');
  });

  it('throws ServiceUnavailableException with WHATSAPP_RATE_LIMITED for Meta code 130429', async () => {
    whatsapp.sendOtp.mockRejectedValueOnce(
      metaError({ status: 400, code: 130429, message: 'Rate limit hit' }),
    );

    let captured: unknown = null;
    try {
      await service.sendOtp({ phone: '+18095550015' });
    } catch (err) {
      captured = err;
    }

    expect(captured).toBeInstanceOf(ServiceUnavailableException);
    const body = (captured as ServiceUnavailableException).getResponse() as {
      code?: string;
    };
    expect(body.code).toBe(WHATSAPP_ERROR_CODES.WHATSAPP_RATE_LIMITED);
  });

  it('throws BadRequestException with WHATSAPP_RECIPIENT_INVALID for Meta code 131009', async () => {
    whatsapp.sendOtp.mockRejectedValueOnce(
      metaError({
        status: 400,
        code: 131009,
        message: 'Parameter value is not valid',
      }),
    );

    let captured: unknown = null;
    try {
      await service.sendOtp({ phone: '+1invalid' });
    } catch (err) {
      captured = err;
    }

    expect(captured).toBeInstanceOf(BadRequestException);
    const body = (captured as BadRequestException).getResponse() as {
      code?: string;
    };
    expect(body.code).toBe(WHATSAPP_ERROR_CODES.WHATSAPP_RECIPIENT_INVALID);
  });

  it('throws BadRequestException with WHATSAPP_RECIPIENT_NOT_REACHABLE for Meta code 131026', async () => {
    whatsapp.sendOtp.mockRejectedValueOnce(
      metaError({
        status: 400,
        code: 131026,
        message: 'Message undeliverable',
      }),
    );

    let captured: unknown = null;
    try {
      await service.sendOtp({ phone: '+18095550012' });
    } catch (err) {
      captured = err;
    }

    expect(captured).toBeInstanceOf(BadRequestException);
    const body = (captured as BadRequestException).getResponse() as {
      code?: string;
      message?: string;
    };
    expect(body.code).toBe(
      WHATSAPP_ERROR_CODES.WHATSAPP_RECIPIENT_NOT_REACHABLE,
    );
    expect(body.message).toMatch(/WhatsApp/i);
  });

  it('throws BadRequestException with WHATSAPP_RECIPIENT_NOT_REACHABLE for Meta code 131030 (not in allowed list)', async () => {
    whatsapp.sendOtp.mockRejectedValueOnce(
      metaError({
        status: 400,
        code: 131030,
        message: 'Recipient phone number not in allowed list',
      }),
    );

    let captured: unknown = null;
    try {
      await service.sendOtp({ phone: '+18095550013' });
    } catch (err) {
      captured = err;
    }

    expect(captured).toBeInstanceOf(BadRequestException);
    const body = (captured as BadRequestException).getResponse() as {
      code?: string;
    };
    expect(body.code).toBe(
      WHATSAPP_ERROR_CODES.WHATSAPP_RECIPIENT_NOT_REACHABLE,
    );
  });

  it('throws ServiceUnavailableException with WHATSAPP_SEND_FAILED for a template error (132001)', async () => {
    whatsapp.sendOtp.mockRejectedValueOnce(
      metaError({
        status: 400,
        code: 132001,
        message: 'Template name does not exist',
      }),
    );

    let captured: unknown = null;
    try {
      await service.sendOtp({ phone: '+18095550016' });
    } catch (err) {
      captured = err;
    }

    expect(captured).toBeInstanceOf(ServiceUnavailableException);
    const body = (captured as ServiceUnavailableException).getResponse() as {
      code?: string;
    };
    expect(body.code).toBe(WHATSAPP_ERROR_CODES.WHATSAPP_SEND_FAILED);
  });

  it('throws ServiceUnavailableException with WHATSAPP_SEND_FAILED for a generic HTTP 500', async () => {
    whatsapp.sendOtp.mockRejectedValueOnce(
      metaError({ status: 500, message: 'Internal Server Error' }),
    );

    let captured: unknown = null;
    try {
      await service.sendOtp({ phone: '+18095550014' });
    } catch (err) {
      captured = err;
    }

    expect(captured).toBeInstanceOf(ServiceUnavailableException);
    const body = (captured as ServiceUnavailableException).getResponse() as {
      code?: string;
    };
    expect(body.code).toBe(WHATSAPP_ERROR_CODES.WHATSAPP_SEND_FAILED);
  });
});
