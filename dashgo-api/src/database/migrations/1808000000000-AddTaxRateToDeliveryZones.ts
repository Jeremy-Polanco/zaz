import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tasa de impuesto POR ZONA de reparto.
 *
 * Hasta acá la API cobraba una sola tasa para todo el mundo (8.887%, la
 * constante histórica `TAX_RATE`). Pero el reparto cruza la línea del estado:
 * New Jersey cobra 6.625% y New York City 8.875%. Con una sola tasa se le
 * cobraba de más al cliente de Elizabeth y de menos al del Bronx — y lo que se
 * cobra de menos se paga de la caja propia.
 *
 * El DEFAULT de la columna es 0.08887 A PROPÓSITO: es la constante con la que
 * se cotizó todo lo que ya está en la base. Una zona que el admin cargue mañana
 * y no configure sigue cobrando exactamente lo que cobraba el sistema antes. El
 * dato faltante NUNCA cae en 0: eso sería dejar de cobrar impuesto sin que
 * nadie lo decida.
 *
 * Las órdenes ya emitidas no se tocan: cada una congela su propia
 * `orders.tax_rate` al crearse, así que cambiar la tasa de una zona no
 * re-cotiza nada de lo ya vendido.
 */
export class AddTaxRateToDeliveryZones1808000000000
  implements MigrationInterface
{
  name = 'AddTaxRateToDeliveryZones1808000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "delivery_zones"
        ADD COLUMN IF NOT EXISTS "tax_rate" numeric(6,5) NOT NULL DEFAULT 0.08887;
    `);

    // La tasa es plata: una fracción negativa devolvería impuesto y un 1.5 por
    // confundir "6.625" con "0.06625" cobraría 150%. El CHECK acota el rango a
    // [0, 1) — el 0 sigue siendo válido porque una zona sin impuesto es un dato
    // legítimo, a diferencia de una zona sin configurar (que usa el DEFAULT).
    await queryRunner.query(`
      ALTER TABLE "delivery_zones"
        DROP CONSTRAINT IF EXISTS "CHK_delivery_zones_tax_rate_range";
    `);
    await queryRunner.query(`
      ALTER TABLE "delivery_zones"
        ADD CONSTRAINT "CHK_delivery_zones_tax_rate_range"
        CHECK ("tax_rate" >= 0 AND "tax_rate" < 1);
    `);

    // --- Las tasas reales sobre las zonas ya sembradas -----------------------
    // Se siembra por PREFIJO DE ZIP y no por nombre: el nombre lo edita el
    // admin desde el panel ("Elizabeth NJ" puede pasar a ser "Union County"),
    // el prefijo es el dato que define la jurisdicción. Con el nombre, un
    // renombre dejaría la zona en la tasa por defecto sin que nadie se entere.
    //
    // El `tax_rate = 0.08887` del WHERE es lo que hace la siembra idempotente:
    // sólo toca las zonas que siguen en el DEFAULT. Si el admin ya ajustó una
    // tasa a mano, volver a correr la migración no se la pisa.
    //
    // New Jersey — 6.625% (Elizabeth NJ, 0720x).
    await queryRunner.query(`
      UPDATE "delivery_zones"
        SET "tax_rate" = 0.06625
        WHERE '0720' = ANY("zip_prefixes")
          AND "tax_rate" = 0.08887;
    `);
    // New York City — 8.875% (4% estatal + 4.5% ciudad + 0.375% MCTD).
    // Bronx 104xx, Brooklyn 112xx, Manhattan 100xx-102xx.
    await queryRunner.query(`
      UPDATE "delivery_zones"
        SET "tax_rate" = 0.08875
        WHERE "zip_prefixes" && ARRAY['104','112','100','101','102']::character varying[]
          AND "tax_rate" = 0.08887;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "delivery_zones"
        DROP CONSTRAINT IF EXISTS "CHK_delivery_zones_tax_rate_range";
    `);
    await queryRunner.query(`
      ALTER TABLE "delivery_zones"
        DROP COLUMN IF EXISTS "tax_rate";
    `);
  }
}
