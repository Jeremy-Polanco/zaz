import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { PaymentMethod } from '../../../entities/enums';

export class DeliveryAddressDto {
  @IsString()
  text!: string;

  @IsLatitude()
  lat!: number;

  @IsLongitude()
  lng!: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  building?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  houseNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  unit?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reference?: string;
}

export class OrderItemInput {
  @IsUUID()
  productId!: string;

  @IsInt()
  @IsPositive()
  quantity!: number;
}

export class CreateOrderDto {
  // Optional: customers place orders without a delivery address. The
  // super-admin captures and sets the location at delivery time
  // (PATCH /orders/:id/delivery-address).
  @IsOptional()
  @ValidateNested()
  @Type(() => DeliveryAddressDto)
  deliveryAddress?: DeliveryAddressDto;

  @IsEnum(PaymentMethod)
  paymentMethod!: PaymentMethod;

  @IsOptional()
  @IsString()
  stripePaymentIntentId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OrderItemInput)
  items!: OrderItemInput[];

  @IsOptional()
  @IsBoolean()
  usePoints?: boolean;

  @IsOptional()
  @IsBoolean()
  useCredit?: boolean;

  // Propina — only valid with paymentMethod=digital; the server computes the
  // amount from its own subtotal (the client never sends money).
  @IsOptional()
  @IsIn([15, 18, 25])
  tipPercent?: number;
}
