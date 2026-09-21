import { Transform } from 'class-transformer';
import {
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Lo que el CLIENTE puede mandar de una dirección.
 *
 * `city`, `state` y `county` NO están acá a propósito, y no es un olvido: son
 * hechos del servidor, derivados de la lat/lng por geocodificación inversa. El
 * estado decide la tasa de impuesto (NJ 6.625%, NYC 8.875%); si el cliente
 * pudiera mandarlo, estaría eligiendo cuánto impuesto paga. Con
 * `forbidNonWhitelisted` encendido, mandarlos es un 400.
 */
export class CreateAddressDto {
  @IsString()
  @Length(1, 60)
  label!: string;

  @IsString()
  @Length(1, 255)
  line1!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  line2?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  building?: string;

  /**
   * Número de puerta ("1101", "120-05", "24 1/2"). Lo escribe el cliente; si no
   * lo escribe, lo completa la geocodificación inversa de la chincheta.
   *
   * Hasta acá se perdía: el snapshot de la orden lo guardaba y la libreta no,
   * así que el segundo pedido a la misma casa llegaba sin número de puerta.
   *
   * 40 y no 10 porque acá los números de puerta tienen guiones y fracciones.
   */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(40)
  houseNumber?: string;

  @IsNumber({ maxDecimalPlaces: 7 })
  @Min(-90)
  @Max(90)
  lat!: number;

  @IsNumber({ maxDecimalPlaces: 7 })
  @Min(-180)
  @Max(180)
  lng!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  instructions?: string;

  /**
   * Código postal que ESCRIBE el cliente. String y no number porque Elizabeth
   * NJ es 072xx: tipado como número el cero de adelante se pierde y la zona
   * deja de resolver.
   *
   * Opcional en la API aunque los formularios lo pidan obligatorio: la
   * chincheta del admin y las versiones viejas de la app siguen guardando
   * direcciones sin ZIP, y romperlas no le sirve a nadie.
   */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @Matches(/^\d{5}$/, { message: 'El código postal debe tener 5 dígitos' })
  postalCode?: string;
}
