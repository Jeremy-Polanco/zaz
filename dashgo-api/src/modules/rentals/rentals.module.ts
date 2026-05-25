import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { Rental } from '../../entities/rental.entity';
import { User } from '../../entities/user.entity';
import { Product } from '../../entities/product.entity';
import { Order } from '../../entities/order.entity';
import { RentalsService } from './rentals.service';
import { LateFeeCron } from './late-fee.cron';
import { AdminRentalsController } from './admin-rentals.controller';
import { MeRentalsController } from './me-rentals.controller';

/**
 * RentalsModule — Phase 3+.
 *
 * RentalsService added in Phase 3. Controllers added in Phase 7 (Batch 7).
 * LateFeeCron added in Phase 5 (T5.7) — runs daily at 03:00 to charge late fees.
 * Requires ScheduleModule.forRoot() in AppModule (already present at line 38).
 *
 * - AdminRentalsController: GET /admin/rentals, GET /admin/rentals/delinquent,
 *   POST /admin/rentals/:id/charge-late-fee, POST /admin/rentals/:id/cancel,
 *   POST /admin/rentals/:id/retry-setup
 * - MeRentalsController: GET /me/rentals
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Rental, User, Product, Order]),
    ConfigModule,
  ],
  providers: [RentalsService, LateFeeCron],
  controllers: [AdminRentalsController, MeRentalsController],
  exports: [RentalsService],
})
export class RentalsModule {}
