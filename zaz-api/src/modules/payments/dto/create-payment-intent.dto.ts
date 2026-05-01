import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

export class PaymentIntentItemInput {
  @IsUUID()
  productId!: string;

  @IsInt()
  @IsPositive()
  quantity!: number;
}

export class PaymentIntentAddressInput {
  @IsString()
  text!: string;

  @IsOptional()
  @IsNumber()
  lat?: number;

  @IsOptional()
  @IsNumber()
  lng?: number;
}

export class CreatePaymentIntentDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PaymentIntentItemInput)
  items!: PaymentIntentItemInput[];

  @IsOptional()
  @IsBoolean()
  usePoints?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => PaymentIntentAddressInput)
  deliveryAddress?: PaymentIntentAddressInput;
}
