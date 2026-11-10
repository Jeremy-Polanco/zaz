import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order, StripeWebhookEvent } from '../../entities';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { StripeWebhookIdempotencyService } from './stripe-webhook-idempotency.service';
import { StripeWebhookEventCleanupCron } from './stripe-webhook-event-cleanup.cron';
import { StripeWebhookEventJanitorCron } from './stripe-webhook-event-janitor.cron';
import { CreditModule } from '../credit/credit.module';
import { SubscriptionModule } from '../subscription/subscription.module';
import { RentalsModule } from '../rentals/rentals.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, StripeWebhookEvent]),
    forwardRef(() => CreditModule),
    forwardRef(() => SubscriptionModule),
    forwardRef(() => RentalsModule),
  ],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    StripeWebhookIdempotencyService,
    StripeWebhookEventCleanupCron,
    StripeWebhookEventJanitorCron,
  ],
  exports: [PaymentsService, StripeWebhookIdempotencyService],
})
export class PaymentsModule {}
