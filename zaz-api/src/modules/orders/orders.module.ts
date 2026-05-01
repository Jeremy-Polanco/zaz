import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order, OrderItem, Product } from '../../entities';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { PaymentsModule } from '../payments/payments.module';
import { PointsModule } from '../points/points.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { PromotersModule } from '../promoters/promoters.module';
import { ShippingModule } from '../shipping/shipping.module';
import { CreditModule } from '../credit/credit.module';
import { SubscriptionModule } from '../subscription/subscription.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, OrderItem, Product]),
    PaymentsModule,
    PointsModule,
    InvoicesModule,
    PromotersModule,
    ShippingModule,
    CreditModule,
    SubscriptionModule,
  ],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
