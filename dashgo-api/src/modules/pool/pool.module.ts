import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  AssociateBalanceEntry,
  Order,
  OrderItem,
  PointsLedgerEntry,
  PoolContribution,
  PoolDistribution,
  User,
} from '../../entities';
import { AssociateBalanceService } from './associate-balance.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PoolContribution,
      PoolDistribution,
      AssociateBalanceEntry,
      PointsLedgerEntry,
      Order,
      OrderItem,
      User,
    ]),
  ],
  providers: [AssociateBalanceService],
  exports: [AssociateBalanceService],
})
export class PoolModule {}
