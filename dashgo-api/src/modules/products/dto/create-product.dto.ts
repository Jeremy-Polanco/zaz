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

  // Precio (en cents) para suscriptores activos. null = sin precio de
  // suscriptor (todos pagan catálogo/oferta). Cuando está seteado le GANA a la
  // oferta y nunca se acumulan. 0 es válido: gratis para suscriptores.
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000000)
  subscriberPriceCents?: number | null;

  // Categoría fiscal: 'standard' (default) paga impuesto, 'exempt' no. El caso
  // que lo motiva es el agua embotellada, exenta en NJ. Ver common/tax.ts.
  @IsOptional()
  @IsEnum(['standard', 'exempt'])
  taxCategory?: 'standard' | 'exempt';

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

  // One-time theft / replacement fee charged off-session if a subscriber keeps
  // the rented unit without paying. Only meaningful for rental products.
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000000)
  theftFeeCents?: number;

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

  // Marks THE bebedero handed out free when a user subscribes. At most one
  // product carries this flag (enforced by a partial unique index).
  @IsOptional()
  @IsBoolean()
  isDefaultSubscriberBebedero?: boolean;

  // Marca EL producto alquilado exclusivo del plan premium: se entrega gratis
  // al activarse una suscripción premium. A lo sumo un producto lo lleva.
  @IsOptional()
  @IsBoolean()
  isPremiumSubscriberProduct?: boolean;

  // Posición en el catálogo (menor número aparece primero)
  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;
}
