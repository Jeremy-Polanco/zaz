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
import { Subscription, SubscriptionStatus } from '../../entities/subscription.entity';
import { User } from '../../entities/user.entity';
import { SubscriptionResponseDto } from './dto/subscription-response.dto';
import { PlanDto } from './dto/plan.dto';
import { plainToInstance } from 'class-transformer';

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
  private priceId = '';

  constructor(
    @InjectRepository(Subscription)
    private readonly subscriptions: Repository<Subscription>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const secret = this.config.get<string>('STRIPE_SECRET_KEY');
    if (!secret) {
      this.logger.warn('STRIPE_SECRET_KEY missing — subscriptions disabled');
      return;
    }
    this.stripe = new Stripe(secret);
    this.priceId = this.config.get<string>('STRIPE_SUBSCRIPTION_PRICE_ID') ?? '';
    if (!this.priceId) {
      this.logger.warn('STRIPE_SUBSCRIPTION_PRICE_ID missing — subscription checkout disabled');
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

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: this.priceId, quantity: 1 }],
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

  getPlan(): PlanDto {
    return { priceCents: 1000, currency: 'usd', interval: 'month' };
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
