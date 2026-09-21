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
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import { SUBSCRIPTION_ACTIVATED } from '../../common/events/subscription.events';
import Stripe = require('stripe');
import {
  Subscription,
  SubscriptionStatus,
} from '../../entities/subscription.entity';
import { User } from '../../entities/user.entity';
import {
  SubscriptionPlan,
  SubscriptionTier,
} from '../../entities/subscription-plan.entity';
import {
  extractStripeProductId,
  resolveTierFromStripeProduct,
} from './tier-resolution';
import { SubscriptionResponseDto } from './dto/subscription-response.dto';
import { PlanDto } from './dto/plan.dto';
import { AdminPlanResponseDto } from './dto/admin-plan-response.dto';
import { plainToInstance } from 'class-transformer';
import { assertStripeProductionConfig } from '../../common/stripe/stripe-runtime-guard';
import { computeGrossCents } from '../../common/tax';

type StripeClient = InstanceType<typeof Stripe>;

/** Resumen de una corrida de `reconcileWithStripe`. */
export interface SubscriptionReconcileResult {
  scanned: number;
  upserted: number;
  skipped: number;
  purged: number;
  failed: number;
}

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
  customer?: string | { id: string } | null;
  // Legacy API (pre-2025-04-30): period bounds live on the subscription itself
  current_period_start?: number;
  current_period_end?: number;
  // Newer API (2025-04-30+): period bounds moved to items.data[0]
  items?: { data?: StripeSubscriptionItemPeriod[] };
  cancel_at_period_end: boolean;
  canceled_at: number | null;
  metadata: Record<string, string>;
}

interface StripeCustomerObject {
  id: string;
  deleted?: boolean;
  email?: string | null;
  phone?: string | null;
  metadata?: Record<string, string> | null;
}

interface StripeInvoiceObject {
  id: string;
  subscription: string | { id: string } | null;
}

/** Teléfono como lo guarda auth: E.164, solo dígitos con "+" adelante. */
function normalizeE164(raw: string | null | undefined): string | null {
  const digits = (raw ?? '').replace(/\D/g, '');
  return digits ? `+${digits}` : null;
}

/** `luis@x.com` → `l***@x.com`; sin email → `-`. */
function maskEmail(raw: string | null | undefined): string {
  const email = (raw ?? '').trim();
  const at = email.indexOf('@');
  if (at < 1) return email ? '***' : '-';
  return `${email[0]}***${email.slice(at)}`;
}

/** `+16462456579` → `***6579`; sin teléfono → `-`. */
function maskPhone(e164: string | null): string {
  return e164 ? `***${e164.slice(-4)}` : '-';
}

