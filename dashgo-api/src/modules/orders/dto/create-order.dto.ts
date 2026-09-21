import { Transform, Type } from 'class-transformer';
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
  Matches,
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

  /**
   * Código postal que escribe el admin al pinchar la ubicación. Misma regla que
   * en la libreta del cliente (5 dígitos): las dos puertas alimentan la misma
   * resolución de zona por prefijo, y una regla distinta por puerta sería un
   * dato que a veces resuelve y a veces no.
   */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @Matches(/^\d{5}$/, { message: 'El código postal debe tener 5 dígitos' })
  postalCode?: string;
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

  /**
   * Id de la dirección GUARDADA del cliente de la que sale este pedido.
   *
   * Va al tope del DTO y NO adentro de `deliveryAddress` porque el snapshot se
   * persiste tal cual en el JSONB de la orden: un id de otra tabla ahí adentro
   * sería un dato que nadie mantiene y que la orden vieja no tiene.
   *
   * Existe por la PLATA: el `postalCode` del snapshot lo escribe el cliente, y
   * con la tasa de impuesto saliendo de ahí, el cliente elegiría cuánto
   * impuesto paga. Con el id, el servidor lee la fila real (validando que sea
   * suya) y esa fila fija la tasa. Es opcional a propósito — el mobile <= 1.0.8
   * que ya está en la calle sigue mandando sólo el snapshot.
   */
  @IsOptional()
  @IsUUID()
  deliveryAddressId?: string;

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
