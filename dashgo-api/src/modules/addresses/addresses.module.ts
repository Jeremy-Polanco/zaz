import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserAddress } from '../../entities/user-address.entity';
import { User } from '../../entities/user.entity';
import { DeliveryZone } from '../../entities/delivery-zone.entity';
import { AddressesService } from './addresses.service';
import { DeliveryZonesService } from './delivery-zones.service';
import { MeAddressesController } from './me-addresses.controller';
import { AdminAddressesController } from './admin-addresses.controller';

@Module({
  imports: [TypeOrmModule.forFeature([UserAddress, User, DeliveryZone])],
  providers: [AddressesService, DeliveryZonesService],
  controllers: [MeAddressesController, AdminAddressesController],
  // DeliveryZonesService se exporta porque la tasa de impuesto tiene que ser
  // LA MISMA en los tres caminos que cobran: la orden, el intent de Stripe y la
  // libreta de direcciones. Importar este módulo no arma ciclo — AddressesModule
  // no importa ningún módulo de la app, sólo TypeOrmModule.
  exports: [AddressesService, DeliveryZonesService],
})
export class AddressesModule {}
