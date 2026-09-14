import { IsUUID, ValidateIf } from 'class-validator';

/**
 * Traspaso de TODA la cartera de un vendedor a otro (o a nadie).
 *
 * `null` desasigna la cartera entera: los clientes quedan sin vendedor, que es
 * lo que el dueño necesita cuando un vendedor se va y todavía no hay reemplazo.
 *
 * Acá NO va `@IsOptional()` — mismo criterio que `SetDeliveryDateDto`: el campo
 * es obligatorio y el `null` tiene que venir explícito. Omitirlo sería un
 * cliente mal escrito, y con `@IsOptional()` pasaría como "desasigná todo" sin
 * que nadie lo haya pedido. Una cartera entera es demasiado caro para adivinar.
 */
export class TransferSellerPortfolioDto {
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  toSellerId!: string | null;
}
