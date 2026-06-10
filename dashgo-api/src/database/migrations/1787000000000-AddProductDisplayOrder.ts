import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds a per-product `display_order` column so the super admin controls the
 * order products appear in the customer catalog (web + mobile).
 *
 * Lower number appears first. Mirrors `categories.display_order`. Catalog
 * listings order by `display_order ASC, created_at DESC`.
 */
export class AddProductDisplayOrder1787000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "products"
        ADD COLUMN "display_order" integer NOT NULL DEFAULT 0;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "products"
        DROP COLUMN IF EXISTS "display_order";
    `);
  }
}
