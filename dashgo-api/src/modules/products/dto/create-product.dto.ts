import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateProductDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber()
  @Min(0)
  priceToPublic!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  stock?: number;

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

  // When false, this product skips the manual cotización flow (water-style
  // direct ordering). Defaults to true server-side for backward compatibility.
  @IsOptional()
  @IsBoolean()
  requiresQuote?: boolean;

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

  // Rental pricing
  @IsOptional()
  @IsEnum(['single_payment', 'rental'])
  pricingMode?: 'single_payment' | 'rental';

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000000)
  monthlyRentCents?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000000)
  lateFeeCents?: number;

  // Stripe IDs — admin may set these manually; server will lazy-create if absent
  @IsOptional()
  @IsString()
  stripeProductId?: string | null;

  @IsOptional()
  @IsString()
  stripePriceId?: string | null;

  // Bebedero maintenance flags
  @IsOptional()
  @IsBoolean()
  requiresMaintenance?: boolean;

  @IsOptional()
  @IsBoolean()
  isMaintenanceService?: boolean;
}
