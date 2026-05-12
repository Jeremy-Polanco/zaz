import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Stripe = require('stripe');
import { Subscription, SubscriptionModel, SubscriptionStatus } from '../../entities/subscription.entity';
import { User } from '../../entities/user.entity';
import { SubscriptionPlan } from '../../entities/subscription-plan.entity';
import { SubscriptionResponseDto } from './dto/subscription-response.dto';
import { PlanDto } from './dto/plan.dto';
import { AdminPlanResponseDto } from './dto/admin-plan-response.dto';
import { UpdateSubscriptionPlanDto } from './dto/update-subscription-plan.dto';
import { plainToInstance } from 'class-transformer';
import { DelinquentSubscriptionDto } from './dto/delinquent-subscription.dto';
import { ChargeLateFeeResponseDto } from './dto/charge-late-fee-response.dto';

type StripeClient = InstanceType<typeof Stripe>;

// Local shapes for Stripe event objects (avoids StripeConstructor namespace issues)
interface StripeEventLike {
  type: string;
  data: {
    object: unknown;
  };
}

interface StripeSessionObject {
  id: string;
  mode: string;
  subscription: string | { id: string } | null;
  customer: string | null;
  metadata: Record<string, string> | null;
}

interface StripeSubscriptionItemPeriod {
  current_period_start?: number;
  current_period_end?: number;
}

interface StripeSubscriptionObject {
  id: string;
  status: string;
  // Legacy API (pre-2025-04-30): period bounds live on the subscription itself
  current_period_start?: number;
  current_period_end?: number;
  // Newer API (2025-04-30+): period bounds moved to items.data[0]
  items?: { data?: StripeSubscriptionItemPeriod[] };
  cancel_at_period_end: boolean;
  canceled_at: number | null;
  metadata: Record<string, string>;
}

interface StripeInvoiceObject {
  id: string;
  subscription: string | { id: string } | null;
}

const SUBSCRIPTION_ALLOWLIST = [
  'https://app.zaz.com/subscription?session=success',
  'https://app.zaz.com/subscription?session=canceled',
  'zaz://subscription?success=1',
  'zaz://subscription?cancel=1',
];

@Injectable()
export class SubscriptionService implements OnModuleInit {
  private readonly logger = new Logger(SubscriptionService.name);
  private stripe: StripeClient | null = null;

  constructor(
    @InjectRepository(Subscription)
    private readonly subscriptions: Repository<Subscription>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(SubscriptionPlan)
    private readonly plans: Repository<SubscriptionPlan>,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const secret = this.config.get<string>('STRIPE_SECRET_KEY');
    if (!secret) {
      this.logger.warn('STRIPE_SECRET_KEY missing — subscriptions disabled');
      return;
    }
    this.stripe = new Stripe(secret);
    const envPriceId = this.config.get<string>('STRIPE_SUBSCRIPTION_PRICE_ID') ?? '';

    // Bootstrap seed: only seed if no row exists yet
    const existing = await this.plans.findOne({ where: {} });
    if (existing) {
      this.logger.log('subscription_plan already seeded — skipping bootstrap');
      return;
    }

    if (!envPriceId) {
      this.logger.warn(
        'STRIPE_SUBSCRIPTION_PRICE_ID missing and subscription_plan empty — plan unconfigured',
      );
      return;
    }

    try {
      const price = await this.stripe.prices.retrieve(envPriceId);
      const productId =
        typeof price.product === 'string' ? price.product : (price.product as { id: string }).id;

      const plan = this.plans.create({
        stripeProductId: productId,
        activeStripePriceId: price.id,
        unitAmountCents: price.unit_amount ?? 0,
        currency: price.currency ?? 'usd',
        interval: price.recurring?.interval ?? 'month',
      });
      await this.plans.save(plan);
      this.logger.log('subscription_plan seeded from env STRIPE_SUBSCRIPTION_PRICE_ID');
    } catch (e) {
      this.logger.error(
        `bootstrap seed failed at prices.retrieve(${envPriceId}) — leaving subscription_plan empty; will retry on next boot: ${(e as Error).message}`,
      );
    }
  }

  isEnabled(): boolean {
    return this.stripe !== null;
  }

  // ---------------------------------------------------------------------------
  // Public API surface
  // ---------------------------------------------------------------------------

