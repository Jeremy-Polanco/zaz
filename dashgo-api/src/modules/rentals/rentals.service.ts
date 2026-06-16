import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as Sentry from '@sentry/node';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import Stripe = require('stripe');
import { Rental, RentalStatus } from '../../entities/rental.entity';
import { User } from '../../entities/user.entity';
import { Product } from '../../entities/product.entity';
import { CustomerRentalResponseDto } from './dto/customer-rental-response.dto';
import { AdminRentalResponseDto } from './dto/admin-rental-response.dto';
import { ChargeLateFeeResponseDto } from './dto/charge-late-fee-response.dto';
import { ChargeTheftFeeResponseDto } from './dto/charge-theft-fee-response.dto';
import { assertStripeProductionConfig } from '../../common/stripe/stripe-runtime-guard';

type StripeClient = InstanceType<typeof Stripe>;

/**
 * Stripe price lookup_keys for the subscriber bebedero rates. These let us
 * find (and idempotently create) the two flat recurring prices without storing
 * their IDs in our own DB — Stripe is the source of truth via the lookup_key.
 */
const BEBEDERO_FREE_LOOKUP_KEY = 'bebedero_free_monthly';
const BEBEDERO_SUBSCRIBER_LOOKUP_KEY = 'bebedero_subscriber_monthly';

/** Statuses that indicate an active rental contract (no new duplicate allowed). */
const BLOCKING_STATUSES = [
  RentalStatus.PENDING_SETUP,
  RentalStatus.ACTIVE,
  RentalStatus.PAST_DUE,
  RentalStatus.UNPAID,
] as const;

/** Default page size for listAdmin. */
const DEFAULT_PAGE_SIZE = 25;

/** Bebedero maintenance interval — maintenance is due every 30 days. */
const MAINTENANCE_INTERVAL_DAYS = 30;
const MAINTENANCE_INTERVAL_MS = MAINTENANCE_INTERVAL_DAYS * 24 * 60 * 60 * 1000;

export interface CreateForOrderParams {
  userId: string;
  productId: string;
  orderId: string;
  product: Product;
  /**
   * Subscriber bebedero benefit overrides. When present, the Rental snapshots
   * these INSTEAD of the product's catalog values, so both the order's
   * first-month charge and the recurring Stripe subscription bill the
   * subscriber rate ($0 for the first bebedero, $6.99 for additional ones).
   * Resolved by OrdersService at order time. Omit for catalog pricing.
   */
  monthlyRentCentsOverride?: number;
  stripePriceIdOverride?: string;
}

export interface ListAdminFilters {
  status?: RentalStatus[];
  userId?: string;
  productId?: string;
  page?: number;
  pageSize?: number;
}

@Injectable()
export class RentalsService implements OnModuleInit {
  private readonly logger = new Logger(RentalsService.name);
  private stripe: StripeClient | null = null;

  /**
   * In-memory cache of the resolved subscriber bebedero price IDs, keyed by the
   * subscriber net amount they were resolved for. A change in the subscription
   * price invalidates the cache so the subscriber price is regenerated.
   */
  private bebederoRatePrices: {
    freePriceId: string;
    subscriberPriceId: string;
    subscriberAmountCents: number;
  } | null = null;

  constructor(
    @InjectRepository(Rental)
    private readonly rentals: Repository<Rental>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(Product)
    private readonly products: Repository<Product>,
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const secret = this.config.get<string>('STRIPE_SECRET_KEY');
    // FIX C6 — fail boot in production if Stripe credentials are misconfigured.
    assertStripeProductionConfig({
      nodeEnv: this.config.get<string>('NODE_ENV') ?? 'development',
      stripeSecretKey: secret,
      stripeWebhookSecret: this.config.get<string>('STRIPE_WEBHOOK_SECRET'),
      stripeSubscriptionPriceId: this.config.get<string>(
        'STRIPE_SUBSCRIPTION_PRICE_ID',
      ),
    });
    if (!secret) {
      this.logger.warn(
        'STRIPE_SECRET_KEY missing — rental Stripe integration disabled',
      );
      return;
    }
    this.stripe = new Stripe(secret);
  }

