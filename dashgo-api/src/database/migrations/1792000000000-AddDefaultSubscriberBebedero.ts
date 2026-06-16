import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `products.is_default_subscriber_bebedero` — marks THE dispenser handed
 * out for free when a user subscribes. The subscription-activated listener
 * auto-creates a free bebedero order for the flagged product. Exactly one
 * product should carry the flag; if none does, no auto-bebedero is created.
 * Defaults to false for all existing products.
 */
export class AddDefaultSubscriberBebedero1792000000000
  implements MigrationInterface
{
  name = 'AddDefaultSubscriberBebedero1792000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "products"
        ADD COLUMN IF NOT EXISTS "is_default_subscriber_bebedero" boolean NOT NULL DEFAULT false;
    `);
    // Partial unique index: at most one product can be the default bebedero.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_products_default_subscriber_bebedero"
        ON "products" ("is_default_subscriber_bebedero")
        WHERE "is_default_subscriber_bebedero" = true;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_products_default_subscriber_bebedero";
    `);
    await queryRunner.query(`
      ALTER TABLE "products"
        DROP COLUMN IF EXISTS "is_default_subscriber_bebedero";
    `);
  }
}
