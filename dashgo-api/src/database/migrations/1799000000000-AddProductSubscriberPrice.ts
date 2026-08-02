import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `products.subscriber_price_cents` — the price an ACTIVE SUBSCRIBER pays
 * for this product. NULL (the default for every existing product) means the
 * product has no subscriber price and everyone pays the catalog/offer price,
 * so this migration is a no-op for current pricing.
 *
 * Nullable ON PURPOSE: 0 is a meaningful value (free for subscribers), so
 * "unset" cannot be encoded as 0. The CHECK keeps it non-negative.
 */
export class AddProductSubscriberPrice1799000000000
  implements MigrationInterface
{
  name = 'AddProductSubscriberPrice1799000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "products"
        ADD COLUMN IF NOT EXISTS "subscriber_price_cents" integer;
    `);
    await queryRunner.query(`
      ALTER TABLE "products"
        DROP CONSTRAINT IF EXISTS "CHK_products_subscriber_price_non_negative";
    `);
    await queryRunner.query(`
      ALTER TABLE "products"
        ADD CONSTRAINT "CHK_products_subscriber_price_non_negative"
        CHECK ("subscriber_price_cents" IS NULL OR "subscriber_price_cents" >= 0);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "products"
        DROP CONSTRAINT IF EXISTS "CHK_products_subscriber_price_non_negative";
    `);
    await queryRunner.query(`
      ALTER TABLE "products"
        DROP COLUMN IF EXISTS "subscriber_price_cents";
    `);
  }
}
