import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomInt } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { StringValue } from 'ms';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, LessThan, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import Stripe = require('stripe');
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
import { UserRole } from '../../entities/enums';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { PromotersService } from '../promoters/promoters.service';
import {
  classifyWhatsAppError,
  PERMANENT_WHATSAPP_ERROR_CODES,
  WHATSAPP_ERROR_MESSAGES,
} from './whatsapp-error-codes';

type StripeClient = InstanceType<typeof Stripe>;

const BCRYPT_ROUNDS = 10;
const OTP_TTL_MINUTES = 5;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_COOLDOWN_SECONDS = 30;

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);
  private stripe: StripeClient | null = null;

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(OtpCode) private readonly otps: Repository<OtpCode>,
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectRepository(UserAddress)
    private readonly addresses: Repository<UserAddress>,
    @InjectRepository(Subscription)
    private readonly subscriptions: Repository<Subscription>,
    @InjectRepository(Rental) private readonly rentals: Repository<Rental>,
    @InjectRepository(CreditAccount)
    private readonly credit: Repository<CreditAccount>,
    @InjectRepository(PromoterCommissionEntry)
    private readonly promoterCommissions: Repository<PromoterCommissionEntry>,
    @InjectRepository(Payout) private readonly payouts: Repository<Payout>,
    @InjectRepository(PointsLedgerEntry)
    private readonly pointsLedger: Repository<PointsLedgerEntry>,
    @InjectRepository(AccountDeletion)
    private readonly accountDeletions: Repository<AccountDeletion>,
    private readonly dataSource: DataSource,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly whatsapp: WhatsAppService,
    private readonly promoters: PromotersService,
  ) {}

  onModuleInit(): void {
    // FIX C2 — account deletion deletes the Stripe customer too. We lazily
    // construct the client at module init so that AuthService remains usable
    // for OTP flows even if Stripe is misconfigured (deleteAccount will then
    // warn and proceed without the customer.del call).
    const secret = this.config.get<string>('STRIPE_SECRET_KEY');
    if (!secret) {
      this.logger.warn(
        'STRIPE_SECRET_KEY missing — account deletion will skip Stripe customer cleanup',
      );
      return;
    }
    this.stripe = new Stripe(secret);
  }

  async refresh(refreshToken: string) {
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string }>(
        refreshToken,
        {
          secret: this.config.get<string>('JWT_SECRET'),
        },
      );
      const user = await this.users.findOne({ where: { id: payload.sub } });
      if (!user) throw new UnauthorizedException();
      return this.issueTokens(user);
    } catch {
      throw new UnauthorizedException('Refresh token inválido');
    }
  }

  async sendOtp(dto: SendOtpDto, opts: { skipCooldown?: boolean } = {}) {
    const phone = dto.phone.trim();

    // Phone-only login is the default — no code is sent. `requiresCode: false`
    // tells clients to skip the code step entirely. OTP delivery only runs
    // when an operator explicitly re-enables it (AUTH_OTP_MODE=whatsapp|sandbox).
    if (!this.isOtpEnabled()) {
      return {
        sent: true,
        expiresAt: new Date(
          Date.now() + OTP_TTL_MINUTES * 60 * 1000,
        ).toISOString(),
        requiresCode: false,
      };
    }

    if (!opts.skipCooldown) {
      const recent = await this.otps.findOne({
        where: { phone, consumedAt: IsNull() },
        order: { createdAt: 'DESC' },
      });
      if (recent) {
        const elapsed = (Date.now() - recent.createdAt.getTime()) / 1000;
        if (elapsed < OTP_RESEND_COOLDOWN_SECONDS) {
          throw new BadRequestException(
            `Esperá ${Math.ceil(OTP_RESEND_COOLDOWN_SECONDS - elapsed)}s antes de pedir otro código`,
          );
        }
      }
    }

    const isBypass = this.isBypassPhone(phone);
    const code = isBypass
      ? this.config.get<string>('AUTH_BYPASS_OTP_CODE', '000000')
      : this.generateOtpCode();
    const codeHash = await bcrypt.hash(code, BCRYPT_ROUNDS);
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

    // FIX MOBILE-G1 — persist the OTP first so verifyOtp can match against it,
    // BUT capture the row id so we can roll it back if WhatsApp delivery fails.
    // Without the rollback the mobile client would be stuck on cooldown for
    // 30s while no code ever arrives, and a retry inside that window would
    // bounce off the "esperá Xs antes de pedir otro código" check.
    const savedOtp = await this.otps.save(
      this.otps.create({ phone, codeHash, expiresAt, attempts: 0 }),
    );

    if (isBypass) {
      // [AUTH_BYPASS_ACTIVE] — load-bearing log marker for production alerting.
      // We emit this in EVERY environment (including production) so that ops
      // sees a clear signal in the log stream the moment the bypass is used.
      // env.schema.ts already blocks unsafe combinations (000000 code, non-test
      // phones) from booting in production — this log is the second line of
      // defense to catch misconfigurations that slip past CI.
      this.logger.warn(
        `[AUTH_BYPASS_ACTIVE] OTP send skipped for ${phone}; client should submit AUTH_BYPASS_OTP_CODE`,
      );
    } else {
      // WhatsApp-only OTP via Meta's WhatsApp Cloud API (graph.facebook.com).
      // SMS (Twilio) is reserved for admin order notifications because A2P
      // 10DLC SMS registration is heavy compared to the WhatsApp Business
      // path — see DEPLOYMENT.md §WhatsApp Cloud API setup.
      //
      // FIX HIGH-G7 — send failures are NOT one error class. We classify each
      // Meta failure into one of four codes so the mobile UI shows the right UX:
      //   • WHATSAPP_RATE_LIMITED      (HTTP 429 / 130429…) → retry with backoff
      //   • WHATSAPP_RECIPIENT_INVALID (131009)   → user fixes phone, no retry
      //   • WHATSAPP_RECIPIENT_NOT_REACHABLE (131026/131030) → no WhatsApp, call us
      //   • WHATSAPP_SEND_FAILED       (anything else) → generic retry
      //
      // The HTTP status communicates retry semantics at the protocol level
      // (503 = transient retry-after, 400 = permanent client-fix), while the
      // structured `code` body communicates the specific reason so the client
      // can switch on it. We also roll back the just-saved OTP row in every
      // failure branch so the user is not punished with the 30s cooldown for
      // a server-side problem they cannot remediate.
      try {
        await this.whatsapp.sendOtp(phone, code);
      } catch (err) {
        const classified = classifyWhatsAppError(err);
        const message =
          err instanceof Error ? err.message : 'unknown whatsapp error';
        this.logger.error(`[${classified}] phone=${phone} cause=${message}`);
        // Best-effort cleanup — if this delete itself fails we still want to
        // surface the original Twilio failure to the client, so we don't
        // re-throw from inside the catch.
        try {
          await this.otps.delete(savedOtp.id);
        } catch (cleanupErr) {
          this.logger.warn(
            `[${classified}] OTP rollback failed for ${phone}: ${
              (cleanupErr as Error).message
            }`,
          );
        }
        const body = {
          code: classified,
          message: WHATSAPP_ERROR_MESSAGES[classified],
        };
        // Permanent codes (invalid number, not on WhatsApp) → 400 BadRequest
        // because the user must change input before any retry can succeed.
        // Transient codes (rate-limited, generic catch-all) → 503 so HTTP
        // semantics carry the "retry safe" signal in addition to the body.
        if (PERMANENT_WHATSAPP_ERROR_CODES.has(classified)) {
          throw new BadRequestException(body);
        }
        throw new ServiceUnavailableException(body);
      }
    }

    return { sent: true, expiresAt: expiresAt.toISOString() };
  }

  /**
   * Phone-only login is the DEFAULT. OTP send + verification only run when an
   * operator explicitly re-enables them via AUTH_OTP_MODE=whatsapp|sandbox.
   * Any other value (including the 'disabled' default or an unset var) means
   * phone-only. Keeping the OTP code dormant behind this flag makes verified
   * login a config change away, not a code revert.
   */
  private isOtpEnabled(): boolean {
    const mode = this.config.get<string>('AUTH_OTP_MODE');
    return mode === 'whatsapp' || mode === 'sandbox';
  }

  private isBypassPhone(phone: string): boolean {
    return this.parsePhoneList('AUTH_BYPASS_PHONES').includes(phone);
  }

  private isBootstrapAdminPhone(phone: string): boolean {
    return this.parsePhoneList('AUTH_BOOTSTRAP_ADMIN_PHONES').includes(phone);
  }

  private parsePhoneList(envKey: string): string[] {
    const list = this.config.get<string>(envKey, '');
    if (!list) return [];
    return list
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  async verifyOtp(dto: VerifyOtpDto) {
    const phone = dto.phone.trim();

    // Phone-only login is the default — there is no code to verify, so just
    // look up (or create) the user and issue tokens. SECURITY: anyone who can
    // hit this endpoint with a known phone can log in as that user. OTP
    // verification is dormant and only runs when re-enabled via AUTH_OTP_MODE.
    if (!this.isOtpEnabled()) {
      return this.completeLogin(phone, dto);
    }

    // OTP re-enabled: a code is mandatory (the DTO makes it optional so the
    // phone-only path validates, so enforce presence here).
    if (!dto.code) {
      throw new BadRequestException('Falta el código de verificación');
    }

    const otp = await this.otps.findOne({
      where: { phone, consumedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
    if (!otp) {
      throw new UnauthorizedException(
        'No hay código pendiente para este teléfono',
      );
    }
    if (otp.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('El código expiró — pedí uno nuevo');
    }
    if (otp.attempts >= OTP_MAX_ATTEMPTS) {
      throw new UnauthorizedException(
        'Demasiados intentos fallidos — pedí un código nuevo',
      );
    }

    const ok = await bcrypt.compare(dto.code as string, otp.codeHash);
    if (!ok) {
      await this.otps.update(otp.id, { attempts: otp.attempts + 1 });
      throw new UnauthorizedException('Código inválido');
    }

    const result = await this.completeLogin(phone, dto);

    // OTP is consumed only after we're committed to issuing tokens, so any
    // earlier validation failure leaves the code reusable within its TTL.
    await this.otps.update(otp.id, { consumedAt: new Date() });
    await this.otps.delete({ phone, expiresAt: LessThan(new Date()) });

    return result;
  }

  /**
   * Shared tail of the login flow — runs after OTP validation (or after the
   * disabled-mode short-circuit). Looks up the user by phone, creates a new
   * row if none exists (requires `fullName`), wires referrals + bootstrap
   * admin role, and returns tokens + isNewUser.
   */
  private async completeLogin(phone: string, dto: VerifyOtpDto) {
    let user = await this.users.findOne({ where: { phone } });
    let isNewUser = false;

    if (!user) {
      if (!dto.fullName) {
        // In the normal OTP flow this preserves the still-valid code so the
        // client can resubmit with the name without a brand new SMS round
        // trip. In disabled mode the client should send name on the first
        // request anyway — this is a defensive fallback.
        throw new BadRequestException(
          'Es tu primer ingreso — mandá también tu nombre',
        );
      }

      let referredById: string | null = null;
      if (dto.referralCode) {
        const promoter = await this.promoters.findPromoterByReferralCode(
          dto.referralCode,
        );
        if (!promoter) {
          throw new BadRequestException('Código de referido inválido');
        }
        referredById = promoter.id;
      }

      const isBootstrapAdmin = this.isBootstrapAdminPhone(phone);
      user = await this.users.save(
        this.users.create({
          phone,
          fullName: dto.fullName,
          email: null,
          role: isBootstrapAdmin
            ? UserRole.SUPER_ADMIN_DELIVERY
            : UserRole.CLIENT,
          referredById,
        }),
      );
      isNewUser = true;
      if (isBootstrapAdmin) {
        this.logger.warn(
          `[AUTH_BOOTSTRAP] new user ${phone} provisioned as SUPER_ADMIN_DELIVERY`,
        );
      }
    }

    const tokens = await this.issueTokens(user);
    return { ...tokens, isNewUser };
  }

  private generateOtpCode(): string {
    const n = randomInt(0, 1_000_000);
    return n.toString().padStart(6, '0');
  }

  private async issueTokens(user: User) {
    const payload = { sub: user.id, phone: user.phone, role: user.role };
    // StringValue: jwt v11 types expiresIn as ms-style duration ('1h', '7d').
    const accessToken = await this.jwt.signAsync(payload, {
      expiresIn: this.config.get<StringValue>('JWT_ACCESS_TTL', '1h'),
    });
    const refreshToken = await this.jwt.signAsync(payload, {
      expiresIn: this.config.get<StringValue>('JWT_REFRESH_TTL', '7d'),
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        phone: user.phone,
        role: user.role,
        addressDefault: user.addressDefault,
        referralCode: user.referralCode,
      },
    };
  }

  /**
   * FIX C2 — Account deletion (Apple Guideline 5.1.1(v)).
   *
   * Removes a user's account end-to-end. The policy mirrors privacidad.tsx:
   *
   *   HARD-DELETE (no retention need)
   *     - user_addresses
   *     - otp_codes (matched by phone)
   *     - subscriptions
   *     - rentals
   *     - credit_account (movements cascade via FK)
   *     - points_ledger_entries
   *     - promoter_commission_entries where the user IS the promoter
   *     - payouts the user received as a promoter
   *
   *   SOFT-ANONYMIZE (7-year tax/accounting retention — RD law)
   *     - orders: customer_id → NULL,
   *               customer_name_snapshot → 'Cuenta eliminada',
   *               customer_phone_snapshot → NULL
   *
   *   EXTERNAL
   *     - Stripe customers.del — fired AFTER the DB transaction commits so
   *       a Stripe outage cannot leave us with orphan rows. If the customer
   *       was already deleted upstream (error.code === 'resource_missing')
   *       we swallow the error.
   *
   * Referral chain: User.referredById is ON DELETE SET NULL at the DB level,
   * so deleting promoter A automatically nulls the referredById of every
   * downstream user B. No application-level update needed.
   *
   * Wraps everything in a single TypeORM transaction so a partial failure
   * rolls back. Logs an audit warning before commit.
   */
  async deleteAccount(
    userId: string,
    options: { requestedVia?: string; requestedByUserId?: string | null } = {},
  ): Promise<void> {
    const requestedVia = options.requestedVia ?? 'in-app';
    const requestedByUserId = options.requestedByUserId ?? null;
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    const phone = user.phone;
    const email = user.email;
    const stripeCustomerId = user.stripeCustomerId;
    const fullName = user.fullName;

    // FIX HIGH-G6 — hash PII with JWT_SECRET as salt for the durable audit
    // row. Computed outside the transaction so the salt-resolution failure
    // mode is "service misconfigured" not "deletion half-finished".
    const hashSecret = this.config.get<string>('JWT_SECRET') ?? '';
    const hashedPhone = createHash('sha256')
      .update((phone ?? '') + hashSecret)
      .digest('hex');
    const hashedEmail = email
      ? createHash('sha256')
          .update(email + hashSecret)
          .digest('hex')
      : null;

    await this.dataSource.transaction(async (mgr) => {
      const orderRepo = mgr.getRepository(Order);
      const addressRepo = mgr.getRepository(UserAddress);
      const otpRepo = mgr.getRepository(OtpCode);
      const subRepo = mgr.getRepository(Subscription);
      const rentalRepo = mgr.getRepository(Rental);
      const creditRepo = mgr.getRepository(CreditAccount);
      const promoterCommissionRepo = mgr.getRepository(PromoterCommissionEntry);
      const payoutRepo = mgr.getRepository(Payout);
      const pointsRepo = mgr.getRepository(PointsLedgerEntry);
      const userRepo = mgr.getRepository(User);
      const accountDeletionRepo = mgr.getRepository(AccountDeletion);

      // Soft-anonymize first — we keep the order rows but unlink them from
      // the user. Doing this BEFORE deleting the user is required because
      // the FK is ON DELETE SET NULL, but the snapshot fields are NOT
      // touched by that cascade — we must write them ourselves.
      //
      // FIX CRITICAL-N1 — also overwrite delivery_address jsonb. Without
      // this, every retained order kept the user's full street address
      // (text + lat + lng) forever, defeating right-to-erasure.
      const orderCount = await orderRepo.count({
        where: { customerId: userId },
      });
      if (orderCount > 0) {
        await orderRepo.update(
          { customerId: userId },
          {
            customerId: null,
            customerNameSnapshot: 'Cuenta eliminada',
            customerPhoneSnapshot: null,
            deliveryAddress: {
              text: 'Cuenta eliminada',
              lat: null,
              lng: null,
            },
          },
        );
      }

      // FIX HIGH-G5 — snapshot the admin's full name into payouts they
      // created BEFORE the FK becomes null via ON DELETE SET NULL. This
      // preserves audit display ("issued by Admin X") even after the user
      // row is gone. The FK update itself is handled by the DB cascade
      // when we delete the user below.
      await payoutRepo.update(
        { createdByUserId: userId },
        { createdByNameSnapshot: fullName },
      );

      // Hard-deletes. Ordering matters where ON DELETE RESTRICT could fire:
      //   - credit_account has ON DELETE RESTRICT against users → delete it
      //     before the user.
      //   - subscriptions has ON DELETE RESTRICT against users → same.
      // The rest are CASCADE/SET NULL and would auto-clean, but we delete
      // them explicitly so behavior is identical across migration states
      // and easy to assert in tests.
      await addressRepo.delete({ userId });
      if (phone) {
        await otpRepo.delete({ phone });
      }
      await subRepo.delete({ userId });
      await rentalRepo.delete({ userId });
      await creditRepo.delete({ userId });
      await pointsRepo.delete({ userId });
      await promoterCommissionRepo.delete({ promoterId: userId });
      await payoutRepo.delete({ promoterId: userId });

      // FIX HIGH-G6 — durable audit row BEFORE the user is deleted, so the
      // insert and the user delete share a transaction. If the insert fails
      // (DB constraint, table missing), the whole deletion rolls back. No
      // FK to users — the users row is gone moments later.
      await accountDeletionRepo.save(
        accountDeletionRepo.create({
          hashedPhone,
          hashedEmail,
          stripeCustomerId: stripeCustomerId ?? null,
          requestedVia,
          requestedByUserId,
        }),
      );

      // Final step — hard-delete the user. DB-level FKs handle the rest:
      // referredById on other users is SET NULL; orders.customer_id was
      // already nulled above; payouts.created_by_user_id is SET NULL after
      // FIX HIGH-G5.
      await userRepo.delete(userId);
    });

    // Stripe cleanup AFTER the DB transaction commits. If Stripe is down
    // we'd rather log an alert than roll back a successful deletion.
    if (stripeCustomerId && this.stripe) {
      try {
        await this.stripe.customers.del(stripeCustomerId);
      } catch (err: unknown) {
        const code = (err as { code?: string } | null)?.code;
        if (code === 'resource_missing') {
          this.logger.warn(
            `[ACCOUNT_DELETE] Stripe customer ${stripeCustomerId} was already deleted`,
          );
        } else {
          // Re-throw so callers can see and alert. The DB rows are already
          // gone — that's intentional, the user's PII deletion is the
          // load-bearing part of this flow.
          throw err;
        }
      }
    }

    this.logger.warn(
      `[ACCOUNT_DELETE] user=${userId} phone=${phone ?? '(none)'} stripeCustomerId=${stripeCustomerId ?? '(none)'} via=${requestedVia}${requestedByUserId ? ` by=${requestedByUserId}` : ''}`,
    );
  }
}
