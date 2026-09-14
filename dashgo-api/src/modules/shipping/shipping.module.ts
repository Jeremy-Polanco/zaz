import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../../entities';
import { AppSetting } from '../../entities/app-setting.entity';
import { UserAddress } from '../../entities/user-address.entity';
import { ShippingController } from './shipping.controller';
import { ShippingService } from './shipping.service';
import { ShippingRateService } from './shipping-rate.service';

@Module({
  imports: [TypeOrmModule.forFeature([User, UserAddress, AppSetting])],
  controllers: [ShippingController],
  providers: [ShippingService, ShippingRateService],
  // ShippingRateService se exporta porque OrdersService lo necesita al crear
  // cada pedido (OrdersModule ya importa este módulo).
  exports: [ShippingService, ShippingRateService],
})
export class ShippingModule {}
