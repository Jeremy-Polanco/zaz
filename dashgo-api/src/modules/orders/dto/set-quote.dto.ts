import { IsInt, IsOptional, Matches, Min } from 'class-validator';

export class SetQuoteDto {
  @IsInt()
  @Min(0)
  shippingCents!: number;

  /**
   * Recargo por distancia — el "delivery aparte del envío" del cliente lejano.
   * Opcional: omitirlo deja el recargo que la orden ya tenga (re-cotizar no
   * puede borrar plata en silencio). Para sacarlo hay que mandar 0.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  surchargeCents?: number;

  /**
   * Día de reparto que el admin le asigna a la orden, 'YYYY-MM-DD'.
   * `null` lo desasigna; omitirlo lo deja como está.
   *
   * Fecha sin hora a propósito: es el DÍA que le toca al cliente, no un
   * instante. Con hora, la zona horaria correría el día en el borde.
   */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'scheduledDeliveryDate debe tener formato YYYY-MM-DD',
  })
  scheduledDeliveryDate?: string | null;
}