  private requireStripe(): StripeClient {
    if (!this.stripe) {
      throw new Error(
        'Stripe client not initialized — STRIPE_SECRET_KEY missing',
      );
    }
    return this.stripe;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // T20 — createForOrder
  //
  // Inserts a Rental row with status='pending_setup' inside a TX.
  // Pre-checks for duplicate active rental (SELECT FOR UPDATE).
  // No Stripe call here — Stripe subscription is created in activateForOrder.
  // ─────────────────────────────────────────────────────────────────────────

  async createForOrder(
    params: CreateForOrderParams,
    tx?: EntityManager,
  ): Promise<Rental> {
    const { userId, productId, orderId, product } = params;

    // When an external TX is provided (e.g., from OrdersService.create), use it directly
    // so the Rental row commits atomically with the Order row.
    if (tx) {
      return this.createForOrderWithManager(params, tx);
    }

    // Standalone path: open own QueryRunner TX
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    try {
      const saved = await this.createForOrderWithManager(params, qr.manager);
      await qr.commitTransaction();
      return saved;
    } catch (err) {
      await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }
  }

  private async createForOrderWithManager(
    params: CreateForOrderParams,
    em: EntityManager,
  ): Promise<Rental> {
    const { userId, productId, orderId, product } = params;

    // T26: pre-check — SELECT FOR UPDATE to prevent race conditions
    const existing = await em.findOne(Rental, {
      where: {
        userId,
        productId,
        status: In(BLOCKING_STATUSES),
      },
      lock: { mode: 'pessimistic_write' },
    });

    if (existing) {
      throw new ConflictException({
        code: 'RENTAL_ALREADY_ACTIVE',
        message: 'Ya existe un alquiler activo para este usuario y producto.',
      });
    }

    // Snapshot pricing at creation time. Subscriber bebedero overrides win over
    // catalog values when present (first bebedero free / additional at $6.99).
    const rentalData: Partial<Rental> = {
      userId,
      productId,
      orderId,
      stripePriceId: params.stripePriceIdOverride ?? product.stripePriceId,
      monthlyRentCents:
        params.monthlyRentCentsOverride ?? product.monthlyRentCents,
      lateFeeCents: product.lateFeeCents,
      theftFeeCents: product.theftFeeCents ?? 0,
      status: RentalStatus.PENDING_SETUP,
    };

    return em.save(Rental, rentalData);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // T65 — activateRentalsForOrder
  //
  // Called by OrdersService.markDelivered() after PI capture.
  // Finds all pending_setup Rentals tied to the orderId, then activates each.
  // ADR-6 compliant: Stripe calls happen OUTSIDE the TX (each activateForOrder
  // call does its own Stripe interaction and mini-TX for status update).
  // Best-effort: if any single activation fails, it stays pending_setup.
  // ─────────────────────────────────────────────────────────────────────────

  async activateRentalsForOrder(orderId: string): Promise<Rental[]> {
    // Find all pending_setup rentals tied to this order
    const pendingRentals = await this.rentals.find({
      where: { orderId, status: RentalStatus.PENDING_SETUP },
    });

    if (pendingRentals.length === 0) {
      return [];
    }

    // Activate each rental best-effort (errors are swallowed in activateForOrder)
    const results: Rental[] = [];
    for (const rental of pendingRentals) {
      const activated = await this.activateForOrder(rental.id);
      results.push(activated);
    }
    return results;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // T22, T24 — activateForOrder
  //
  // ADR-6: Stripe call OUTSIDE the DB TX.
  // 1. Load rental from repo (verify status=pending_setup)
  // 2. Load user (for stripeCustomerId)
  // 3. Call performActivation (shared with retrySetup)
  // 4. On Stripe failure: log, return rental unchanged (caller unaffected)
  // ─────────────────────────────────────────────────────────────────────────

  async activateForOrder(rentalId: string): Promise<Rental> {
    // Step 1: Load rental
    const rental = await this.rentals.findOne({ where: { id: rentalId } });
    if (!rental) {
      throw new NotFoundException(`Rental ${rentalId} not found`);
    }

    if (rental.status !== RentalStatus.PENDING_SETUP) {
      this.logger.warn(
        `activateForOrder: rental ${rentalId} is not pending_setup (status=${rental.status}), skipping`,
      );
      return rental;
    }

    // Step 2: Load user
    const user = await this.users.findOne({ where: { id: rental.userId } });
    if (!user?.stripeCustomerId) {
      this.logger.warn(
        `activateForOrder: user ${rental.userId} has no stripeCustomerId`,
      );
      return rental;
    }

    try {
      return await this.performActivation(rental, user);
    } catch (err) {
      // T24: Stripe failure — keep pending_setup, log, return unchanged
      this.logger.error(
        `activateForOrder: Stripe subscriptions.create failed for rental ${rentalId}: ${(err as Error).message}`,
      );
      Sentry.captureException(err, {
        tags: { module: 'rentals', phase: 'activation' },
        extra: { rentalId, userId: rental.userId, productId: rental.productId },
      });
      return rental;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // performActivation — shared activation logic (used by activateForOrder
  // and retrySetup). Creates the Stripe Subscription and persists the result.
  //
  // THROWS on Stripe failure — callers decide how to handle errors.
  // ─────────────────────────────────────────────────────────────────────────

  private async performActivation(rental: Rental, user: User): Promise<Rental> {
    const stripe = this.requireStripe();
    const trialEnd = Math.floor(Date.now() / 1000) + 30 * 86400;
    const rentalId = rental.id;

    const sub = await stripe.subscriptions.create(
      {
        customer: user.stripeCustomerId,
        items: [{ price: rental.stripePriceId }],
        trial_end: trialEnd,
        billing_cycle_anchor: trialEnd,
        proration_behavior: 'none',
        metadata: {
          rentalId,
          userId: rental.userId,
          productId: rental.productId,
        },
      },
      { idempotencyKey: `rental-setup-${rentalId}` },
    );

    const subObj = sub as {
      id: string;
      current_period_start?: number;
      current_period_end?: number;
      items?: {
        data?: Array<{
          current_period_start?: number;
          current_period_end?: number;
        }>;
      };
    };

    const periodStart =
      subObj.items?.data?.[0]?.current_period_start ??
      subObj.current_period_start ??
      null;
    const periodEnd =
      subObj.items?.data?.[0]?.current_period_end ??
      subObj.current_period_end ??
      null;

    rental.status = RentalStatus.ACTIVE;
    rental.stripeSubscriptionId = subObj.id;
    rental.activatedAt = new Date();
    rental.currentPeriodStart = periodStart
      ? new Date(periodStart * 1000)
      : null;
    rental.currentPeriodEnd = periodEnd ? new Date(periodEnd * 1000) : null;

    // Start the bebedero maintenance countdown for products that require it,
    // unless the admin has disabled this user's maintenance timer (e.g. a
    // subscriber who does not hold a physical bebedero).
    // Day 0 = activation; the next maintenance is due 30 days out.
    const product = await this.products.findOne({
      where: { id: rental.productId },
    });
    if (product?.requiresMaintenance && !user.maintenanceTimerDisabled) {
      rental.nextMaintenanceAt = new Date(Date.now() + MAINTENANCE_INTERVAL_MS);
    }

    return this.rentals.save(rental);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // resetMaintenanceForUser
  //
  // Called by OrdersService.markDelivered when a delivered order contained a
  // maintenance-service product. Resets the 30-day maintenance countdown on
  // every ACTIVE rental of this user that tracks maintenance (next_maintenance_at
  // is non-null). Returns the number of rentals reset.
  // ─────────────────────────────────────────────────────────────────────────

  async resetMaintenanceForUser(userId: string): Promise<number> {
    // Respect the per-user disable switch — no maintenance scheduling at all.
    const user = await this.users.findOne({ where: { id: userId } });
    if (user?.maintenanceTimerDisabled) {
      this.logger.log(
        `resetMaintenanceForUser: user ${userId} has maintenance timer disabled — skipping`,
      );
      return 0;
    }

    const active = await this.rentals.find({
      where: { userId, status: RentalStatus.ACTIVE },
    });
    const toReset = active.filter((r) => r.nextMaintenanceAt !== null);
    if (toReset.length === 0) return 0;

    const now = new Date();
    const next = new Date(now.getTime() + MAINTENANCE_INTERVAL_MS);
    for (const r of toReset) {
      r.lastMaintenanceAt = now;
      r.nextMaintenanceAt = next;
      await this.rentals.save(r);
    }
    this.logger.log(
      `resetMaintenanceForUser: reset maintenance on ${toReset.length} rental(s) for user ${userId}`,
    );
    return toReset.length;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Internal helper (used by OrdersService.create pre-check)
  // ─────────────────────────────────────────────────────────────────────────

  async findActiveByUserAndProduct(
    userId: string,
    productId: string,
    tx?: EntityManager,
  ): Promise<Rental | null> {
    if (tx) {
      return tx.findOne(Rental, {
        where: { userId, productId, status: In(BLOCKING_STATUSES) },
        lock: { mode: 'pessimistic_write' },
      });
    }
    return this.rentals.findOne({
      where: { userId, productId, status: In(BLOCKING_STATUSES) },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // countBebederoRentalsForUser
  //
  // Lifetime count of bebedero (water dispenser) rentals a user has ever held,
  // in ANY status (active, canceled, etc.). A bebedero is a rental product with
  // requiresMaintenance=true. Drives the subscriber pricing tier: a user with
  // 0 prior bebederos gets their first one free; additional ones rent at the
  // flat subscriber rate. See resolveBebederoRentCents (products/pricing.ts).
  // ─────────────────────────────────────────────────────────────────────────

  // ─────────────────────────────────────────────────────────────────────────
  // ensureBebederoRatePrices
  //
  // Lazily provisions (and caches) the two flat recurring Stripe Prices used
  // for the subscriber bebedero benefit:
  //   - $0.00/mo            → the first bebedero (free)   lookup_key bebedero_free_monthly
  //   - subscription price  → each additional bebedero    lookup_key bebedero_subscriber_monthly
  //
  // The subscriber price TRACKS the live subscription price (net cents, passed
  // by OrdersService from subscription_plan.unitAmountCents) so the additional
  // bebedero always rents at the same price as the subscription. Stripe prices
  // are immutable, so when the plan price changes we mint a NEW subscriber price
  // at the new amount, move the lookup_key onto it, and archive the stale one.
  //
  // Idempotent + amount-keyed cache: same amount → cached, no Stripe calls;
  // changed amount → re-resolve. Stripe is the source of truth — we persist
  // nothing in our own DB.
  // ─────────────────────────────────────────────────────────────────────────

  async ensureBebederoRatePrices(subscriberNetCents: number): Promise<{
    freePriceId: string;
    subscriberPriceId: string;
  }> {
    const cached = this.bebederoRatePrices;
    if (cached && cached.subscriberAmountCents === subscriberNetCents) {
      return {
        freePriceId: cached.freePriceId,
        subscriberPriceId: cached.subscriberPriceId,
      };
    }

    const stripe = this.requireStripe();

    const existing = await stripe.prices.list({
      lookup_keys: [BEBEDERO_FREE_LOOKUP_KEY, BEBEDERO_SUBSCRIBER_LOOKUP_KEY],
      active: true,
    });

    const byKey = new Map<string, { id: string; amount: number | null }>();
    for (const p of existing.data ?? []) {
      if (p.lookup_key) {
        byKey.set(p.lookup_key, { id: p.id, amount: p.unit_amount ?? null });
      }
    }

    let freePriceId = byKey.get(BEBEDERO_FREE_LOOKUP_KEY)?.id;
    const existingSub = byKey.get(BEBEDERO_SUBSCRIBER_LOOKUP_KEY);
    // Reuse the subscriber price only when it already bills the live amount.
    let subscriberPriceId =
      existingSub && existingSub.amount === subscriberNetCents
        ? existingSub.id
        : undefined;

    // Create the shared rate product lazily — only when we actually need to
    // mint a price. Idempotency key keeps it a single shared product.
    let rateProductId: string | undefined;
    const ensureRateProduct = async (): Promise<string> => {
      if (rateProductId) return rateProductId;
      const product = await stripe.products.create(
        {
          name: 'Bebedero — Tarifa Suscriptor',
          metadata: { kind: 'bebedero_subscriber_rate' },
        },
        { idempotencyKey: 'bebedero-rate-product' },
      );
      rateProductId = product.id;
      return rateProductId;
    };

    if (!freePriceId) {
      const price = await stripe.prices.create(
        {
          unit_amount: 0,
          currency: 'usd',
          recurring: { interval: 'month' },
          product: await ensureRateProduct(),
          lookup_key: BEBEDERO_FREE_LOOKUP_KEY,
        },
        { idempotencyKey: 'bebedero-rate-price-free' },
      );
      freePriceId = price.id;
    }

    if (!subscriberPriceId) {
      // Missing, or the plan price changed — (re)create at the live amount and
      // transfer the lookup_key onto the new price.
      const price = await stripe.prices.create(
        {
          unit_amount: subscriberNetCents,
          currency: 'usd',
          recurring: { interval: 'month' },
          product: await ensureRateProduct(),
          lookup_key: BEBEDERO_SUBSCRIBER_LOOKUP_KEY,
          transfer_lookup_key: true,
        },
        {
          idempotencyKey: `bebedero-rate-price-subscriber-${subscriberNetCents}`,
        },
      );
      subscriberPriceId = price.id;

      // Archive the stale price (non-blocking) so it stops being billable.
      if (existingSub && existingSub.id !== subscriberPriceId) {
        try {
          await stripe.prices.update(existingSub.id, { active: false });
        } catch (e) {
          this.logger.warn(
            `failed to archive stale bebedero subscriber price ${existingSub.id}: ${(e as Error).message}`,
          );
        }
      }
    }

    this.bebederoRatePrices = {
      freePriceId,
      subscriberPriceId,
      subscriberAmountCents: subscriberNetCents,
    };
    return { freePriceId, subscriberPriceId };
  }

  async countBebederoRentalsForUser(
    userId: string,
    tx?: EntityManager,
  ): Promise<number> {
    const repo = tx ? tx.getRepository(Rental) : this.rentals;
    return repo
      .createQueryBuilder('rental')
      .innerJoin('rental.product', 'product')
      .where('rental.userId = :userId', { userId })
      .andWhere('product.pricingMode = :mode', { mode: 'rental' })
      .andWhere('product.requiresMaintenance = true')
      .getCount();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // T5.5 — findEligibleForLateFee
  //
  // Returns rentals eligible for a daily late-fee charge:
  //   status = PAST_DUE
  //   AND pastDueSince <= NOW - 3 days (grace period elapsed)
  //   AND (lastLateFeeAt IS NULL OR lastLateFeeAt < today UTC midnight)
  //
  // Parameterized query — safe for injection.
  // ─────────────────────────────────────────────────────────────────────────

  async findEligibleForLateFee(): Promise<Rental[]> {
    // 3-day grace period threshold (UTC)
    const now = new Date();
    const gracePeriodMs = 3 * 24 * 60 * 60 * 1000;
    const threshold = new Date(now.getTime() - gracePeriodMs);

    // Today at UTC midnight for the "already charged today" check
    const todayUTC = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );

    return this.rentals
      .createQueryBuilder('rental')
      .where('rental.status = :status', { status: RentalStatus.PAST_DUE })
      .andWhere('rental.pastDueSince <= :threshold', { threshold })
      .andWhere(
        '(rental.lastLateFeeAt IS NULL OR rental.lastLateFeeAt < :todayUTC)',
        { todayUTC },
      )
      .getMany();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // T28 — listMine
  // ─────────────────────────────────────────────────────────────────────────

  async listMine(userId: string): Promise<CustomerRentalResponseDto[]> {
    const rows = await this.rentals.find({
      where: { userId },
      relations: ['product'],
      order: { activatedAt: 'DESC' },
    });
    return rows.map((r) => this.toCustomerDto(r));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // T30 — listAdmin
  // ─────────────────────────────────────────────────────────────────────────

  async listAdmin(
    filters: ListAdminFilters,
  ): Promise<{ items: AdminRentalResponseDto[]; total: number }> {
    const {
      status,
      userId,
      productId,
      page = 1,
      pageSize = DEFAULT_PAGE_SIZE,
    } = filters;

    const qb = this.rentals
      .createQueryBuilder('rental')
      .leftJoinAndSelect('rental.user', 'user')
      .leftJoinAndSelect('rental.product', 'product')
      .orderBy('rental.createdAt', 'DESC');

    if (status && status.length > 0) {
      qb.andWhere('rental.status IN (:...statuses)', { statuses: status });
    }

    if (userId) {
      qb.andWhere('rental.userId = :userId', { userId });
    }

    if (productId) {
      qb.andWhere('rental.productId = :productId', { productId });
    }

    const skip = (page - 1) * pageSize;
    qb.skip(skip).take(pageSize);

    const [rows, total] = await qb.getManyAndCount();
    return {
      items: rows.map((r) => this.toAdminDto(r)),
      total,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // T32 — listDelinquent
  //
  // Returns:
  //   (status IN past_due/unpaid AND currentPeriodEnd < NOW)
  //   OR
  //   (status = pending_setup AND createdAt < NOW - 24h)
  // ─────────────────────────────────────────────────────────────────────────

  async listDelinquent(): Promise<AdminRentalResponseDto[]> {
    const now = new Date();
    const cutoff24h = new Date(now.getTime() - 24 * 3600 * 1000);

    const qb = this.rentals
      .createQueryBuilder('rental')
      .leftJoinAndSelect('rental.user', 'user')
      .leftJoinAndSelect('rental.product', 'product')
      .where(
        '(rental.status IN (:...delinquentStatuses) AND rental.currentPeriodEnd < :now) OR (rental.status = :pendingSetup AND rental.createdAt < :cutoff24h)',
        {
          delinquentStatuses: [RentalStatus.PAST_DUE, RentalStatus.UNPAID],
          now,
          pendingSetup: RentalStatus.PENDING_SETUP,
          cutoff24h,
        },
      )
      .orderBy('rental.createdAt', 'ASC');

    const rows = await qb.getMany();
    return rows.map((r) => this.toAdminDto(r));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // T34, T36, T38, T40 — chargeLateFee
  //
  // ADR-8: off-session PaymentIntent for lateFeeCents.
  // Day-keyed idempotency: late-fee-{rentalId}-{YYYY-MM-DD}
  // alsoCancel=true → call cancelAdmin after PI success.
  // ─────────────────────────────────────────────────────────────────────────

  async chargeLateFee(
    rentalId: string,
    alsoCancel: boolean,
  ): Promise<ChargeLateFeeResponseDto> {
    // Load rental
    const rental = await this.rentals.findOne({ where: { id: rentalId } });
    if (!rental) {
      throw new NotFoundException(`Rental ${rentalId} not found`);
    }

    // T38: pre-check — lateFeeCents must be > 0
    if (rental.lateFeeCents === 0) {
      throw new HttpException(
        'LATE_FEE_NOT_CONFIGURED',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    // Load user for stripeCustomerId
    const user = await this.users.findOne({ where: { id: rental.userId } });
    if (!user?.stripeCustomerId) {
      throw new HttpException('NO_PAYMENT_METHOD', HttpStatus.BAD_REQUEST);
    }

    const stripe = this.requireStripe();

    // Day-keyed idempotency: one late-fee charge per rental per day
    const dayKey = new Date().toISOString().slice(0, 10);
    const idempotencyKey = `late-fee-${rentalId}-${dayKey}`;

    let pi: { id: string };

    try {
      pi = await stripe.paymentIntents.create(
        {
          customer: user.stripeCustomerId,
          amount: rental.lateFeeCents,
          currency: 'usd',
          off_session: true,
          confirm: true,
          metadata: {
            kind: 'rental_late_fee',
            rentalId,
            userId: rental.userId,
          },
        },
        { idempotencyKey },
      );
    } catch (err) {
      // T40: Stripe PI failure → 502 STRIPE_PAYMENT_FAILED
      this.logger.error(
        `chargeLateFee: PaymentIntent failed for rental ${rentalId}: ${(err as Error).message}`,
      );
      throw new HttpException('STRIPE_PAYMENT_FAILED', HttpStatus.BAD_GATEWAY);
    }

    // T5.6: Update lastLateFeeAt on Stripe success for cron idempotency.
    // Order of operations: charge Stripe FIRST, then persist the timestamp.
    // Using the same day-key as the idempotency key (UTC date).
    rental.lastLateFeeAt = new Date();
    await this.rentals.save(rental);

    // T36: alsoCancel=true → cancel Stripe sub + mark DB canceled
    if (alsoCancel) {
      await this.cancelAdmin(rentalId);
    }

    const response = new ChargeLateFeeResponseDto();
    response.chargedCents = rental.lateFeeCents;
    response.paymentIntentId = pi.id;
    response.subscriptionCanceled = alsoCancel;
    return response;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // chargeTheftFee
  //
  // One-time off-session PaymentIntent for the theft/replacement fee charged
  // when a subscriber stops paying and keeps (steals) the unit. Unlike the
  // late fee (recurring, day-keyed), this is charged AT MOST ONCE — guarded by
  // theftFeeChargedAt and a stable idempotency key (theft-fee-{rentalId}).
  // alsoCancel=true → cancel the rental after a successful charge.
  // ─────────────────────────────────────────────────────────────────────────

  async chargeTheftFee(
    rentalId: string,
    alsoCancel: boolean,
  ): Promise<ChargeTheftFeeResponseDto> {
    const rental = await this.rentals.findOne({ where: { id: rentalId } });
    if (!rental) {
      throw new NotFoundException(`Rental ${rentalId} not found`);
    }

    // Pre-check — theftFeeCents must be configured.
    if (rental.theftFeeCents === 0) {
      throw new HttpException(
        'THEFT_FEE_NOT_CONFIGURED',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    // Guard — a theft fee is charged at most once.
    if (rental.theftFeeChargedAt) {
      throw new ConflictException('THEFT_FEE_ALREADY_CHARGED');
    }

    const user = await this.users.findOne({ where: { id: rental.userId } });
    if (!user?.stripeCustomerId) {
      throw new HttpException('NO_PAYMENT_METHOD', HttpStatus.BAD_REQUEST);
    }

    const stripe = this.requireStripe();

    let pi: { id: string };
    try {
      pi = await stripe.paymentIntents.create(
        {
          customer: user.stripeCustomerId,
          amount: rental.theftFeeCents,
          currency: 'usd',
          off_session: true,
          confirm: true,
          metadata: {
            kind: 'rental_theft_fee',
            rentalId,
            userId: rental.userId,
          },
        },
        { idempotencyKey: `theft-fee-${rentalId}` },
      );
    } catch (err) {
      this.logger.error(
        `chargeTheftFee: PaymentIntent failed for rental ${rentalId}: ${(err as Error).message}`,
      );
      throw new HttpException('STRIPE_PAYMENT_FAILED', HttpStatus.BAD_GATEWAY);
    }

    // Stamp the one-time charge AFTER Stripe success so a failed charge can be
    // retried; a succeeded one can never be charged again.
    rental.theftFeeChargedAt = new Date();
    await this.rentals.save(rental);

    if (alsoCancel) {
      await this.cancelAdmin(rentalId);
    }

    const response = new ChargeTheftFeeResponseDto();
    response.chargedCents = rental.theftFeeCents;
    response.paymentIntentId = pi.id;
    response.subscriptionCanceled = alsoCancel;
    return response;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // T42, T44 — cancelAdmin
  //
  // Cancels a rental via Stripe + DB update.
  // Idempotent: already-canceled returns as-is without Stripe call.
  // pending_setup with no stripeSubscriptionId: just mark canceled (no Stripe).
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Mark all pending_setup rentals tied to `orderId` as CANCELED.
   *
   * Used by OrdersService when an order is cancelled — the rental rows were
   * created at order placement but no Stripe Subscription exists yet (those
   * are created on delivery), so we don't call Stripe. Active/past-due
   * rentals are NOT touched here — they belong to delivered orders, which
   * cannot be cancelled per ALLOWED_TRANSITIONS.
   */
  async cancelPendingForOrder(
    orderId: string,
    tx: EntityManager,
  ): Promise<number> {
    const rentalRepo = tx.getRepository(Rental);
    const pending = await rentalRepo.find({
      where: { orderId, status: RentalStatus.PENDING_SETUP },
    });
    if (pending.length === 0) return 0;
    const now = new Date();
    for (const r of pending) {
      r.status = RentalStatus.CANCELED;
      r.canceledAt = now;
      await rentalRepo.save(r);
    }
    this.logger.log(
      `cancelPendingForOrder: cancelled ${pending.length} rental(s) for order ${orderId}`,
    );
    return pending.length;
  }

  async cancelAdmin(rentalId: string): Promise<AdminRentalResponseDto> {
    const rental = await this.rentals.findOne({
      where: { id: rentalId },
      relations: ['user', 'product'],
    });
    if (!rental) {
      throw new NotFoundException(`Rental ${rentalId} not found`);
    }

    // T44: idempotency — already canceled, return as-is
    if (rental.status === RentalStatus.CANCELED) {
      return this.toAdminDto(rental);
    }

    // Cancel Stripe subscription if one exists
    if (rental.stripeSubscriptionId) {
      const stripe = this.requireStripe();
      await stripe.subscriptions.cancel(rental.stripeSubscriptionId, {
        invoice_now: false,
      });
    }

    // Update DB
    rental.status = RentalStatus.CANCELED;
    rental.canceledAt = new Date();
    const updated = await this.rentals.save(rental);

    return this.toAdminDto(updated);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // T46, T48 — retrySetup
  //
  // ADR-7: same idempotency key as original activation → Stripe dedupes if
  // the original call succeeded but DB write was lost.
  // Requires status='pending_setup' → 409 RENTAL_NOT_RETRYABLE otherwise.
  // Unlike activateForOrder, throws on Stripe failure (admin wants feedback).
  // ─────────────────────────────────────────────────────────────────────────

  async retrySetup(rentalId: string): Promise<AdminRentalResponseDto> {
    const rental = await this.rentals.findOne({
      where: { id: rentalId },
      relations: ['user', 'product'],
    });
    if (!rental) {
      throw new NotFoundException(`Rental ${rentalId} not found`);
    }

    // T48: pre-check — must be pending_setup
    if (rental.status !== RentalStatus.PENDING_SETUP) {
      throw new HttpException(
        {
          code: 'RENTAL_NOT_RETRYABLE',
          message: `El alquiler está en estado ${rental.status}; solo se puede reintentar desde pending_setup.`,
        },
        HttpStatus.CONFLICT,
      );
    }

    // Load user for stripeCustomerId
    const user = await this.users.findOne({ where: { id: rental.userId } });
    if (!user?.stripeCustomerId) {
      throw new HttpException('NO_PAYMENT_METHOD', HttpStatus.BAD_REQUEST);
    }

    try {
      const updated = await this.performActivation(rental, user);
      return this.toAdminDto(updated);
    } catch (err) {
      this.logger.error(
        `retrySetup: Stripe subscriptions.create failed for rental ${rentalId}: ${(err as Error).message}`,
      );
      throw new HttpException('STRIPE_PAYMENT_FAILED', HttpStatus.BAD_GATEWAY);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // T52, T54, T56 — handleWebhook
  //
  // Called by PaymentsController when metadata.rentalId is found on the
  // Stripe event. Routes to the appropriate handler based on event.type.
  //
  // Supported events:
  //   customer.subscription.updated → upsert Rental status + period dates
  //   customer.subscription.deleted → set Rental.status=canceled
  //   invoice.payment_succeeded     → refresh Rental period bounds
  // ─────────────────────────────────────────────────────────────────────────

  async handleWebhook(event: {
    type: string;
    data: { object: unknown };
  }): Promise<void> {
    switch (event.type) {
      case 'customer.subscription.updated':
        await this.handleSubscriptionUpdated(event.data.object);
        break;
      case 'customer.subscription.deleted':
        await this.handleSubscriptionDeleted(event.data.object);
        break;
      case 'invoice.payment_succeeded':
        await this.handleInvoicePaymentSucceeded(event.data.object);
        break;
      default:
        break;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // T52 — handleSubscriptionUpdated
  //
  // Upserts Rental status from Stripe subscription status.
  // Idempotent: keyed on stripeSubscriptionId.
  // ─────────────────────────────────────────────────────────────────────────

  private async handleSubscriptionUpdated(obj: unknown): Promise<void> {
    const sub = obj as {
      id: string;
      status: string;
      metadata?: Record<string, string | undefined>;
      current_period_start?: number;
      current_period_end?: number;
    };

    const rental = await this.rentals.findOne({
      where: { stripeSubscriptionId: sub.id },
    });
    if (!rental) {
      this.logger.warn(
        `handleSubscriptionUpdated: no rental found for sub ${sub.id}`,
      );
      return;
    }

    // Map Stripe status to rental status
    const newStatus = this.mapStripeStatus(sub.status);

    // Write-once: set pastDueSince ONLY on the FIRST transition into PAST_DUE.
    // Repeat past_due events must NOT overwrite the original timestamp (Day 0).
    if (newStatus === RentalStatus.PAST_DUE && rental.pastDueSince === null) {
      rental.pastDueSince = new Date();
    }

    rental.status = newStatus;
    if (sub.current_period_start != null) {
      rental.currentPeriodStart = new Date(sub.current_period_start * 1000);
    }
    if (sub.current_period_end != null) {
      rental.currentPeriodEnd = new Date(sub.current_period_end * 1000);
    }

    await this.rentals.save(rental);
    this.logger.log(
      `handleSubscriptionUpdated: rental ${rental.id} status=${rental.status}`,
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // T54 — handleSubscriptionDeleted
  //
  // Sets Rental.status='canceled' and canceledAt=NOW.
  // Idempotent: if already canceled, no-op.
  // ─────────────────────────────────────────────────────────────────────────

  private async handleSubscriptionDeleted(obj: unknown): Promise<void> {
    const sub = obj as {
      id: string;
      metadata?: Record<string, string | undefined>;
    };

    const rental = await this.rentals.findOne({
      where: { stripeSubscriptionId: sub.id },
    });
    if (!rental) {
      this.logger.warn(
        `handleSubscriptionDeleted: no rental found for sub ${sub.id}`,
      );
      return;
    }

    // Idempotent: already canceled
    if (rental.status === RentalStatus.CANCELED) {
      return;
    }

    rental.status = RentalStatus.CANCELED;
    rental.canceledAt = new Date();
    await this.rentals.save(rental);
    this.logger.log(`handleSubscriptionDeleted: rental ${rental.id} canceled`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // T56 — handleInvoicePaymentSucceeded
  //
  // Refreshes Rental.currentPeriodStart/End from the invoice's associated
  // subscription (fetched separately via the subscription object on the
  // invoice event).
  //
  // The subscription itself is already fetched by the controller. Here we
  // receive the invoice and update the period from the subscription's period
  // or from the invoice's period_start/period_end.
  // ─────────────────────────────────────────────────────────────────────────

  private async handleInvoicePaymentSucceeded(obj: unknown): Promise<void> {
    const invoice = obj as {
      subscription?: string | { id: string };
      period_start?: number;
      period_end?: number;
      lines?: { data?: Array<{ period?: { start?: number; end?: number } }> };
    };

    if (!invoice.subscription) return;

    const subId =
      typeof invoice.subscription === 'string'
        ? invoice.subscription
        : invoice.subscription.id;

    // Fetch the Stripe subscription to get the current period bounds
    // and find the matching rental
    const stripe = this.requireStripe();
    const sub = (await stripe.subscriptions.retrieve(subId)) as unknown as {
      id: string;
      current_period_start?: number;
      current_period_end?: number;
    };

    const rental = await this.rentals.findOne({
      where: { stripeSubscriptionId: subId },
    });
    if (!rental) {
      this.logger.warn(
        `handleInvoicePaymentSucceeded: no rental found for sub ${subId}`,
      );
      return;
    }

    if (sub.current_period_start != null) {
      rental.currentPeriodStart = new Date(sub.current_period_start * 1000);
    }
    if (sub.current_period_end != null) {
      rental.currentPeriodEnd = new Date(sub.current_period_end * 1000);
    }

    await this.rentals.save(rental);
    this.logger.log(
      `handleInvoicePaymentSucceeded: rental ${rental.id} period updated`,
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Helper: map Stripe subscription status → rental status
  // ─────────────────────────────────────────────────────────────────────────

  private mapStripeStatus(stripeStatus: string): RentalStatus {
    switch (stripeStatus) {
      case 'active':
      case 'trialing':
        return RentalStatus.ACTIVE;
      case 'past_due':
        return RentalStatus.PAST_DUE;
      case 'unpaid':
        return RentalStatus.UNPAID;
      case 'canceled':
        return RentalStatus.CANCELED;
      default:
        return RentalStatus.ACTIVE;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DTO mappers
  // ─────────────────────────────────────────────────────────────────────────

  private toCustomerDto(r: Rental): CustomerRentalResponseDto {
    const dto = new CustomerRentalResponseDto();
    dto.id = r.id;
    dto.productId = r.productId;
    dto.productName = r.product?.name ?? '';
    dto.productImageUrl = null; // image bytes served via separate endpoint
    dto.monthlyRentCents = r.monthlyRentCents;
    dto.status = r.status;
    dto.nextChargeAt = r.currentPeriodEnd;
    dto.activatedAt = r.activatedAt;
    dto.nextMaintenanceAt = r.nextMaintenanceAt;
    dto.lastMaintenanceAt = r.lastMaintenanceAt;
    return dto;
  }

  private toAdminDto(r: Rental): AdminRentalResponseDto {
    const dto = new AdminRentalResponseDto();
    dto.id = r.id;
    dto.orderId = r.orderId;
    dto.userId = r.userId;
    dto.userName = r.user?.fullName ?? '';
    dto.userPhone = r.user?.phone ?? null;
    dto.productId = r.productId;
    dto.productName = r.product?.name ?? '';
    dto.status = r.status;
    dto.monthlyRentCents = r.monthlyRentCents;
    dto.lateFeeCents = r.lateFeeCents;
    dto.theftFeeCents = r.theftFeeCents ?? 0;
    dto.theftFeeChargedAt = r.theftFeeChargedAt ?? null;
    dto.stripeSubscriptionId = r.stripeSubscriptionId;
    dto.currentPeriodEnd = r.currentPeriodEnd;
    dto.pastDueSince = r.pastDueSince;
    dto.lastLateFeeAt = r.lastLateFeeAt;
    dto.activatedAt = r.activatedAt;
    dto.canceledAt = r.canceledAt;
    dto.createdAt = r.createdAt;

    // daysDelinquent: computed from currentPeriodEnd
    if (
      r.currentPeriodEnd &&
      (r.status === RentalStatus.PAST_DUE || r.status === RentalStatus.UNPAID)
    ) {
      const msOverdue = Date.now() - r.currentPeriodEnd.getTime();
      dto.daysDelinquent = Math.max(0, Math.floor(msOverdue / 86400000));
    } else {
      dto.daysDelinquent = 0;
    }

    return dto;
  }
}