  async createCheckoutSession(
    userId: string,
    successUrl: string,
    cancelUrl: string,
  ): Promise<{ url: string }> {
    const stripe = this.requireStripe();

    // Validate redirect URLs against allowlist
    if (!SUBSCRIPTION_ALLOWLIST.includes(successUrl)) {
      throw new HttpException(
        { statusCode: 400, code: 'SUBSCRIPTION_INVALID_REDIRECT', message: 'success_url no permitida' },
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!SUBSCRIPTION_ALLOWLIST.includes(cancelUrl)) {
      throw new HttpException(
        { statusCode: 400, code: 'SUBSCRIPTION_INVALID_REDIRECT', message: 'cancel_url no permitida' },
        HttpStatus.BAD_REQUEST,
      );
    }

    // Guard: 409 if already active subscriber
    const isActive = await this.isActiveSubscriber(userId);
    if (isActive) {
      throw new ConflictException({
        statusCode: HttpStatus.CONFLICT,
        code: 'SUBSCRIPTION_ALREADY_ACTIVE',
        message: 'Ya tenés una suscripción activa',
      });
    }

    const customerId = await this.getOrCreateStripeCustomer(userId);
    const activePlan = await this.getActivePlanRow();

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: activePlan.activeStripePriceId, quantity: 1 }],
      metadata: { userId },
      success_url: successUrl,
      cancel_url: cancelUrl,
    });

    return { url: session.url! };
  }

  async createPortalSession(userId: string): Promise<{ url: string }> {
    const stripe = this.requireStripe();
    const customerId = await this.getOrCreateStripeCustomer(userId);
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: 'https://app.zaz.com/subscription',
    });
    return { url: session.url };
  }

  async cancelAtPeriodEnd(userId: string): Promise<void> {
    const stripe = this.requireStripe();
    const sub = await this.subscriptions.findOne({ where: { userId } });
    if (!sub) {
      throw new NotFoundException({
        statusCode: 404,
        code: 'SUBSCRIPTION_NOT_FOUND',
        message: 'No tenés una suscripción activa',
      });
    }
    await stripe.subscriptions.update(sub.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });
    // DB write will come via webhook
  }

  async reactivate(userId: string): Promise<void> {
    const stripe = this.requireStripe();
    const sub = await this.subscriptions.findOne({ where: { userId } });
    if (!sub) {
      throw new NotFoundException({
        statusCode: 404,
        code: 'SUBSCRIPTION_NOT_FOUND',
        message: 'No tenés una suscripción activa',
      });
    }
    if (sub.status === SubscriptionStatus.CANCELED) {
      throw new HttpException(
        {
          statusCode: 400,
          code: 'SUBSCRIPTION_CANNOT_REACTIVATE',
          message: 'La suscripción está cancelada. Creá una nueva.',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    if (sub.status === SubscriptionStatus.PAST_DUE) {
      throw new HttpException(
        {
          statusCode: 400,
          code: 'SUBSCRIPTION_PAST_DUE',
          message: 'Tenés un pago pendiente. Actualizá tu medio de pago en el portal.',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    await stripe.subscriptions.update(sub.stripeSubscriptionId, {
      cancel_at_period_end: false,
    });
    // DB write will come via webhook
  }

  async getMySubscription(userId: string): Promise<SubscriptionResponseDto | null> {
    const sub = await this.subscriptions.findOne({ where: { userId } });
    if (!sub) return null;
    return plainToInstance(SubscriptionResponseDto, sub, { excludeExtraneousValues: true });
  }

  async getPlan(): Promise<PlanDto | null> {
    const plan = await this.plans.findOne({ where: {} });
    if (!plan) return null;
    return {
      priceCents: plan.unitAmountCents,
      currency: plan.currency as 'usd',
      interval: plan.interval as 'month',
    };
  }

  /**
   * Partial plan update. Accepts any subset of {unitAmountCents, purchasePriceCents, lateFeeCents}.
   *
   * - If unitAmountCents is provided: performs 4-step Stripe Price rotation.
   * - If purchasePriceCents or lateFeeCents are provided (without unitAmountCents): DB-only update.
   * - Empty body: throws 400.
   *
   * Backwards compatible: existing callers passing { unitAmountCents } continue to work.
   */
  async updatePlan(dto: UpdateSubscriptionPlanDto): Promise<AdminPlanResponseDto> {
    const { unitAmountCents, purchasePriceCents, lateFeeCents } = dto;

    // Reject empty body
    if (unitAmountCents === undefined && purchasePriceCents === undefined && lateFeeCents === undefined) {
      throw new HttpException(
        {
          statusCode: 400,
          code: 'SUBSCRIPTION_PLAN_NO_FIELDS',
          message: 'At least one field must be provided',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    // Step 0: load current plan (must exist) — throws 503 if not configured
    const plan = await this.getActivePlanRow();

    if (unitAmountCents !== undefined) {
      const stripe = this.requireStripe();
      const oldPriceId = plan.activeStripePriceId;

      // Step 1: create new Stripe Price
      let newPrice: { id: string };
      try {
        newPrice = await stripe.prices.create(
          {
            unit_amount: unitAmountCents,
            currency: plan.currency,
            recurring: { interval: plan.interval as 'month' },
            product: plan.stripeProductId,
          },
          { idempotencyKey: `plan-price:${plan.id}:${unitAmountCents}:${Date.now()}` },
        );
      } catch (e) {
        this.logger.error(
          `updatePlan: stripe.prices.create failed: ${(e as Error).message}`,
        );
        throw new HttpException(
          {
            statusCode: 502,
            code: 'SUBSCRIPTION_STRIPE_PRICE_CREATE_FAILED',
            message: 'Stripe price creation failed',
          },
          HttpStatus.BAD_GATEWAY,
        );
      }

      // Step 2: set new Price as Product default_price
      try {
        await stripe.products.update(plan.stripeProductId, { default_price: newPrice.id });
      } catch (e) {
        this.logger.error(
          `updatePlan: stripe.products.update failed (orphaned new price ${newPrice.id}): ${(e as Error).message}`,
        );
        throw new HttpException(
          {
            statusCode: 502,
            code: 'SUBSCRIPTION_STRIPE_PRODUCT_UPDATE_FAILED',
            message: 'Stripe product update failed',
            orphanPriceId: newPrice.id,
          },
          HttpStatus.BAD_GATEWAY,
        );
      }

      // Step 3: archive old Price (NON-BLOCKING — log warn but continue)
      try {
        await stripe.prices.update(oldPriceId, { active: false });
      } catch (e) {
        this.logger.warn(
          `updatePlan: archive of old price ${oldPriceId} failed (non-blocking): ${(e as Error).message}`,
        );
        // proceed
      }

      plan.activeStripePriceId = newPrice.id;
      plan.unitAmountCents = unitAmountCents;
    }

    // DB-only fields (no Stripe call)
    if (purchasePriceCents !== undefined) {
      plan.purchasePriceCents = purchasePriceCents;
    }
    if (lateFeeCents !== undefined) {
      plan.lateFeeCents = lateFeeCents;
    }

    // Persist DB update
    const newPriceId = plan.activeStripePriceId;
    try {
      await this.plans.save(plan);
    } catch (e) {
      this.logger.error(
        `updatePlan: DB save failed${unitAmountCents !== undefined ? ` after Stripe success (newPrice ${newPriceId} is the live default — operator should retry)` : ''}: ${(e as Error).message}`,
      );
      throw new HttpException(
        {
          statusCode: 500,
          code: 'SUBSCRIPTION_PLAN_DB_WRITE_FAILED',
          message: 'Stripe updated, DB persistence failed — safe to retry',
          newStripePriceId: newPriceId,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    return {
      id: plan.id,
      stripeProductId: plan.stripeProductId,
      activeStripePriceId: plan.activeStripePriceId,
      unitAmountCents: plan.unitAmountCents,
      purchasePriceCents: plan.purchasePriceCents,
      lateFeeCents: plan.lateFeeCents,
      currency: plan.currency,
      interval: plan.interval,
      updatedAt: plan.updatedAt,
    };
  }

  async getAdminPlan(): Promise<AdminPlanResponseDto> {
    return this.getActivePlanRow();
  }

  /**
   * Admin: get a user's current subscription (or null if none).
   * Also returns hasPaymentMethod to allow the web admin to disable activation buttons.
   */
  async getAdminUserSubscription(userId: string): Promise<{ subscription: SubscriptionResponseDto | null; hasPaymentMethod: boolean }> {
    const [sub, user] = await Promise.all([
      this.subscriptions.findOne({ where: { userId } }),
      this.users.findOne({ where: { id: userId }, select: ['id', 'stripeCustomerId'] }),
    ]);
    return {
      subscription: sub
        ? plainToInstance(SubscriptionResponseDto, sub, { excludeExtraneousValues: true })
        : null,
      hasPaymentMethod: !!(user?.stripeCustomerId),
    };
  }

  /**
   * Admin: activate a rental subscription for a user.
   *
   * Pre-checks (in order):
   *   1. Load user (404 USER_NOT_FOUND if missing)
   *   2. stripeCustomerId present (400 NO_PAYMENT_METHOD if missing)
   *   3. No active subscription (409 ALREADY_ACTIVE if found)
   *   4. Load active plan (503 SUBSCRIPTION_PLAN_NOT_CONFIGURED if missing)
   *   5. Call stripe.subscriptions.create → upsert DB row → return SubscriptionResponseDto
   */
  async activateAsRental(userId: string): Promise<SubscriptionResponseDto> {
    // Step 1: Load user
    const user = await this.users.findOne({
      where: { id: userId },
      select: ['id', 'stripeCustomerId', 'email', 'fullName'],
    });
    if (!user) {
      throw new NotFoundException({
        statusCode: 404,
        code: 'USER_NOT_FOUND',
        message: 'Usuario no encontrado',
      });
    }

    // Step 2: Require stripeCustomerId
    if (!user.stripeCustomerId) {
      throw new HttpException(
        {
          statusCode: 400,
          code: 'NO_PAYMENT_METHOD',
          message: 'Cliente no tiene método de pago en Stripe; debe completar al menos un cargo primero',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    // Step 3: Check for active subscription
    const existingSub = await this.subscriptions.findOne({ where: { userId } });
    if (existingSub && ['active', 'past_due', 'incomplete'].includes(existingSub.status)) {
      throw new HttpException(
        {
          statusCode: 409,
          code: 'ALREADY_ACTIVE',
          message: 'El usuario ya tiene una suscripción activa',
        },
        HttpStatus.CONFLICT,
      );
    }

    // Step 4: Load active plan
    const plan = await this.getActivePlanRow();

    // Step 5: Call Stripe
    const stripe = this.requireStripe();
    let stripeSub: StripeSubscriptionObject;
    try {
      const result = await stripe.subscriptions.create(
        {
          customer: user.stripeCustomerId,
          items: [{ price: plan.activeStripePriceId }],
          metadata: { userId },
          off_session: true,
        } as Parameters<StripeClient['subscriptions']['create']>[0],
        { idempotencyKey: `rental-${userId}-${Date.now()}` },
      );
      stripeSub = result as unknown as StripeSubscriptionObject;
    } catch (e) {
      this.logger.error(`activateAsRental: stripe.subscriptions.create failed: ${(e as Error).message}`);
      throw new HttpException(
        {
          statusCode: 502,
          code: 'STRIPE_RENTAL_FAILED',
          message: (e as Error).message,
        },
        HttpStatus.BAD_GATEWAY,
      );
    }

    // Write row immediately (webhook upsert is idempotent)
    await this.upsertSubscription(stripeSub);

    // Fetch written row and return
    const saved = await this.subscriptions.findOne({ where: { stripeSubscriptionId: stripeSub.id } });
    if (saved) {
      return plainToInstance(SubscriptionResponseDto, saved, { excludeExtraneousValues: true });
    }

    // Fallback: build from Stripe response directly (if upsert didn't persist userId due to missing metadata)
    const { start, end } = this.extractPeriodBounds(stripeSub);
    const synthetic: Partial<Subscription> = {
      stripeSubscriptionId: stripeSub.id,
      userId,
      status: this.normalizeStatus(stripeSub.status),
      model: SubscriptionModel.RENTAL,
      stripeChargeId: null,
      purchasedAt: null,
      currentPeriodStart: start ?? new Date(),
      currentPeriodEnd: end ?? new Date(),
      cancelAtPeriodEnd: stripeSub.cancel_at_period_end,
      canceledAt: null,
    };
    return plainToInstance(SubscriptionResponseDto, synthetic, { excludeExtraneousValues: true });
  }

  /**
   * Admin: activate a one-time purchase for a user.
   *
   * Pre-checks (in order):
   *   1. Load user (404 USER_NOT_FOUND if missing)
   *   2. stripeCustomerId present (400 NO_PAYMENT_METHOD if missing)
   *   3. Load plan; purchasePriceCents > 0 (503 PURCHASE_PRICE_NOT_CONFIGURED if 0)
   *   4. No active subscription (409 ALREADY_ACTIVE if found)
   *   5. Call stripe.paymentIntents.create → on success, INSERT row → return SubscriptionResponseDto
   *      On Stripe error → 502 STRIPE_PAYMENT_FAILED (no DB write)
   */
  async activateAsPurchase(userId: string): Promise<SubscriptionResponseDto> {
    // Step 1: Load user
    const user = await this.users.findOne({
      where: { id: userId },
      select: ['id', 'stripeCustomerId', 'email', 'fullName'],
    });
    if (!user) {
      throw new NotFoundException({
        statusCode: 404,
        code: 'USER_NOT_FOUND',
        message: 'Usuario no encontrado',
      });
    }

    // Step 2: Require stripeCustomerId
    if (!user.stripeCustomerId) {
      throw new HttpException(
        {
          statusCode: 400,
          code: 'NO_PAYMENT_METHOD',
          message: 'Cliente no tiene método de pago en Stripe; debe completar al menos un cargo primero',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    // Step 3: Load plan + check price configured
    const plan = await this.getActivePlanRow();
    if (plan.purchasePriceCents <= 0) {
      throw new HttpException(
        {
          statusCode: 503,
          code: 'PURCHASE_PRICE_NOT_CONFIGURED',
          message: 'El precio de compra del dispensador no está configurado',
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    // Step 4: Check for active subscription
    const existingSub = await this.subscriptions.findOne({ where: { userId } });
    if (existingSub && ['active', 'past_due', 'incomplete'].includes(existingSub.status)) {
      throw new HttpException(
        {
          statusCode: 409,
          code: 'ALREADY_ACTIVE',
          message: 'El usuario ya tiene una suscripción activa',
        },
        HttpStatus.CONFLICT,
      );
    }

    // Step 5: Stripe PaymentIntent
    const stripe = this.requireStripe();
    let pi: { id: string; status: string; amount: number };
    try {
      const result = await stripe.paymentIntents.create(
        {
          customer: user.stripeCustomerId,
          amount: plan.purchasePriceCents,
          currency: 'usd',
          off_session: true,
          confirm: true,
          metadata: { kind: 'dispenser_purchase', userId },
        },
        { idempotencyKey: `purchase-${userId}-${Date.now()}` },
      );
      pi = result as unknown as { id: string; status: string; amount: number };
    } catch (e) {
      this.logger.error(`activateAsPurchase: stripe.paymentIntents.create failed: ${(e as Error).message}`);
      throw new HttpException(
        {
          statusCode: 502,
          code: 'STRIPE_PAYMENT_FAILED',
          message: (e as Error).message,
        },
        HttpStatus.BAD_GATEWAY,
      );
    }

    if (pi.status !== 'succeeded') {
      throw new HttpException(
        {
          statusCode: 402,
          code: 'PURCHASE_REQUIRES_ACTION',
          message: 'El pago requiere acción del cliente',
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }

    // Insert subscription row
    const now = new Date();
    const sentinelEnd = new Date('9999-12-31T00:00:00Z');
    const saved = await this.subscriptions.save({
      userId,
      stripeSubscriptionId: `purchase:${pi.id}`,
      model: SubscriptionModel.PURCHASE,
      stripeChargeId: pi.id,
      purchasedAt: now,
      status: SubscriptionStatus.ACTIVE,
      currentPeriodStart: now,
      currentPeriodEnd: sentinelEnd,
      cancelAtPeriodEnd: false,
      canceledAt: null,
    });

    return plainToInstance(SubscriptionResponseDto, saved, { excludeExtraneousValues: true });
  }

  /**
   * Admin: returns delinquent rental subscriptions.
   *
   * Criteria: model='rental', status IN ('past_due','unpaid'), current_period_end < NOW().
   * Ordered by current_period_end ASC (oldest first = most delinquent).
   * Joins users table for name + phone. Computes daysDelinquent in JS.
   */
  async getDelinquentList(): Promise<DelinquentSubscriptionDto[]> {
    const plan = await this.getActivePlanRow();

    const rows = await this.subscriptions
      .createQueryBuilder('s')
      .select([
        's.id AS sub_id',
        's.user_id AS user_id',
        'u.full_name AS user_full_name',
        'u.phone AS user_phone',
        's.status AS sub_status',
        's.current_period_end AS sub_current_period_end',
      ])
      .innerJoin('users', 'u', 'u.id = s.user_id')
      .where("s.model = 'rental'")
      .andWhere("s.status IN ('past_due','unpaid')")
      .andWhere('s.current_period_end < NOW()')
      .orderBy('s.current_period_end', 'ASC')
      .getRawMany<{
        sub_id: string;
        user_id: string;
        user_full_name: string | null;
        user_phone: string | null;
        sub_status: string;
        sub_current_period_end: Date;
        plan_unit_amount_cents?: number;
      }>();

    const now = Date.now();
    return rows.map((row) => {
      const periodEnd = row.sub_current_period_end;
      const daysDelinquent = Math.floor((now - periodEnd.getTime()) / (1000 * 60 * 60 * 24));
      return {
        subscriptionId: row.sub_id,
        userId: row.user_id,
        userFullName: row.user_full_name ?? '',
        userPhone: row.user_phone ?? null,
        status: row.sub_status as 'past_due' | 'unpaid',
        currentPeriodEnd: periodEnd.toISOString(),
        daysDelinquent,
        unitAmountCents: row.plan_unit_amount_cents ?? plan.unitAmountCents,
      };
    });
  }

  /**
   * Admin: charge a late fee on a rental subscription.
   *
   * Steps:
   *   1. Load subscription (404 if missing)
   *   2. Require model='rental' (400 NOT_A_RENTAL if purchase)
   *   3. Load plan; require lateFeeCents > 0 (503 LATE_FEE_NOT_CONFIGURED if 0)
   *   4. Load user; require stripeCustomerId (400 NO_PAYMENT_METHOD if missing)
   *   5. Call stripe.paymentIntents.create with idempotencyKey
   *   6. On PI error → 502 STRIPE_PAYMENT_FAILED (no DB write)
   *   7. If alsoCancel=true → call cancelAdmin (on cancel failure, log warn, proceed)
   *   8. Return ChargeLateFeeResponseDto
   */
  async chargeLateFee(subscriptionId: string, alsoCancel: boolean): Promise<ChargeLateFeeResponseDto> {
    // Step 1: Load subscription
    const sub = await this.subscriptions.findOne({ where: { id: subscriptionId } });
    if (!sub) {
      throw new NotFoundException({
        statusCode: 404,
        code: 'SUBSCRIPTION_NOT_FOUND',
        message: 'Suscripción no encontrada',
      });
    }

    // Step 2: Require rental model
    if (sub.model !== SubscriptionModel.RENTAL) {
      throw new HttpException(
        {
          statusCode: 400,
          code: 'NOT_A_RENTAL',
          message: 'Esta operación solo aplica a suscripciones de alquiler',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    // Step 3: Load plan + check lateFeeCents configured
    const plan = await this.getActivePlanRow();
    if (plan.lateFeeCents <= 0) {
      throw new HttpException(
        {
          statusCode: 503,
          code: 'LATE_FEE_NOT_CONFIGURED',
          message: 'El cargo por mora no está configurado',
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    // Step 4: Load user + check stripeCustomerId
    const user = await this.users.findOne({
      where: { id: sub.userId },
      select: ['id', 'stripeCustomerId'],
    });
    if (!user?.stripeCustomerId) {
      throw new HttpException(
        {
          statusCode: 400,
          code: 'NO_PAYMENT_METHOD',
          message: 'El cliente no tiene método de pago en Stripe',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    // Step 5: Create PaymentIntent
    const stripe = this.requireStripe();
    let pi: { id: string; status: string; amount: number };
    try {
      const result = await stripe.paymentIntents.create(
        {
          customer: user.stripeCustomerId,
          amount: plan.lateFeeCents,
          currency: 'usd',
          off_session: true,
          confirm: true,
          metadata: { kind: 'late_fee', userId: sub.userId, subscriptionId },
        },
        { idempotencyKey: `late-fee-${subscriptionId}-${Date.now()}` },
      );
      pi = result as unknown as { id: string; status: string; amount: number };
    } catch (e) {
      this.logger.error(`chargeLateFee: stripe.paymentIntents.create failed: ${(e as Error).message}`);
      throw new HttpException(
        {
          statusCode: 502,
          code: 'STRIPE_PAYMENT_FAILED',
          message: (e as Error).message,
        },
        HttpStatus.BAD_GATEWAY,
      );
    }

    // Step 6: Handle alsoCancel
    let subscriptionCanceled = false;
    if (alsoCancel) {
      try {
        await this.cancelAdmin(subscriptionId);
        subscriptionCanceled = true;
      } catch (e) {
        this.logger.warn(
          `chargeLateFee: cancelAdmin failed after successful charge (subscriptionId=${subscriptionId}): ${(e as Error).message}. Charge was NOT rolled back — cancel manually.`,
        );
      }
    }

    return {
      chargedCents: pi.amount,
      paymentIntentId: pi.id,
      subscriptionCanceled,
    };
  }

  /**
   * Admin: cancel a rental subscription immediately.
   *
   * Steps:
   *   1. Load subscription (404 if missing)
   *   2. Require model='rental' (400 NOT_A_RENTAL if purchase)
   *   3. If already canceled → return as-is (idempotent)
   *   4. Call stripe.subscriptions.cancel(stripeSubscriptionId, { invoice_now: false })
   *   5. Update local row: status='canceled', canceledAt=NOW()
   *   6. Return updated SubscriptionResponseDto
   */
  async cancelAdmin(subscriptionId: string): Promise<SubscriptionResponseDto> {
    // Step 1: Load subscription
    const sub = await this.subscriptions.findOne({ where: { id: subscriptionId } });
    if (!sub) {
      throw new NotFoundException({
        statusCode: 404,
        code: 'SUBSCRIPTION_NOT_FOUND',
        message: 'Suscripción no encontrada',
      });
    }

    // Step 2: Require rental model
    if (sub.model !== SubscriptionModel.RENTAL) {
      throw new HttpException(
        {
          statusCode: 400,
          code: 'NOT_A_RENTAL',
          message: 'Esta operación solo aplica a suscripciones de alquiler',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    // Step 3: Idempotent — already canceled
    if (sub.status === SubscriptionStatus.CANCELED) {
      return plainToInstance(SubscriptionResponseDto, sub, { excludeExtraneousValues: true });
    }

    // Step 4: Cancel on Stripe
    const stripe = this.requireStripe();
    try {
      await stripe.subscriptions.cancel(sub.stripeSubscriptionId, { invoice_now: false });
    } catch (e) {
      this.logger.error(`cancelAdmin: stripe.subscriptions.cancel failed: ${(e as Error).message}`);
      throw new HttpException(
        {
          statusCode: 502,
          code: 'STRIPE_CANCEL_FAILED',
          message: (e as Error).message,
        },
        HttpStatus.BAD_GATEWAY,
      );
    }

    // Step 5: Update local DB
    const now = new Date();
    const updated = await this.subscriptions.save({
      ...sub,
      status: SubscriptionStatus.CANCELED,
      canceledAt: now,
      cancelAtPeriodEnd: false,
    });

    // Step 6: Return updated record
    return plainToInstance(SubscriptionResponseDto, updated, { excludeExtraneousValues: true });
  }

  /**
   * Single SQL query — NO Stripe call.
   * Returns true for status IN ('active','past_due') AND current_period_end > NOW()
   */
  async isActiveSubscriber(userId: string): Promise<boolean> {
    const result = await this.subscriptions
      .createQueryBuilder('s')
      .select('1')
      .where('s.user_id = :userId', { userId })
      .andWhere("s.status IN ('active','past_due')")
      .andWhere('s.current_period_end > NOW()')
      .limit(1)
      .getRawOne<{ '1': string }>();
    return result !== undefined;
  }

  /**
   * Webhook dispatcher — called by PaymentsController.webhook().
   * Errors are caught by the caller and logged; never propagated as 500.
   */
  async handleWebhook(event: StripeEventLike): Promise<void> {
    const stripe = this.requireStripe();

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as unknown as StripeSessionObject;
        if (session.mode !== 'subscription') return;
        if (!session.subscription) return;
        const subId =
          typeof session.subscription === 'string'
            ? session.subscription
            : (session.subscription as { id: string }).id;

        // If metadata.userId not on session, try to get it from the subscription
        if (!session.metadata?.userId) {
          this.logger.warn(`checkout.session ${session.id} has no metadata.userId — skipping`);
          return;
        }

        const stripeSubRaw = await stripe.subscriptions.retrieve(subId);
        const stripeSub = stripeSubRaw as unknown as StripeSubscriptionObject;
        // Carry userId from session metadata to subscription metadata if not present
        if (!stripeSub.metadata?.userId) {
          (stripeSub.metadata as Record<string, string>).userId = session.metadata.userId;
        }
        await this.upsertSubscription(stripeSub);
        // Persist stripe customer ID on the user if not yet saved
        await this.persistCustomerId(session.metadata.userId, session.customer as string);
        return;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object as unknown as StripeSubscriptionObject;
        await this.upsertSubscription(sub);
        return;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as unknown as StripeSubscriptionObject;
        // Force canceled status
        const canceledSub = { ...sub, status: 'canceled' };
        await this.upsertSubscription(canceledSub);
        return;
      }

      case 'invoice.payment_succeeded':
      case 'invoice.payment_failed': {
        const invoice = event.data.object as unknown as StripeInvoiceObject;
        if (!invoice.subscription) return;
        const subId =
          typeof invoice.subscription === 'string'
            ? invoice.subscription
            : (invoice.subscription as { id: string }).id;
        const stripeSubRaw2 = await stripe.subscriptions.retrieve(subId);
        await this.upsertSubscription(stripeSubRaw2 as unknown as StripeSubscriptionObject);
        return;
      }

      default:
        return;
    }
  }

  // ---------------------------------------------------------------------------
  // Stripe customer management
  // ---------------------------------------------------------------------------

  async getOrCreateStripeCustomer(userId: string): Promise<string> {
    const stripe = this.requireStripe();

    // Tier 1: DB already has the customer ID
    const user = await this.users.findOne({
      where: { id: userId },
      select: ['id', 'stripeCustomerId', 'email', 'fullName'],
    });
    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }
    if (user.stripeCustomerId) {
      return user.stripeCustomerId;
    }

    // Tier 2: search Stripe by metadata.userId (handles crash-mid-create recovery)
    const searchResult = await stripe.customers.search({
      query: `metadata['userId']:'${userId}'`,
      limit: 1,
    });
    if (searchResult.data.length > 0) {
      const existing = searchResult.data[0];
      await this.users.update(userId, { stripeCustomerId: existing.id });
      return existing.id;
    }

    // Tier 3: create new customer with idempotency key
    const customer = await stripe.customers.create(
      {
        email: user.email ?? undefined,
        name: user.fullName,
        metadata: { userId },
      },
      { idempotencyKey: `cust:${userId}` },
    );
    await this.users.update(userId, { stripeCustomerId: customer.id });
    return customer.id;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Loads the single subscription_plan row from the DB.
   * Throws 503 SUBSCRIPTION_PLAN_NOT_CONFIGURED if no row exists.
   * Used by createCheckoutSession, updatePlan, and getAdminPlan.
   */
  private async getActivePlanRow(): Promise<SubscriptionPlan> {
    const plan = await this.plans.findOne({ where: {} });
    if (!plan) {
      throw new ServiceUnavailableException({
        statusCode: 503,
        code: 'SUBSCRIPTION_PLAN_NOT_CONFIGURED',
        message: 'Subscription plan not configured',
      });
    }
    return plan;
  }

  private async persistCustomerId(userId: string, customerId: string): Promise<void> {
    if (!customerId) return;
    const user = await this.users.findOne({
      where: { id: userId },
      select: ['id', 'stripeCustomerId'],
    });
    if (user && !user.stripeCustomerId) {
      await this.users.update(userId, { stripeCustomerId: customerId });
    }
  }

  /**
   * Extracts period bounds from a Stripe Subscription object, handling both
   * legacy API (pre-2025-04-30, fields on subscription) and newer API
   * (2025-04-30+, fields moved to items.data[0]).
   */
  private extractPeriodBounds(
    stripeSub: StripeSubscriptionObject,
  ): { start: Date | null; end: Date | null } {
    const item = stripeSub.items?.data?.[0];
    const startUnix = stripeSub.current_period_start ?? item?.current_period_start;
    const endUnix = stripeSub.current_period_end ?? item?.current_period_end;
    return {
      start: typeof startUnix === 'number' ? new Date(startUnix * 1000) : null,
      end: typeof endUnix === 'number' ? new Date(endUnix * 1000) : null,
    };
  }

  private async upsertSubscription(stripeSub: StripeSubscriptionObject): Promise<void> {
    const userId = stripeSub.metadata?.userId;
    if (!userId) {
      this.logger.warn(`subscription ${stripeSub.id} has no metadata.userId — skipping upsert`);
      return;
    }

    const { start, end } = this.extractPeriodBounds(stripeSub);
    if (!start || !end) {
      this.logger.warn(
        `subscription ${stripeSub.id} missing current_period_start/end on both subscription and items[0] — check Stripe API version. Skipping upsert.`,
      );
      return;
    }

    // For canceled subscriptions, default canceled_at to NOW() if Stripe omits it
    const isCanceled = stripeSub.status === 'canceled';
    const canceledAt = stripeSub.canceled_at
      ? new Date(stripeSub.canceled_at * 1000)
      : isCanceled
        ? new Date()
        : null;

    await this.subscriptions.upsert(
      {
        userId,
        stripeSubscriptionId: stripeSub.id,
        status: this.normalizeStatus(stripeSub.status),
        currentPeriodStart: start,
        currentPeriodEnd: end,
        cancelAtPeriodEnd: stripeSub.cancel_at_period_end,
        canceledAt,
      },
      ['stripeSubscriptionId'],
    );
    this.logger.log(`upserted subscription ${stripeSub.id} for user ${userId} — status: ${stripeSub.status}`);
  }

  private normalizeStatus(stripeStatus: string): SubscriptionStatus {
    switch (stripeStatus) {
      case 'active':
        return SubscriptionStatus.ACTIVE;
      case 'past_due':
        return SubscriptionStatus.PAST_DUE;
      case 'canceled':
        return SubscriptionStatus.CANCELED;
      case 'unpaid':
        return SubscriptionStatus.UNPAID;
      case 'incomplete':
        return SubscriptionStatus.INCOMPLETE;
      case 'incomplete_expired':
        return SubscriptionStatus.INCOMPLETE_EXPIRED;
      default:
        // Forward-compat: unknown future statuses map to INCOMPLETE
        this.logger.warn(`Unknown Stripe subscription status: ${stripeStatus} — mapping to INCOMPLETE`);
        return SubscriptionStatus.INCOMPLETE;
    }
  }

  private requireStripe(): StripeClient {
    if (!this.stripe) {
      throw new ServiceUnavailableException({
        statusCode: 503,
        code: 'SUBSCRIPTION_STRIPE_DISABLED',
        message: 'Stripe no configurado en el servidor',
      });
    }
    return this.stripe;
  }
}
