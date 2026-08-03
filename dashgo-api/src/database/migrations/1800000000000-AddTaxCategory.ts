import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fase 1 de impuestos por producto.
 *
 * `products.tax_category` marca la categoría fiscal ('standard' | 'exempt').
 * Todo lo existente queda en 'standard', que es exactamente el comportamiento
 * de hoy — la migración no cambia ningún precio ni ningún impuesto ya cobrado.
 *
 * `orders.taxable_subtotal` congela la base gravable usada al cotizar. Sin ese
 * número no se puede reconstruir el cálculo meses después: la orden guarda un
 * solo `tax_rate`, y con ítems mixtos (agua exenta + producto gravado) el rate
 * por sí solo ya no explica el impuesto. Esto es lo que salva en una auditoría.
 *
 * Varchar y no boolean a propósito: la exención real de US es
 * (categoría × jurisdicción), no un on/off. Ver `src/common/tax.ts`.
 */
export class AddTaxCategory1800000000000 implements MigrationInterface {
  name = 'AddTaxCategory1800000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "products"
        ADD COLUMN IF NOT EXISTS "tax_category" character varying(20) NOT NULL DEFAULT 'standard';
    `);
    await queryRunner.query(`
      ALTER TABLE "products"
        DROP CONSTRAINT IF EXISTS "CHK_products_tax_category";
    `);
    await queryRunner.query(`
      ALTER TABLE "products"
        ADD CONSTRAINT "CHK_products_tax_category"
        CHECK ("tax_category" IN ('standard', 'exempt'));
    `);
    await queryRunner.query(`
      ALTER TABLE "orders"
        ADD COLUMN IF NOT EXISTS "taxable_subtotal" numeric(10,2) NOT NULL DEFAULT '0';
    `);
    // Backfill: hasta ahora TODO era gravable, así que la base histórica es el
    // subtotal menos los puntos (el envío se sumaba aparte al cotizar). Deja
    // las órdenes viejas consistentes con lo que realmente se les cobró.
    await queryRunner.query(`
      UPDATE "orders"
        SET "taxable_subtotal" = GREATEST(0, "subtotal" - "points_redeemed")
        WHERE "taxable_subtotal" = 0;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "orders"
        DROP COLUMN IF EXISTS "taxable_subtotal";
    `);
    await queryRunner.query(`
      ALTER TABLE "products"
        DROP CONSTRAINT IF EXISTS "CHK_products_tax_category";
    `);
    await queryRunner.query(`
      ALTER TABLE "products"
        DROP COLUMN IF EXISTS "tax_category";
    `);
  }
}
