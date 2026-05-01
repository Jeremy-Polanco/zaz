import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  priceToPublic?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  promoterCommissionPct?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  pointsPct?: number;

  @IsOptional()
  @IsUUID()
  categoryId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  offerLabel?: string | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  offerDiscountPct?: number | null;

  @IsOptional()
  @IsDateString()
  offerStartsAt?: string | null;

  @IsOptional()
  @IsDateString()
  offerEndsAt?: string | null;
}
