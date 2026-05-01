import { IsObject, IsOptional, IsString, MinLength } from 'class-validator';
import type { GeoAddress } from '../../../entities/enums';

export class UpdateMeDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  fullName?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsObject()
  addressDefault?: GeoAddress;
}
