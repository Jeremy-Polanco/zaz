import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order, OrderItem, Product } from '../../entities';
import { UserAddress } from '../../entities/user-address.entity';
import { User } from '../../entities/user.entity';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { SubscriberBebederoListener } from './subscriber-bebedero.listener';
import { OrderNotificationsService } from './order-notifications.service';
import { WinBackCron } from './win-back.cron';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsModule } from '../payments/payments.module';
import { PointsModule } from '../points/points.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { PromotersModule } from '../promoters/promoters.module';
import { ShippingModule } from '../shipping/shipping.module';
import { CreditModule } from '../credit/credit.module';
import { SubscriptionModule } from '../subscription/subscription.module';
import { TwilioModule } from '../twilio/twilio.module';
import { RentalsModule } from '../rentals/rentals.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, OrderItem, Product, UserAddress, User]),
    WhatsAppModule,
    NotificationsModule,
    PaymentsModule,
    PointsModule,
    InvoicesModule,
    PromotersModule,
    ShippingModule,
    CreditModule,
    SubscriptionModule,
    TwilioModule,
    // T65: RentalsModule imported so OrdersService can call activateRentalsForOrder.
    // No circular dependency: RentalsModule does NOT import OrdersModule.
    // PaymentsModule already imports forwardRef(RentalsModule) — this is a direct import.
    forwardRef(() => RentalsModule),
  ],
  controllers: [OrdersController],
  providers: [
    OrdersService,
    SubscriberBebederoListener,
    OrderNotificationsService,
    WinBackCron,
  ],
  exports: [OrdersService],
})
export class OrdersModule {}
