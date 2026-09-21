import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order, Product, StripeWebhookEvent } from '../../entities';
import { UserAddress } from '../../entities/user-address.entity';
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
import { AddressesModule } from '../addresses/addresses.module';

@Module({
  imports: [
    // UserAddress: el intent resuelve la tasa por la fila GUARDADA del cliente
    // cuando el checkout manda `deliveryAddressId`, igual que la orden.
    TypeOrmModule.forFeature([Product, Order, StripeWebhookEvent, UserAddress]),
    PointsModule,
    ShippingModule,
    // El intent tiene que cobrar la MISMA tasa que después cotiza la orden.
    // Import directo: AddressesModule no importa nada de la app, no hay ciclo.
    // Re-exporta GeocodingModule, que es de donde sale GeocodingService.
    AddressesModule,
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
