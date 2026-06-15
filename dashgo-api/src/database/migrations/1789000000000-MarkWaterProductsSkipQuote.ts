import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Correction: water products were created relying on the `requires_quote`
 * column default (`true`), so orders for water were NOT flagged skip-cotización.
 * That left them showing the internal "Cotizado/Cotización lista" wording AND,
 * worse, NOT auto-confirming after payment — they got stuck in PENDING_VALIDATION
 * waiting for an admin review they never needed.
 *
 * 1) Flag clearly-water products as `requires_quote = false` (water is a
 *    standardized direct order: shipping $0, pay-on-checkout). Name heuristic
 *    matches the project's existing data-correction style; the admin toggle
 *    ("Requiere cotización") remains the manual override either way.
 * 2) Backfill `skip_quote = true` on still-open orders whose items are ALL
 *    requires_quote=false now — mirrors the creation-time computation
 *    (`items.every(requiresQuote === false)`). Terminal orders are left as-is.
 *
 * No-op on databases where water is already configured correctly.
 */
export class MarkWaterProductsSkipQuote1789000000000
  implements MigrationInterface
{
  name = 'MarkWaterProductsSkipQuote1789000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1) Water products → no cotización.
    await queryRunner.query(`
      UPDATE "products"
         SET "requires_quote" = false
       WHERE "requires_quote" = true
         AND (
              "name" ILIKE '%agua%'
           OR "name" ILIKE '%galón%'
           OR "name" ILIKE '%galon%'
           OR "name" ILIKE '%botellón%'
           OR "name" ILIKE '%botellon%'
           OR "name" ILIKE '%garrafón%'
           OR "name" ILIKE '%garrafon%'
           OR "name" ILIKE '%bidón%'
           OR "name" ILIKE '%bidon%'
         );
    `);

    // 2) Backfill skip_quote on open orders whose items are now all direct
    //    (requires_quote=false). Must run AFTER the product update above.
    await queryRunner.query(`
      UPDATE "orders" o
         SET "skip_quote" = true
       WHERE o."skip_quote" = false
         AND o."status" NOT IN ('delivered', 'cancelled')
         AND EXISTS (
              SELECT 1 FROM "order_items" oi WHERE oi."order_id" = o."id"
         )
         AND NOT EXISTS (
              SELECT 1
                FROM "order_items" oi
                JOIN "products" p ON p."id" = oi."product_id"
               WHERE oi."order_id" = o."id"
                 AND p."requires_quote" = true
         );
    `);
  }

  public async down(): Promise<void> {
    // No-op: data correction — re-flag manually via the admin toggle if needed.
  }
}