const SUBSCRIPTION_ALLOWLIST = [
  'https://www.dashgo.dev/subscription?session=success',
  'https://www.dashgo.dev/subscription?session=canceled',
  'dashgo://subscription?success=1',
  'dashgo://subscription?cancel=1',
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
    private readonly events: EventEmitter2,
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
      this.logger.warn('STRIPE_SECRET_KEY missing — subscriptions disabled');
      return;
    }
    this.stripe = new Stripe(secret);
    const envPriceId =
      this.config.get<string>('STRIPE_SUBSCRIPTION_PRICE_ID') ?? '';

    // Bootstrap seed: only seed if no row exists yet
    const existing = await this.plans.findOne({
      where: { tier: SubscriptionTier.STANDARD },
    });
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
        typeof price.product === 'string'
          ? price.product
          : (price.product as { id: string }).id;

      const plan = this.plans.create({
        tier: SubscriptionTier.STANDARD,
        stripeProductId: productId,
        activeStripePriceId: price.id,
        unitAmountCents: price.unit_amount ?? 0,
        currency: price.currency ?? 'usd',
        interval: price.recurring?.interval ?? 'month',
      });
      await this.plans.save(plan);
      this.logger.log(
        'subscription_plan seeded from env STRIPE_SUBSCRIPTION_PRICE_ID',
      );
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
    tier: SubscriptionTier = SubscriptionTier.STANDARD,
  ): Promise<{ url: string }> {
    const stripe = this.requireStripe();

    // Validate redirect URLs against allowlist
    if (!SUBSCRIPTION_ALLOWLIST.includes(successUrl)) {
      throw new HttpException(
        {
          statusCode: 400,
          code: 'SUBSCRIPTION_INVALID_REDIRECT',
          message: 'success_url no permitida',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!SUBSCRIPTION_ALLOWLIST.includes(cancelUrl)) {
      throw new HttpException(
        {
          statusCode: 400,
          code: 'SUBSCRIPTION_INVALID_REDIRECT',
          message: 'cancel_url no permitida',
        },
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
    const activePlan = await this.getActivePlanRow(tier);

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: activePlan.activeStripePriceId, quantity: 1 }],
      // En la sesión Y en la suscripción. Stripe NO copia el metadata de la
      // sesión a la suscripción: sin `subscription_data` cada webhook
      // posterior (renovación, cancelación, past_due) llegaba sin userId y se
      // descartaba — `current_period_end` quedaba congelado en el primer mes y
      // el suscriptor perdía todos los beneficios a los 30 días.
      metadata: { userId },
      subscription_data: { metadata: { userId } },
      success_url: successUrl,
      cancel_url: cancelUrl,
    });

    return { url: session.url };
  }

  async createPortalSession(userId: string): Promise<{ url: string }> {
    const stripe = this.requireStripe();
    const customerId = await this.getOrCreateStripeCustomer(userId);
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: 'https://www.dashgo.dev/subscription',
    });
    return { url: session.url };
  }

  async cancelAtPeriodEnd(userId: string): Promise<void> {
    const stripe = this.requireStripe();
    const sub = await this.subscriptions.findOne({
      where: { userId },
      order: { currentPeriodEnd: 'DESC' },
    });
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
    const sub = await this.subscriptions.findOne({
      where: { userId },
      order: { currentPeriodEnd: 'DESC' },
    });
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
          message:
            'Tenés un pago pendiente. Actualizá tu medio de pago en el portal.',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    await stripe.subscriptions.update(sub.stripeSubscriptionId, {
      cancel_at_period_end: false,
    });
    // DB write will come via webhook
  }

  async getMySubscription(
    userId: string,
  ): Promise<SubscriptionResponseDto | null> {
    const sub = await this.subscriptions.findOne({
      where: { userId },
      order: { currentPeriodEnd: 'DESC' },
    });
    if (!sub) return null;
    return plainToInstance(SubscriptionResponseDto, sub, {
      excludeExtraneousValues: true,
    });
  }

  async getPlan(
    tier: SubscriptionTier = SubscriptionTier.STANDARD,
  ): Promise<PlanDto | null> {
    const plan = await this.plans.findOne({ where: { tier } });
    if (!plan) return null;
    return {
      tier: plan.tier,
      // Gross (tax-inclusive) — what the customer is actually charged. The DB
      // stores the net amount; tax (8.887%) is applied here at display time.
      priceCents: computeGrossCents(plan.unitAmountCents),
      currency: plan.currency as 'usd',
      interval: plan.interval as 'month',
    };
  }

  /**
   * Net monthly subscription price in cents (pre-tax), or null when no plan is
   * configured. This is the price an additional bebedero rents at for an active
   * subscriber — see resolveBebederoRentCents (products/pricing.ts). Net (not
   * gross) keeps it consistent with how bebedero rent is taxed at order time.
   */
  async getPlanNetCents(
    tier: SubscriptionTier = SubscriptionTier.STANDARD,
  ): Promise<number | null> {
    const plan = await this.plans.findOne({ where: { tier } });
    return plan ? plan.unitAmountCents : null;
  }

  /**
   * Admin: update the monthly subscription price.
   *
   * 4-step Stripe Price rotation:
   *   1. Create new Stripe Price
   *   2. Set new Price as Product default_price
   *   3. Archive old Price (NON-BLOCKING — log warn but continue)
   *   4. Persist DB update
   */
  async updatePlan(
    unitAmountCents: number,
    tier: SubscriptionTier = SubscriptionTier.STANDARD,
  ): Promise<AdminPlanResponseDto> {
    const plan = await this.getActivePlanRow(tier);
    const stripe = this.requireStripe();
    const oldPriceId = plan.activeStripePriceId;

    // Step 1: create new Stripe Price
    let newPrice: { id: string };
    try {
      newPrice = await stripe.prices.create(
        {
          // Charge gross: the admin enters the net price; the customer pays
          // net + 8.887% tax. The net stays the editable source of truth in DB.
          unit_amount: computeGrossCents(unitAmountCents),
          currency: plan.currency,
          recurring: { interval: plan.interval as 'month' },
          product: plan.stripeProductId,
        },
        {
          idempotencyKey: `plan-price:${plan.id}:${unitAmountCents}:${Date.now()}`,
        },
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
      await stripe.products.update(plan.stripeProductId, {
        default_price: newPrice.id,
      });
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

    // Persist DB update
    try {
      await this.plans.save(plan);
    } catch (e) {
      this.logger.error(
        `updatePlan: DB save failed after Stripe success (newPrice ${newPrice.id} is the live default — operator should retry): ${(e as Error).message}`,
      );
      throw new HttpException(
        {
          statusCode: 500,
          code: 'SUBSCRIPTION_PLAN_DB_WRITE_FAILED',
          message: 'Stripe updated, DB persistence failed — safe to retry',
          newStripePriceId: newPrice.id,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    return this.toAdminPlanResponse(plan);
  }

  async getAdminPlan(
    tier: SubscriptionTier = SubscriptionTier.STANDARD,
  ): Promise<AdminPlanResponseDto> {
    return this.toAdminPlanResponse(await this.getActivePlanRow(tier));
  }

  /**
   * Planes disponibles para el cliente. Los precios que viajan son BRUTOS
   * (con impuesto) — es lo que la persona va a pagar.
   */
  async listPublicPlans(): Promise<PlanDto[]> {
    const rows = await this.plans.find({ order: { tier: 'ASC' } });
    return rows.map((plan) => ({
      tier: plan.tier,
      priceCents: computeGrossCents(plan.unitAmountCents),
      currency: plan.currency as 'usd',
      interval: plan.interval as 'month',
    }));
  }

  /** Todos los planes configurados, para el panel. */
  async listAdminPlans(): Promise<AdminPlanResponseDto[]> {
    const rows = await this.plans.find({ order: { tier: 'ASC' } });
    return rows.map((r) => this.toAdminPlanResponse(r));
  }

  /**
   * Crea el plan de un tier que todavía no existe (el caso real: premium).
   *
   * Stripe-first, igual que `updatePlan`: si el producto o el precio fallan, no
   * queda una fila en la base apuntando a nada. El producto se crea con
   * idempotencyKey por tier para que un reintento no genere dos productos.
   */
  async createPlan(
    tier: SubscriptionTier,
    unitAmountCents: number,
  ): Promise<AdminPlanResponseDto> {
    const existing = await this.plans.findOne({ where: { tier } });
    if (existing) {
      throw new ConflictException({
        code: 'PLAN_ALREADY_EXISTS',
        message: `Ya existe un plan ${tier}. Editá su precio en vez de crearlo.`,
      });
    }
    const stripe = this.requireStripe();

    const product = await stripe.products.create(
      { name: `Suscripción ${tier}`, metadata: { tier } },
      { idempotencyKey: `subscription-plan:${tier}` },
    );
    const price = await stripe.prices.create(
      {
        // El admin carga el neto; el cliente paga neto + impuesto. El neto
        // queda como fuente de verdad editable en la base.
        unit_amount: computeGrossCents(unitAmountCents),
        currency: 'usd',
        recurring: { interval: 'month' },
        product: product.id,
      },
      { idempotencyKey: `subscription-plan-price:${tier}:${unitAmountCents}` },
    );
    await stripe.products.update(product.id, { default_price: price.id });

    const saved = await this.plans.save(
      this.plans.create({
        tier,
        stripeProductId: product.id,
        activeStripePriceId: price.id,
        unitAmountCents,
        currency: 'usd',
        interval: 'month',
      }),
    );
    this.logger.log(`plan ${tier} creado: ${product.id} / ${price.id}`);
    return this.toAdminPlanResponse(saved);
  }

  /**
   * Maps a plan row to the admin response, deriving the gross (tax-inclusive)
   * amount so the admin can see what the customer is actually charged.
   */
  private toAdminPlanResponse(plan: SubscriptionPlan): AdminPlanResponseDto {
    return {
      id: plan.id,
      tier: plan.tier,
      stripeProductId: plan.stripeProductId,
      activeStripePriceId: plan.activeStripePriceId,
      unitAmountCents: plan.unitAmountCents,
      grossAmountCents: computeGrossCents(plan.unitAmountCents),
      currency: plan.currency,
      interval: plan.interval,
      updatedAt: plan.updatedAt,
    };
  }

  /**
   * Tier de la suscripción ACTIVA de un usuario, o `null` si no tiene ninguna.
   *
   * `isActiveSubscriber` sigue existiendo y sigue significando "tiene alguna
   * suscripción activa" — no cambió para nadie. Este método es el que permite
   * que un beneficio decida si lo desbloquean todos los planes o solo premium.
   * Misma condición de vigencia, una sola query, sin llamar a Stripe.
   */
  async getActiveTier(userId: string): Promise<SubscriptionTier | null> {
    const row = await this.subscriptions
      .createQueryBuilder('s')
      .select('s.tier', 'tier')
      .where('s.user_id = :userId', { userId })
      .andWhere("s.status IN ('active','past_due')")
      .andWhere('s.current_period_end > NOW()')
      .limit(1)
      .getRawOne<{ tier: SubscriptionTier }>();
    return row?.tier ?? null;
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
   * User IDs of all currently-active subscribers (status IN ('active','past_due')
   * AND current_period_end > NOW()). Used to backfill the default bebedero for
   * subscribers who subscribed before one was configured. NO Stripe call.
   */
  async listActiveSubscriberUserIds(): Promise<string[]> {
    const rows = await this.subscriptions
      .createQueryBuilder('s')
      .select('s.user_id', 'userId')
      .where("s.status IN ('active','past_due')")
      .andWhere('s.current_period_end > NOW()')
      .getRawMany<{ userId: string }>();
    return rows.map((r) => r.userId);
  }

  /**
   * Webhook dispatcher — called by PaymentsController.webhook().
   * Errors are caught by the caller and logged; never propagated as 500.
   */
  async handleWebhook(event: StripeEventLike): Promise<void> {
    const stripe = this.requireStripe();

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as StripeSessionObject;
        if (session.mode !== 'subscription') return;
        if (!session.subscription) return;
        const subId =
          typeof session.subscription === 'string'
            ? session.subscription
            : session.subscription.id;

        // If metadata.userId not on session, try to get it from the subscription
        if (!session.metadata?.userId) {
          this.logger.warn(
            `checkout.session ${session.id} has no metadata.userId — skipping`,
          );
          return;
        }

        const stripeSubRaw = await stripe.subscriptions.retrieve(subId);
        const stripeSub = stripeSubRaw as unknown as StripeSubscriptionObject;
        // Carry userId from session metadata to subscription metadata if not present
        if (!stripeSub.metadata?.userId) {
          stripeSub.metadata.userId = session.metadata.userId;
        }
        await this.upsertSubscription(stripeSub);
        // Persist stripe customer ID on the user if not yet saved
        await this.persistCustomerId(session.metadata.userId, session.customer);
        return;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object as StripeSubscriptionObject;
        // Guard: rental subscriptions carry metadata.rentalId — they are handled
        // by RentalsService.handleWebhook and must NOT pollute the subscriptions table.
        if (sub.metadata?.rentalId) return;
        await this.upsertSubscription(sub);
        return;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as StripeSubscriptionObject;
        // Guard: rental subscriptions carry metadata.rentalId — skip SaaS upsert.
        if (sub.metadata?.rentalId) return;
        // Force canceled status
        const canceledSub = { ...sub, status: 'canceled' };
        await this.upsertSubscription(canceledSub);
        return;
      }

      case 'invoice.payment_succeeded':
      case 'invoice.payment_failed': {
        const invoice = event.data.object as StripeInvoiceObject;
        if (!invoice.subscription) return;
        const subId =
          typeof invoice.subscription === 'string'
            ? invoice.subscription
            : invoice.subscription.id;
        const stripeSubRaw2 = await stripe.subscriptions.retrieve(subId);
        await this.upsertSubscription(stripeSubRaw2);
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
  private async getActivePlanRow(
    tier: SubscriptionTier = SubscriptionTier.STANDARD,
  ): Promise<SubscriptionPlan> {
    const plan = await this.plans.findOne({ where: { tier } });
    if (!plan) {
      throw new ServiceUnavailableException({
        statusCode: 503,
        code: 'SUBSCRIPTION_PLAN_NOT_CONFIGURED',
        message: 'Subscription plan not configured',
      });
    }
    return plan;
  }

  private async persistCustomerId(
    userId: string,
    customerId: string,
  ): Promise<void> {
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
  private extractPeriodBounds(stripeSub: StripeSubscriptionObject): {
    start: Date | null;
    end: Date | null;
  } {
    const item = stripeSub.items?.data?.[0];
    const startUnix =
      stripeSub.current_period_start ?? item?.current_period_start;
    const endUnix = stripeSub.current_period_end ?? item?.current_period_end;
    return {
      start: typeof startUnix === 'number' ? new Date(startUnix * 1000) : null,
      end: typeof endUnix === 'number' ? new Date(endUnix * 1000) : null,
    };
  }

  /**
   * Converge la tabla `subscriptions` con la verdad de Stripe.
   *
   * La tabla solo se escribía por webhook. Cuando Stripe no nos entrega un
   * evento (endpoint deshabilitado, app archivada, evento sin metadata) la fila
   * queda congelada: `current_period_end` vence, `isActiveSubscriber` pasa a
   * false y el suscriptor pierde mantenimiento gratis, bebedero y precios sin
   * que la app se entere — la pantalla sigue diciendo "Activa". Así llegó el
   * "tiene suscripción y le está cobrando" del 2026-09-18.
   *
   * Lista TODAS las suscripciones (status 'all', para enterarnos también de
   * las canceladas) y las upsertea con las mismas reglas del webhook. Las de
   * alquiler (metadata.rentalId) viven en `rentals`: si alguna se coló acá, se
   * purga. Un error en una suscripción no aborta el resto.
   */
  async reconcileWithStripe(): Promise<SubscriptionReconcileResult> {
    const result: SubscriptionReconcileResult = {
      scanned: 0,
      upserted: 0,
      skipped: 0,
      purged: 0,
      failed: 0,
    };
    if (!this.stripe) {
      this.logger.warn('reconcileWithStripe: Stripe disabled — nothing to do');
      return result;
    }

    let startingAfter: string | undefined;
    do {
      const page = await this.stripe.subscriptions.list({
        status: 'all',
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
      for (const raw of page.data) {
        const sub = raw as unknown as StripeSubscriptionObject;
        result.scanned += 1;
        try {
          if (sub.metadata?.rentalId) {
            const purged = await this.subscriptions.delete({
              stripeSubscriptionId: sub.id,
            });
            const affected = purged?.affected ?? 0;
            if (affected > 0) {
              result.purged += affected;
              this.logger.warn(
                `reconcileWithStripe: purged rental subscription ${sub.id} (rental ${sub.metadata.rentalId}) from the plan table`,
              );
            }
            continue;
          }
          if (await this.upsertSubscription(sub)) result.upserted += 1;
          else result.skipped += 1;
        } catch (err) {
          result.failed += 1;
          this.logger.error(
            `reconcileWithStripe: subscription ${sub.id} failed: ${(err as Error).message}`,
          );
        }
      }
      const last = page.data[page.data.length - 1];
      startingAfter = page.has_more && last ? last.id : undefined;
    } while (startingAfter);

    this.logger.log(
      `reconciled subscriptions vs Stripe: ${JSON.stringify(result)}`,
    );
    return result;
  }

  /**
   * Escribe la fila de la suscripción. Devuelve true si escribió, false si la
   * descartó (alquiler, sin dueño resoluble, sin período).
   */
  private async upsertSubscription(
    stripeSub: StripeSubscriptionObject,
  ): Promise<boolean> {
    // Las suscripciones de ALQUILER se manejan en RentalsService y jamás
    // entran a esta tabla. Guard único para todos los caminos — el de
    // invoice.* no lo tenía y hubiera metido al inquilino como suscriptor.
    if (stripeSub.metadata?.rentalId) return false;

    const userId = await this.resolveUserId(stripeSub);
    if (!userId) {
      this.logger.warn(
        `subscription ${stripeSub.id} has no metadata.userId and no user matches its customer — skipping upsert`,
      );
      return false;
    }

    const { start, end } = this.extractPeriodBounds(stripeSub);
    if (!start || !end) {
      this.logger.warn(
        `subscription ${stripeSub.id} missing current_period_start/end on both subscription and items[0] — check Stripe API version. Skipping upsert.`,
      );
      return false;
    }

    // For canceled subscriptions, default canceled_at to NOW() if Stripe omits it
    const isCanceled = stripeSub.status === 'canceled';
    const canceledAt = stripeSub.canceled_at
      ? new Date(stripeSub.canceled_at * 1000)
      : isCanceled
        ? new Date()
        : null;

    const normalizedStatus = this.normalizeStatus(stripeSub.status);

    // Tier por PRODUCTO de Stripe, no por price id: los precios rotan cada vez
    // que el admin cambia el monto y el viejo sigue vivo para los ya suscriptos.
    const plans = await this.plans.find();
    const tier = resolveTierFromStripeProduct(
      extractStripeProductId(stripeSub as never),
      plans,
    );

    // Estado anterior, para emitir SUBSCRIPTION_ACTIVATED solo en la
    // transición a active: el reconcile horario re-upsertea todo y los
    // listeners de bebedero no tienen por qué correr N veces por hora.
    const previous = await this.subscriptions.findOne({
      where: { stripeSubscriptionId: stripeSub.id },
      select: ['id', 'status'],
    });

    await this.subscriptions.upsert(
      {
        userId,
        stripeSubscriptionId: stripeSub.id,
        status: normalizedStatus,
        tier,
        currentPeriodStart: start,
        currentPeriodEnd: end,
        cancelAtPeriodEnd: stripeSub.cancel_at_period_end,
        canceledAt,
      },
      ['stripeSubscriptionId'],
    );
    this.logger.log(
      `upserted subscription ${stripeSub.id} for user ${userId} — status: ${stripeSub.status}`,
    );

    // Auto-bebedero al activarse. El listener (OrdersModule) es idempotente
    // igual; event-driven para mantener el grafo de módulos acíclico
    // (OrdersModule ya depende de SubscriptionModule).
    if (
      normalizedStatus === SubscriptionStatus.ACTIVE &&
      previous?.status !== SubscriptionStatus.ACTIVE
    ) {
      this.events.emit(SUBSCRIPTION_ACTIVATED, { userId, tier });
    }
    return true;
  }

  /**
   * Dueño de una suscripción de Stripe. Primero `metadata.userId` (el checkout
   * lo escribe en la suscripción vía subscription_data desde 2026-09-18). Si
   * no viene — toda suscripción anterior a esa fecha, y las que el dueño crea
   * a mano en el Dashboard — se resuelve por `users.stripe_customer_id`.
   */
  private async resolveUserId(
    stripeSub: StripeSubscriptionObject,
  ): Promise<string | null> {
    if (stripeSub.metadata?.userId) return stripeSub.metadata.userId;
    const customerId =
      typeof stripeSub.customer === 'string'
        ? stripeSub.customer
        : stripeSub.customer?.id;
    if (!customerId) return null;

    const linked = await this.users.findOne({
      where: { stripeCustomerId: customerId },
      select: ['id'],
    });
    if (linked) {
      this.logger.log(
        `subscription ${stripeSub.id} resolved to user ${linked.id} via stripe customer ${customerId}`,
      );
      return linked.id;
    }

    const matched = await this.matchUserByStripeCustomer(customerId);
    if (!matched) return null;
    this.logger.log(
      `subscription ${stripeSub.id} resolved to user ${matched.userId} via stripe customer ${customerId} (${matched.via})`,
    );
    return matched.userId;
  }

  /**
   * Customer de Stripe que ningún usuario tiene en `stripe_customer_id`: lo
   * creó el dueño a mano en el Dashboard, o el usuario quedó apuntando a otro
   * customer (p. ej. uno vacío que abrió el portal). Le preguntamos a Stripe
   * quién es y lo cruzamos, en orden, por metadata.userId (los customers que
   * crea la app lo llevan), email (sin distinguir mayúsculas) y teléfono
   * (E.164, como lo guarda auth). Si cierra, dejamos el customer enlazado
   * para la próxima — salvo que el usuario ya tenga otro: ahí solo avisamos,
   * pisarlo a ciegas podría romperle el portal y el checkout.
   */
  private async matchUserByStripeCustomer(
    customerId: string,
  ): Promise<{ userId: string; via: string } | null> {
    if (!this.stripe) return null;
    let customer: StripeCustomerObject;
    try {
      customer = (await this.stripe.customers.retrieve(
        customerId,
      )) as unknown as StripeCustomerObject;
    } catch (err) {
      this.logger.warn(
        `could not retrieve stripe customer ${customerId}: ${(err as Error).message}`,
      );
      return null;
    }
    if (customer.deleted) {
      this.logger.warn(`stripe customer ${customerId} is deleted in Stripe`);
      return null;
    }

    const select: (keyof User)[] = ['id', 'stripeCustomerId'];
    let user: User | null = null;
    let via = '';

    const metaUserId = customer.metadata?.userId;
    if (metaUserId) {
      user = await this.users.findOne({ where: { id: metaUserId }, select });
      via = 'customer metadata.userId';
    }

    const email = customer.email?.trim().toLowerCase();
    if (!user && email) {
      // ILIKE sin comodines = igualdad sin mayúsculas; se escapan % y _ para
      // que un "_" del email no haga de comodín y cruce con otro usuario.
      user = await this.users.findOne({
        where: { email: ILike(email.replace(/[\\%_]/g, '\\$&')) },
        select,
      });
      via = 'customer email';
    }

    const phone = normalizeE164(customer.phone);
    if (!user && phone) {
      user = await this.users.findOne({ where: { phone }, select });
      via = 'customer phone';
    }

    if (!user) {
      // Enmascarado a propósito: alcanza para ubicar el customer en el
      // Dashboard sin volcar datos personales al log.
      this.logger.warn(
        `stripe customer ${customerId} matches no app user (email ${maskEmail(customer.email)}, phone ${maskPhone(phone)}, metadata.userId ${metaUserId ?? '-'})`,
      );
      return null;
    }

    if (!user.stripeCustomerId) {
      await this.users.update(user.id, { stripeCustomerId: customerId });
    } else if (user.stripeCustomerId !== customerId) {
      this.logger.warn(
        `user ${user.id} is linked to stripe customer ${user.stripeCustomerId} but subscription customer is ${customerId} — not overwriting; merge them in the Stripe Dashboard`,
      );
    }
    return { userId: user.id, via };
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
        this.logger.warn(
          `Unknown Stripe subscription status: ${stripeStatus} — mapping to INCOMPLETE`,
        );
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
