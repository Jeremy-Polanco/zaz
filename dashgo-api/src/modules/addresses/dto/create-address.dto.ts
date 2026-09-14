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
