import { Type } from 'class-transformer';
import { IsLatitude, IsLongitude, IsOptional } from 'class-validator';

/**
 * Query params de GET /orders — coordenadas GPS del DISPOSITIVO del staff en
 * este momento (repartidor o vendedor armando la ruta).
 *
 * Sólo tienen efecto para staff (SUPER_ADMIN_DELIVERY / SELLER); el cliente
 * las ignora porque nunca recibe orden de despacho. `@Type(() => Number)` es
 * necesario porque Express entrega TODO query param como string — sin esto
 * `@IsLatitude`/`@IsLongitude` recibirían '18.4861' en vez de 18.4861.
 *
 * `lat`/`lng` sólo cuentan como origen "device" cuando llegan LOS DOS juntos
 * (ver OrdersService.findAll) — uno solo no alcanza para un punto.
 */
export class ListOrdersQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  lat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  lng?: number;
}
