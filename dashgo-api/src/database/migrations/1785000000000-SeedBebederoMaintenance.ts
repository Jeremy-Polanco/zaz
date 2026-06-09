import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Data migration: make the bebedero-maintenance feature work out of the box.
 *
 * 1. Seeds the "Mantenimiento de Bebedero" service product (the one the
 *    banner button orders). $0.00 — maintenance is included in the rental;
 *    the admin can set a price later. Skip-quote + untracked stock so the
 *    one-tap order never blocks. Idempotent: only inserts when no
 *    maintenance-service product exists yet.
 * 2. Flags bebedero rental products (matched by name) as requiring
 *    maintenance. Other rentals (e.g. bombas de agua) do NOT carry this
 *    business rule. New activations start the 30-day timer.
 * 3. Backfills the timer for already-active rentals: next maintenance is due
 *    30 days after activation. Rentals activated more than 30 days ago become
 *    overdue immediately (the alert + button show right away).
 */
export class SeedBebederoMaintenance1785000000000 implements MigrationInterface {
  name = 'SeedBebederoMaintenance1785000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "products"
        ("name", "description", "price_to_public", "stock", "requires_quote", "is_maintenance_service")
      SELECT
        'Mantenimiento de Bebedero',
        'Visita de mantenimiento para tu bebedero en alquiler. Sin costo adicional — incluido en tu alquiler.',
        0.00,
        99999,
        false,
        true
      WHERE NOT EXISTS (
        SELECT 1 FROM "products" WHERE "is_maintenance_service" = true
      );
    `);

    await queryRunner.query(`
      UPDATE "products"
         SET "requires_maintenance" = true
       WHERE "pricing_mode" = 'rental'
         AND "requires_maintenance" = false
         AND ("name" ILIKE '%bebedero%'
           OR "name" ILIKE '%dispensador%'
           OR "name" ILIKE '%dispenser%');
    `);

    await queryRunner.query(`
      UPDATE "rentals" AS r
         SET "next_maintenance_at" = r."activated_at" + interval '30 days'
        FROM "products" p
       WHERE p."id" = r."product_id"
         AND p."requires_maintenance" = true
         AND r."status" = 'active'
         AND r."next_maintenance_at" IS NULL
         AND r."activated_at" IS NOT NULL;
    `);
  }

  public async down(): Promise<void> {
    // No-op: data seed/backfill is intentionally not auto-reverted — deleting
    // the maintenance product could orphan order items that reference it.
    // Unflag products / null the timers manually if ever required.
  }
}
