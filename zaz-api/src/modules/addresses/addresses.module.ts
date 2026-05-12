import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserAddress } from '../../entities/user-address.entity';
import { User } from '../../entities/user.entity';
import { AddressesService } from './addresses.service';
import { MeAddressesController } from './me-addresses.controller';
import { AdminAddressesController } from './admin-addresses.controller';

@Module({
  imports: [TypeOrmModule.forFeature([UserAddress, User])],
  providers: [AddressesService],
  controllers: [MeAddressesController, AdminAddressesController],
  exports: [AddressesService],
})
export class AddressesModule {}
