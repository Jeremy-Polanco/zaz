import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import Stripe = require('stripe');
import { Order, Product } from '../../entities';
import { OrderStatus } from '../../entities/enums';
import { getEffectivePrice } from '../products/pricing';
import { PointsService } from '../points/points.service';
import { ShippingService } from '../shipping/shipping.service';
import { CreditService } from '../credit/credit.service';

type StripeClient = InstanceType<typeof Stripe>;

const TAX_RATE = 0.08887;

export interface CreateIntentInput {
  userId: string;
  items: { productId: string; quantity: number }[];
  usePoints?: boolean;
  deliveryAddress?: {
    text: string;
    lat?: number | null;
    lng?: number | null;
  };
}

export interface CreatedIntent {
  paymentIntentId: string;
  clientSecret: string;
  amount: number;
  currency: string;
}

@Injectable()
export class PaymentsService implements OnModuleInit {
  private readonly logger = new Logger(PaymentsService.name);
  private stripe: StripeClient | null = null;
  private webhookSecret = '';

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(Product)
    private readonly products: Repository<Product>,
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    private readonly points: PointsService,
    private readonly shipping: ShippingService,
    private readonly credit: CreditService,
  ) {}

  onModuleInit() {
    const secret = this.config.get<string>('STRIPE_SECRET_KEY');
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

  async createIntentForItems(input: CreateIntentInput): Promise<CreatedIntent> {
    const stripe = this.requireStripe();
    const productIds = input.items.map((i) => i.productId);
    const products = await this.products.find({
      where: { id: In(productIds) },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    const now = new Date();
    let subtotalCents = 0;
    for (const item of input.items) {
      const product = byId.get(item.productId);
      if (!product) {
        throw new BadRequestException('Uno o más productos no existen');
      }
      if (!product.isAvailable) {
        throw new BadRequestException(
          `El producto "${product.name}" no está disponible`,
        );
      }
      const effective = getEffectivePrice(product, now);
      subtotalCents += effective.priceCents * item.quantity;
    }
    if (subtotalCents <= 0) {
      throw new BadRequestException('Monto inválido');
    }

    let pointsRedeemedCents = 0;
    if (input.usePoints) {
      const balance = await this.points.getBalance(input.userId);
      if (balance.claimableCents > 0) {
        pointsRedeemedCents = Math.min(balance.claimableCents, subtotalCents);
      }
    }

    const quote = await this.shipping.computeQuote({
      lat: input.deliveryAddress?.lat,
      lng: input.deliveryAddress?.lng,
    });
    const shippingCents = quote.shippingCents;

    const taxableCents = Math.max(
      0,
      subtotalCents + shippingCents - pointsRedeemedCents,
    );
    const taxCents = Math.round(taxableCents * TAX_RATE);
    const totalCents = taxableCents + taxCents;

    const intent = await stripe.paymentIntents.create(
      {
        amount: totalCents,
        currency: 'usd',
        automatic_payment_methods: { enabled: true },
        metadata: {
          userId: input.userId,
        },
      },
      { idempotencyKey: `user_${input.userId}_intent` },
    );

    return {
      paymentIntentId: intent.id,
      clientSecret: intent.client_secret ?? '',
      amount: totalCents,
      currency: 'usd',
    };
  }

  async retrieveIntent(id: string) {
    const stripe = this.requireStripe();
    return stripe.paymentIntents.retrieve(id);
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
   */
  async createAuthorizationIntent(input: {
    userId: string;
    orderId: string;
    amountCents: number;
  }): Promise<CreatedIntent> {
    const stripe = this.requireStripe();
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
      throw new BadRequestException('Monto inválido');
    }
    const intent = await stripe.paymentIntents.create(
      {
        amount: input.amountCents,
        currency: 'usd',
        capture_method: 'manual',
        automatic_payment_methods: { enabled: true },
        metadata: {
          userId: input.userId,
          orderId: input.orderId,
        },
      },
      { idempotencyKey: `order_${input.orderId}_intent` },
    );
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
    return stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
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
