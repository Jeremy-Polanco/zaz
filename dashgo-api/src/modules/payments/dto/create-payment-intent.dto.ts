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

  /**
   * Id de la dirección GUARDADA del cliente de la que sale este cobro.
   *
   * Existe por la misma razón que en `CreateOrderDto`: el `postalCode` de
   * arriba lo escribe el cliente, y con la tasa de impuesto saliendo de ahí el
   * cliente elegiría cuánto impuesto paga. Con el id, el servidor lee la fila
   * real (validando que sea suya) y esa fila fija la tasa — la MISMA que va a
   * cotizar la orden un segundo después. Sin esto, el intent y la orden podían
   * resolver distinto y el cliente veía un precio y pagaba otro.
   *
   * Opcional: las versiones viejas de la app no lo mandan y siguen resolviendo
   * por el ZIP posteado.
   */
  @IsOptional()
  @IsUUID()
  deliveryAddressId?: string;
}
