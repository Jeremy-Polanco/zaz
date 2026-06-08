import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds a per-product `requires_quote` flag.
 *
 * When TRUE (the default — backward compatible), an order containing the
 * product starts in PENDING_QUOTE and the super admin sets shipping manually.
 *
 * When FALSE (e.g. water, standardized bulk delivery), the product needs no
 * manual cotización: an order whose items are ALL `requires_quote = false` is
 * auto-quoted at creation with shipping = $0 and lands directly in QUOTED, so
 * the customer can pay immediately.
 */
export class AddProductRequiresQuote1781000000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "products"
        ADD COLUMN "requires_quote" boolean NOT NULL DEFAULT true;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "products"
        DROP COLUMN IF EXISTS "requires_quote";
    `);
  }
}
