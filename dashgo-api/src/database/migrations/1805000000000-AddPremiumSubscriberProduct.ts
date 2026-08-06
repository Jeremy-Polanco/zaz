import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `products.is_premium_subscriber_product` — marca EL producto alquilado que se
 * entrega gratis al activarse una suscripción premium.
 *
 * Índice único parcial igual que el del bebedero por defecto: si dos productos
 * llevaran la marca, "cuál es el producto premium" no tendría respuesta
 * determinística y se entregaría uno u otro según el orden físico de las filas.
 */
export class AddPremiumSubscriberProduct1805000000000
  implements MigrationInterface
{
  name = 'AddPremiumSubscriberProduct1805000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "products"
        ADD COLUMN IF NOT EXISTS "is_premium_subscriber_product" boolean NOT NULL DEFAULT false;
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_products_premium_subscriber_product"
        ON "products" ("is_premium_subscriber_product")
        WHERE "is_premium_subscriber_product" = true;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_products_premium_subscriber_product";
    `);
    await queryRunner.query(`
      ALTER TABLE "products"
        DROP COLUMN IF EXISTS "is_premium_subscriber_product";
    `);
  }
}
