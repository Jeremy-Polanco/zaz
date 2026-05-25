import { PartialType } from '@nestjs/mapped-types';
import { CreateAddressDto } from './create-address.dto';

// Same shape as Create, but all fields optional, and isDefault is intentionally
// NOT part of CreateAddressDto so it stays out of UpdateAddressDto too.
export class UpdateAddressDto extends PartialType(CreateAddressDto) {}
