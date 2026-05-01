import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order, Product } from '../../entities';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { PointsModule } from '../points/points.module';
import { ShippingModule } from '../shipping/shipping.module';
import { CreditModule } from '../credit/credit.module';
import { SubscriptionModule } from '../subscription/subscription.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Product, Order]),
    PointsModule,
    ShippingModule,
    forwardRef(() => CreditModule),
    forwardRef(() => SubscriptionModule),
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
