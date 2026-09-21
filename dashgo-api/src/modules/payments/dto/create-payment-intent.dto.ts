import { Transform, Type } from 'class-transformer';
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
  Matches,
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

  /**
   * Código postal del destino. Es lo que decide la TASA de impuesto con la que
   * se arma este intent: sin él, Stripe cobraría la tasa global y la orden que
   * el cliente crea un segundo después cotizaría la de su zona — vería un
   * precio y pagaría otro.
   *
   * Misma regla que en la libreta del cliente y que en la chincheta del admin
   * (5 dígitos, texto): una regla distinta por puerta sería un dato que a veces
   * resuelve zona y a veces no. Texto porque Elizabeth NJ es 072xx.
   *
   * Opcional: las versiones viejas de la app no lo mandan y siguen pagando el
   * fallback histórico.
   */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @Matches(/^\d{5}$/, { message: 'El código postal debe tener 5 dígitos' })
  postalCode?: string;
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
