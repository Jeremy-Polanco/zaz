import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { Rental } from '../../entities/rental.entity';
import { User } from '../../entities/user.entity';
import { Product } from '../../entities/product.entity';
import { Order } from '../../entities/order.entity';
import { Subscription } from '../../entities/subscription.entity';
import { RentalsService } from './rentals.service';
import { LateFeeCron } from './late-fee.cron';
import { PlanDelinquencyListener } from './plan-delinquency.listener';
import { AdminRentalsController } from './admin-rentals.controller';
import { MeRentalsController } from './me-rentals.controller';

/**
 * RentalsModule — Phase 3+.
 *
 * RentalsService added in Phase 3. Controllers added in Phase 7 (Batch 7).
 * LateFeeCron added in Phase 5 (T5.7) — runs daily at 03:00 to charge late fees.
 * Requires ScheduleModule.forRoot() in AppModule (already present at line 38).
 *
 * PlanDelinquencyListener needs the Subscription entity to READ the plan a $0
 * rental belongs to — this is a `TypeOrmModule.forFeature` entity import, NOT
 * a `SubscriptionModule` import, so the module graph stays acyclic
 * (SubscriptionModule must never import RentalsModule/OrdersModule; the
 * cross-module side effect travels via @nestjs/event-emitter instead).
 *
 * - AdminRentalsController: GET /admin/rentals, GET /admin/rentals/delinquent,
 *   POST /admin/rentals/:id/charge-late-fee, POST /admin/rentals/:id/cancel,
 *   POST /admin/rentals/:id/retry-setup
 * - MeRentalsController: GET /me/rentals
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Rental, User, Product, Order, Subscription]),
    ConfigModule,
  ],
  providers: [RentalsService, LateFeeCron, PlanDelinquencyListener],
  controllers: [AdminRentalsController, MeRentalsController],
  exports: [RentalsService],
})
export class RentalsModule {}
