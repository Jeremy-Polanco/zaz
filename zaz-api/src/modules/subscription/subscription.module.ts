import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { Subscription } from '../../entities/subscription.entity';
import { SubscriptionPlan } from '../../entities/subscription-plan.entity';
import { User } from '../../entities/user.entity';
import { SubscriptionService } from './subscription.service';
import { SubscriptionController } from './subscription.controller';
import { AdminSubscriptionController } from './admin-subscription.controller';
import { AdminRentalController } from './admin-rental.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Subscription, User, SubscriptionPlan]), ConfigModule],
  providers: [SubscriptionService],
  controllers: [SubscriptionController, AdminSubscriptionController, AdminRentalController],
  exports: [SubscriptionService],
})
export class SubscriptionModule {}
