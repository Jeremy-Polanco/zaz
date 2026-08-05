import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsNumber,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class SellerCatalogItemDto {
  @IsUUID()
  productId!: string;

  /**
   * Porcentaje que GANA el vendedor sobre esa línea (mismo sentido que
   * `promoterCommissionPct`, no invertido). 0 es válido: el producto está en su
   * catálogo pero no paga comisión.
   */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  commissionPct!: number;
}

/**
 * Reemplaza el catálogo COMPLETO de un vendedor.
 *
 * Reemplazo total y no parches parciales, igual que `reorder`: dos admins
 * editando a la vez no pueden dejar el catálogo mitad viejo y mitad nuevo, y
 * "sacar un producto" no necesita un endpoint aparte.
 */
export class SetSellerCatalogDto {
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => SellerCatalogItemDto)
  items!: SellerCatalogItemDto[];
}
