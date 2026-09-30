import { IsISO8601, Matches, ValidateIf } from 'class-validator';

export class SetDeliveryDateDto {
  /**
   * Día de reparto que el admin le asigna a la orden, 'YYYY-MM-DD'.
   * `null` lo desasigna.
   *
   * Fecha sin hora a propósito: es el DÍA que le toca al cliente, no un
   * instante. Con hora, la zona horaria correría el día en el borde.
   *
   * Acá NO va `@IsOptional()` — el campo es obligatorio y el `null` tiene que
   * venir explícito. Omitirlo sería un cliente mal escrito, no una orden de
   * desasignar, y no puede pasar silenciosamente como si fuese lo mismo.
   */
  @ValidateIf((_, value) => value !== null)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'scheduledDeliveryDate debe tener formato YYYY-MM-DD',
  })
  // El regex sólo valida la FORMA: '2026-02-30' la cumple y Postgres lo rechaza
  // al escribir la columna `date` (500). `strict` exige que el día exista.
  @IsISO8601(
    { strict: true },
    { message: 'scheduledDeliveryDate debe ser un día real del calendario' },
  )
  scheduledDeliveryDate!: string | null;
}
