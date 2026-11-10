import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import Stripe = require('stripe');
import { Order } from '../../entities';
import { OrderStatus } from '../../entities/enums';
import { CreditService } from '../credit/credit.service';
import { assertStripeProductionConfig } from '../../common/stripe/stripe-runtime-guard';

type StripeClient = InstanceType<typeof Stripe>;

export interface CreatedIntent {
  paymentIntentId: string;
  clientSecret: string;
  amount: number;
  currency: string;
}

/** Our webhook route, matched by path so staging/prod hosts both qualify. */
function isOurWebhookUrl(url: string): boolean {
  try {
    return new URL(url).pathname.endsWith('/payments/webhook');
  } catch {
    return false;
  }
}

@Injectable()
export class PaymentsService implements OnModuleInit {
  private readonly logger = new Logger(PaymentsService.name);
  private stripe: StripeClient | null = null;
  private webhookSecret = '';

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    private readonly credit: CreditService,
  ) {}

  onModuleInit() {
    const secret = this.config.get<string>('STRIPE_SECRET_KEY');
    // FIX C6 — fail boot in production if Stripe credentials are misconfigured
    // (test key in prod, missing webhook secret, missing subscription price).
    assertStripeProductionConfig({
      nodeEnv: this.config.get<string>('NODE_ENV') ?? 'development',
      stripeSecretKey: secret,
      stripeWebhookSecret: this.config.get<string>('STRIPE_WEBHOOK_SECRET'),
      stripeSubscriptionPriceId: this.config.get<string>(
        'STRIPE_SUBSCRIPTION_PRICE_ID',
      ),
    });
    if (!secret) {
      this.logger.warn('STRIPE_SECRET_KEY missing — payments disabled');
      return;
    }
    this.stripe = new Stripe(secret);
    this.webhookSecret = this.config.get<string>('STRIPE_WEBHOOK_SECRET') ?? '';
  }

  isEnabled() {
    return this.stripe !== null;
  }

  async retrieveIntent(id: string) {
    const stripe = this.requireStripe();
    return stripe.paymentIntents.retrieve(id);
  }

  /**
   * Releases an uncaptured hold. Best-effort: an intent that is already
   * canceled or captured makes Stripe throw, and that is fine — the caller
   * (order cancellation) must never fail because of it.
   */
  async cancelIntent(id: string): Promise<boolean> {
    const stripe = this.requireStripe();
    try {
      await stripe.paymentIntents.cancel(id);
      return true;
    } catch (err) {
      this.logger.warn(
        `cancelIntent(${id}) skipped: ${(err as Error).message}`,
      );
      return false;
    }
  }

  /**
   * Stripe auto-disables a webhook endpoint after days of failed deliveries
   * (this happened when the app sat archived for a week) and then never
   * resumes on its own — every digital order strands in QUOTED. Re-enable OUR
   * endpoint (matched by path, never someone else's) and log the state so the
   * next incident is visible in the logs. Never throws: a restricted key
   * without webhook permissions must not break boot or the cron.
   */
  async ensureWebhookEndpointEnabled(): Promise<{
    checked: number;
    reenabled: number;
  }> {
    if (!this.isEnabled()) return { checked: 0, reenabled: 0 };
    const stripe = this.requireStripe();
    let checked = 0;
    let reenabled = 0;
    try {
      const endpoints = await stripe.webhookEndpoints.list({ limit: 20 });
      for (const ep of endpoints.data) {
        if (!isOurWebhookUrl(ep.url)) continue;
        checked += 1;
        if (ep.status !== 'disabled') continue;
        await stripe.webhookEndpoints.update(ep.id, { disabled: false });
        reenabled += 1;
        this.logger.warn(
          `Stripe had DISABLED our webhook endpoint ${ep.id} (${ep.url}) — re-enabled it`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `ensureWebhookEndpointEnabled skipped: ${(err as Error).message}`,
      );
    }
    return { checked, reenabled };
  }

  /**
   * Retrieves a Stripe Subscription object by ID.
   * Used by the webhook dispatcher to read subscription metadata
   * for invoice events (which don't carry metadata directly).
   */
  async retrieveSubscription(subscriptionId: string) {
    const stripe = this.requireStripe();
    return stripe.subscriptions.retrieve(subscriptionId);
  }

  /**
   * Creates a PaymentIntent for a customer to settle their outstanding credit
   * balance. Tagged with `metadata.kind = 'credit_payment'` so the webhook
   * handler can route it to the credit ledger instead of the orders table.
   */
  async createCreditPaymentIntent(input: {
    userId: string;
    amountCents: number;
  }): Promise<CreatedIntent> {
    const stripe = this.requireStripe();
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
      throw new BadRequestException('Monto inválido');
    }
    const intent = await stripe.paymentIntents.create({
      amount: input.amountCents,
      currency: 'usd',
      automatic_payment_methods: { enabled: true },
      metadata: {
        userId: input.userId,
        kind: 'credit_payment',
      },
    });
    return {
      paymentIntentId: intent.id,
      clientSecret: intent.client_secret ?? '',
      amount: input.amountCents,
      currency: 'usd',
    };
  }

  /**
   * Creates a PaymentIntent with capture_method='manual' for admin-quoted
   * orders. Funds are authorized (held) on the customer's card when the client
   * confirms; we capture later on delivery.
   *
   * T61: Optional `customerId` and `setupFutureUsage` are set for mixed-cart
   * orders that contain rental items, so the PaymentMethod is saved off-session
   * for recurring subscription charges.
   */
  async createAuthorizationIntent(input: {
    userId: string;
    orderId: string;
    amountCents: number;
    /** Stripe Customer ID — required when cart contains rental items */
    customerId?: string;
    /** Set 'off_session' to save the PaymentMethod for future recurring charges */
    setupFutureUsage?: 'off_session' | 'on_session';
  }): Promise<CreatedIntent> {
    const stripe = this.requireStripe();
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
      throw new BadRequestException('Monto inválido');
    }

    // Build the base params; conditionally add rental-specific fields using
    // spread to avoid TypeScript index-signature issues.
    const intentParams = {
      amount: input.amountCents,
      currency: 'usd',
      capture_method: 'manual' as const,
      automatic_payment_methods: { enabled: true as const },
      metadata: {
        userId: input.userId,
        orderId: input.orderId,
      },
      ...(input.customerId ? { customer: input.customerId } : {}),
      ...(input.setupFutureUsage
        ? {
            setup_future_usage: input.setupFutureUsage,
          }
        : {}),
    };

    const intent = await stripe.paymentIntents.create(intentParams, {
      idempotencyKey: `order_${input.orderId}_intent`,
    });
    return {
      paymentIntentId: intent.id,
      clientSecret: intent.client_secret ?? '',
      amount: input.amountCents,
      currency: 'usd',
    };
  }

  /**
   * Captures a previously-authorized PaymentIntent at delivery time. Captures
   * the full authorized amount (Stripe does not allow capturing more).
   */
  async captureIntent(intentId: string) {
    const stripe = this.requireStripe();
    return stripe.paymentIntents.capture(intentId);
  }

  constructWebhookEvent(rawBody: Buffer, signature: string | undefined) {
    const stripe = this.requireStripe();
    if (!this.webhookSecret) {
      throw new BadRequestException('Webhook secret no configurado');
    }
    if (!signature) {
      throw new BadRequestException('Stripe-Signature header requerido');
    }
    return stripe.webhooks.constructEvent(
      rawBody,
      signature,
      this.webhookSecret,
    );
  }

  async markPaidByIntentId(intentId: string): Promise<void> {
    await this.orders.update(
      { stripePaymentIntentId: intentId, paidAt: IsNull() },
      { paidAt: new Date() },
    );
  }

  /**
   * Stripe fires `payment_intent.amount_capturable_updated` when a manual-capture
   * authorization has succeeded (funds held). This is the real "client authorized"
   * signal. Moves the matching order QUOTED → PENDING_VALIDATION.
   */
  async markAuthorizedByIntentId(intentId: string): Promise<void> {
    const order = await this.orders.findOne({
      where: { stripePaymentIntentId: intentId },
    });
    if (!order) return;
    if (order.status !== OrderStatus.QUOTED) return;
    await this.orders.update(order.id, {
      status: OrderStatus.PENDING_VALIDATION,
      authorizedAt: new Date(),
    });
  }

  /**
   * When a PaymentIntent is cancelled or its confirmation fails before capture,
   * revert the order to QUOTED and clear the intent id so the client can retry.
   * No-op if we already captured.
   */
  async handleAuthFailureByIntentId(intentId: string): Promise<void> {
    const order = await this.orders.findOne({
      where: { stripePaymentIntentId: intentId },
    });
    if (!order) return;
    if (order.paidAt !== null) return;
    if (
      order.status !== OrderStatus.QUOTED &&
      order.status !== OrderStatus.PENDING_VALIDATION
    ) {
      return;
    }
    await this.orders.update(order.id, {
      status: OrderStatus.QUOTED,
      stripePaymentIntentId: null,
      authorizedAt: null,
    });

    // T4.7: Reverse credit charge on Stripe auth failure (idempotent)
    if (parseFloat(order.creditApplied || '0') > 0) {
      await this.credit.reverseCharge(order.id); // own TX
    }
  }

  private requireStripe(): StripeClient {
    if (!this.stripe) {
      throw new ServiceUnavailableException(
        'Stripe no configurado en el servidor',
      );
    }
    return this.stripe;
  }
}
