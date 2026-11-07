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
import { PoolService } from './pool.service';

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
  providers: [AssociateBalanceService, PoolService],
  exports: [AssociateBalanceService, PoolService],
})
export class PoolModule {}
