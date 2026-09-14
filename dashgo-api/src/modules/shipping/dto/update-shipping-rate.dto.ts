import { IsInt, Max, Min } from 'class-validator';

/**
 * Body de `PUT /shipping/rate`.
 *
 * El tope de $100 no es capricho: el campo va en CENTAVOS y el admin piensa en
 * dólares. Sin techo, un "500" tipeado como si fueran pesos se cobra como $500
 * de envío a toda orden nueva hasta que alguien se dé cuenta. 10000 centavos
 * es un delivery absurdamente caro pero todavía imaginable; cualquier cosa
 * arriba es, casi seguro, el error de unidad.
 */
export class UpdateShippingRateDto {
  @IsInt({ message: 'La tarifa debe ser un número entero de centavos' })
  @Min(0, { message: 'La tarifa no puede ser negativa' })
  @Max(10000, {
    message: 'La tarifa no puede superar los $100 (10000 centavos)',
  })
  shippingCents!: number;
}
