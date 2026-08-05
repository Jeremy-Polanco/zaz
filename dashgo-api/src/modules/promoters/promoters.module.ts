import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Order,
  OrderItem,
  Payout,
  CommissionEntry,
  User,
} from '../../entities';
import { PromotersController } from './promoters.controller';
import { PromotersService } from './promoters.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      Order,
      OrderItem,
      Payout,
      CommissionEntry,
    ]),
  ],
  controllers: [PromotersController],
  providers: [PromotersService],
  exports: [PromotersService],
})
export class PromotersModule {}
