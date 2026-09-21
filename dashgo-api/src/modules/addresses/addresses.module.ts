import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserAddress } from '../../entities/user-address.entity';
import { User } from '../../entities/user.entity';
import { DeliveryZone } from '../../entities/delivery-zone.entity';
import { TaxJurisdiction } from '../../entities/tax-jurisdiction.entity';
import { AddressesService } from './addresses.service';
import { TaxJurisdictionService } from './tax-jurisdiction.service';
import { GeocodingModule } from '../geocoding/geocoding.module';
import { MeAddressesController } from './me-addresses.controller';
import { AdminAddressesController } from './admin-addresses.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserAddress, User, DeliveryZone, TaxJurisdiction]),
    // Guardar una dirección completa su ciudad/estado/condado desde la
    // chincheta. GeocodingModule no importa nada de la app: no hay ciclo.
    GeocodingModule,
  ],
  providers: [AddressesService, TaxJurisdictionService],
  controllers: [MeAddressesController, AdminAddressesController],
  // TaxJurisdictionService se exporta porque la tasa de impuesto tiene que ser
  // LA MISMA en los tres caminos que cobran: la orden, el intent de Stripe y la
  // libreta de direcciones. Importar este módulo no arma ciclo — AddressesModule
  // sólo importa TypeOrmModule y GeocodingModule.
  exports: [AddressesService, TaxJurisdictionService, GeocodingModule],
})
export class AddressesModule {}
