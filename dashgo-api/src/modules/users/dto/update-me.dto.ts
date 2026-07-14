import {
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MinLength,
  ValidateIf,
} from 'class-validator';
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

  // Optional birthday (YYYY-MM-DD). Explicit null clears it.
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'La fecha de nacimiento debe tener formato YYYY-MM-DD',
  })
  dateOfBirth?: string | null;
}
