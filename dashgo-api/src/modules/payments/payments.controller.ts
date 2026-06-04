import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  InternalServerErrorException,
  Logger,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { PaymentsService } from './payments.service';
import { CreatePaymentIntentDto } from './dto/create-payment-intent.dto';
import { SubscriptionService } from '../subscription/subscription.service';
import { CreditService } from '../credit/credit.service';
import { RentalsService } from '../rentals/rentals.service';
import { StripeWebhookIdempotencyService } from './stripe-webhook-idempotency.service';

interface StripePaymentIntentLike {
  id: string;
  amount?: number;
  amount_received?: number;
  metadata?: Record<string, string | undefined>;
}

interface StripeSubscriptionLike {
  id: string;
  metadata?: Record<string, string | undefined>;
}

interface StripeInvoiceLike {
  subscription?: string | { id: string };
}

@Controller('payments')
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(
    private readonly payments: PaymentsService,
    private readonly subscriptionService: SubscriptionService,
    private readonly credit: CreditService,
    private readonly rentalsService: RentalsService,
    private readonly idempotency: StripeWebhookIdempotencyService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Post('intent')
  createIntent(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePaymentIntentDto,
  ) {
    return this.payments.createIntentForItems({
      userId: user.id,
      items: dto.items,
      usePoints: dto.usePoints,
      deliveryAddress: dto.deliveryAddress,
    });
  }

  @HttpCode(HttpStatus.OK)
  @Post('webhook')
  async webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ) {
    const event = this.payments.constructWebhookEvent(req.rawBody, signature);

    // Replay-attack protection. The freshness primary signal is the
    // Stripe-Signature `t=` (signed delivery timestamp). event.created is
    // the ORIGINAL creation time and does NOT advance on Stripe retries,
    // so using it as the freshness clamp silently killed every Stripe
    // retry past 5 minutes (NC2).
    const signatureTimestamp =
      this.idempotency.parseSignatureTimestamp(signature);
    this.idempotency.assertFresh(
      {
        id: event.id,
        type: event.type,
        created: event.created,
      },
      signatureTimestamp,
    );

    // Idempotency + concurrency. runOnce takes an advisory lock keyed by
    // event.id so concurrent deliveries serialise; it also re-drives
    // pending/failed rows so Stripe retries can recover from transient
    // failures (NC3).
    const outcome = await this.idempotency.runOnce(
      {
        id: event.id,
        type: event.type,
        created: event.created,
      },
      () => this.dispatch(event),
    );

    if (outcome.status === 'failed') {
      // Handler failure on this attempt. We have NOT yet exhausted
      // retries — return a non-2xx so Stripe redelivers with backoff
      // and our next runOnce() bumps retry_count.
      this.logger.error(
        `stripe webhook business logic failed (event ${event.id}): ${outcome.error.message}`,
      );
      throw new InternalServerErrorException(
        `webhook handler failed for ${event.id}: ${outcome.error.message}`,
      );
    }

    if (outcome.status === 'dead') {
      // Exhausted MAX_WEBHOOK_RETRIES. The row is parked as `dead`. We
      // return 500 here so Stripe stops retrying as fast as its own
      // backoff schedule allows. Ops gets paged via the ledger query.
      this.logger.error(
        `stripe webhook event ${event.id} marked DEAD after retry exhaustion: ${outcome.error.message}`,
      );
      throw new InternalServerErrorException(
        `webhook event ${event.id} exhausted retries`,
      );
    }

    // processed or duplicate → 200, payload is the historic shape so
    // downstream Stripe Dashboard checks still parse it cleanly.
    return { received: true };
  }

  /**
   * The original switch/case routing, extracted so the idempotency wrapper
   * can run it inside a single transaction. Behaviour is unchanged from
   * pre-idempotency code; only the surrounding plumbing changed.
   */
  private async dispatch(event: {
    type: string;
    data: { object: unknown };
  }): Promise<void> {
    const intent = event.data.object as StripePaymentIntentLike;
    const kind = intent.metadata?.kind;
    switch (event.type) {
      case 'payment_intent.amount_capturable_updated':
        // Client successfully authorized the hold on their card under manual capture.
        await this.payments.markAuthorizedByIntentId(intent.id);
        break;
      case 'payment_intent.succeeded':
        if (kind === 'credit_payment') {
          // Customer self-paid their outstanding credit balance.
          const userId = intent.metadata?.userId;
          const amountCents = intent.amount_received ?? intent.amount ?? 0;
          if (userId && amountCents > 0) {
            try {
              await this.credit.recordPaymentFromStripe({
                userId,
                amountCents,
                stripePaymentIntentId: intent.id,
              });
            } catch (err) {
              this.logger.error('credit payment webhook handler failed', err);
            }
          }
        } else {
          // Order flow: fires after our own capture call or automatic flows.
          await this.payments.markPaidByIntentId(intent.id);
        }
        break;
      case 'payment_intent.canceled':
      case 'payment_intent.payment_failed':
        await this.payments.handleAuthFailureByIntentId(intent.id);
        break;
      // Subscription/billing events — dispatched to SubscriptionService (ADR-5: never 500)
      // AND to RentalsService when the underlying subscription has metadata.rentalId (ADR-5).
      case 'checkout.session.completed':
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
      case 'invoice.payment_succeeded':
      case 'invoice.payment_failed':
        // Always dispatch to SubscriptionService (free-shipping path — unaffected)
        try {
          await this.subscriptionService.handleWebhook(event);
        } catch (err) {
          this.logger.error('subscription webhook handler failed', err);
        }
        // Rental dispatch: route to RentalsService if the subscription has metadata.rentalId
        try {
          const rentalId = await this.resolveRentalId(event);
          if (rentalId) {
            await this.rentalsService.handleWebhook(event);
          }
        } catch (err) {
          this.logger.error('rental webhook handler failed', err);
        }
        break;
      default:
        break;
    }
  }

  /**
   * Resolves the rentalId from a Stripe event.
   *
   * For subscription events (customer.subscription.*): metadata is directly on
   * the subscription object at event.data.object.metadata.rentalId.
   *
   * For invoice events (invoice.payment_*): metadata lives on the subscription,
   * not the invoice. We must fetch the subscription from Stripe to read it.
   * This mirrors the pattern in SubscriptionService.handleWebhook lines 432-443.
   *
   * Returns the rentalId string if present, or null if absent.
   */
  private async resolveRentalId(event: {
    type: string;
    data: { object: unknown };
  }): Promise<string | null> {
    const obj = event.data.object as Record<string, unknown>;

    // Direct metadata on subscription events
    if (event.type.startsWith('customer.subscription.')) {
      const sub = obj as unknown as StripeSubscriptionLike;
      return sub.metadata?.rentalId ?? null;
    }

    // Invoice events: fetch subscription to read metadata
    if (event.type.startsWith('invoice.')) {
      const invoice = obj as StripeInvoiceLike;
      if (!invoice.subscription) return null;
      const subId =
        typeof invoice.subscription === 'string'
          ? invoice.subscription
          : invoice.subscription.id;
      const sub = await this.payments.retrieveSubscription(subId);
      const subMetadata = (sub as unknown as StripeSubscriptionLike).metadata;
      return subMetadata?.rentalId ?? null;
    }

    return null;
  }
}
