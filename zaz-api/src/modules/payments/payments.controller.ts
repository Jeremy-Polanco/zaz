import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
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

interface StripePaymentIntentLike {
  id: string;
  amount?: number;
  amount_received?: number;
  metadata?: Record<string, string | undefined>;
}

@Controller('payments')
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(
    private readonly payments: PaymentsService,
    private readonly subscriptionService: SubscriptionService,
    private readonly credit: CreditService,
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
    const event = this.payments.constructWebhookEvent(req.rawBody!, signature);
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
      // Subscription/billing events — dispatched to SubscriptionService (ADR-8: never 500)
      case 'checkout.session.completed':
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
      case 'invoice.payment_succeeded':
      case 'invoice.payment_failed':
        try {
          await this.subscriptionService.handleWebhook(event);
        } catch (err) {
          this.logger.error('subscription webhook handler failed', err);
        }
        break;
      default:
        break;
    }
    return { received: true };
  }
}
