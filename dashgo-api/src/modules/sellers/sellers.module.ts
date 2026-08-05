import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  CommissionEntry,
  Order,
  OrderItem,
  SellerProduct,
  User,
} from '../../entities';
import { SellersService } from './sellers.service';
import { SellersController } from './sellers.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CommissionEntry,
      SellerProduct,
      User,
      Order,
      OrderItem,
    ]),
  ],
  controllers: [SellersController],
  providers: [SellersService],
  exports: [SellersService],
})
export class SellersModule {}
