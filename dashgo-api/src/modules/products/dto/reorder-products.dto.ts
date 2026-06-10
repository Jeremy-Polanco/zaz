import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export class ReorderItemDto {
  @IsUUID()
  id!: string;

  @IsInt()
  @Min(0)
  displayOrder!: number;
}

/**
 * Bulk reorder del catálogo — el drag & drop del panel admin manda el orden
 * completo en una sola llamada para que la posición quede consistente.
 */
export class ReorderProductsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ReorderItemDto)
  items!: ReorderItemDto[];
}
