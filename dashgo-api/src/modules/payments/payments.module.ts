import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order, Product, StripeWebhookEvent } from '../../entities';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { StripeWebhookIdempotencyService } from './stripe-webhook-idempotency.service';
import { StripeWebhookEventCleanupCron } from './stripe-webhook-event-cleanup.cron';
import { StripeWebhookEventJanitorCron } from './stripe-webhook-event-janitor.cron';
import { PointsModule } from '../points/points.module';
import { ShippingModule } from '../shipping/shipping.module';
import { CreditModule } from '../credit/credit.module';
import { SubscriptionModule } from '../subscription/subscription.module';
import { RentalsModule } from '../rentals/rentals.module';
import { OrdersModule } from '../orders/orders.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Product, Order, StripeWebhookEvent]),
    PointsModule,
    ShippingModule,
    forwardRef(() => CreditModule),
    forwardRef(() => SubscriptionModule),
    forwardRef(() => RentalsModule),
    // forwardRef: the webhook controller injects OrdersService for skip-quote
    // auto-confirm; OrdersModule already imports PaymentsModule — mutual ref.
    forwardRef(() => OrdersModule),
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
