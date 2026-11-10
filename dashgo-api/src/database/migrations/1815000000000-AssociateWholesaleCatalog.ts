import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Catálogo mayorista para asociados.
 *
 * - `products.associate_price_cents`: precio fijo que paga un asociado. NULL
 *   (el default de todo producto existente) = no se ofrece a asociados, así
 *   que la migración no cambia nada del catálogo actual. El CHECK exige > 0:
 *   a diferencia del precio de suscriptor, "gratis" no es un precio mayorista.
 * - `orders.associate_pricing`: congela que la orden se vendió a precio
 *   mayorista (no alimenta el pool de puntos). Las órdenes existentes quedan
 *   en false.
 */
export class AssociateWholesaleCatalog1815000000000
  implements MigrationInterface
{
  name = 'AssociateWholesaleCatalog1815000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "products"
        ADD COLUMN IF NOT EXISTS "associate_price_cents" integer;
    `);
    await queryRunner.query(`
      ALTER TABLE "products"
        DROP CONSTRAINT IF EXISTS "CHK_products_associate_price_positive";
    `);
    await queryRunner.query(`
      ALTER TABLE "products"
        ADD CONSTRAINT "CHK_products_associate_price_positive"
        CHECK ("associate_price_cents" IS NULL OR "associate_price_cents" > 0);
    `);
    await queryRunner.query(`
      ALTER TABLE "orders"
        ADD COLUMN IF NOT EXISTS "associate_pricing" boolean NOT NULL DEFAULT false;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "orders"
        DROP COLUMN IF EXISTS "associate_pricing";
    `);
    await queryRunner.query(`
      ALTER TABLE "products"
        DROP CONSTRAINT IF EXISTS "CHK_products_associate_price_positive";
    `);
    await queryRunner.query(`
      ALTER TABLE "products"
        DROP COLUMN IF EXISTS "associate_price_cents";
    `);
  }
}
