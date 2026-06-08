import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
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
}
