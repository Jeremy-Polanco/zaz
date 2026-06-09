import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Correction: the 30-day maintenance rule applies ONLY to bebederos, not to
 * every rental product. An earlier version of SeedBebederoMaintenance flagged
 * all rental-mode products; databases that already ran it have non-bebedero
 * rentals (e.g. bombas de agua) incorrectly flagged and timer-backfilled.
 *
 * Unflags rental products whose name does not look like a bebedero/dispenser
 * and clears the auto-seeded timers on their rentals (only where no real
 * maintenance was ever recorded). No-op on databases that ran the corrected
 * seed. The admin toggles remain the manual override either way.
 */
export class RestrictMaintenanceToBebederos1786000000000
  implements MigrationInterface
{
  name = 'RestrictMaintenanceToBebederos1786000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "products"
         SET "requires_maintenance" = false
       WHERE "pricing_mode" = 'rental'
         AND "requires_maintenance" = true
         AND "name" NOT ILIKE '%bebedero%'
         AND "name" NOT ILIKE '%dispensador%'
         AND "name" NOT ILIKE '%dispenser%';
    `);

    await queryRunner.query(`
      UPDATE "rentals" AS r
         SET "next_maintenance_at" = NULL
        FROM "products" p
       WHERE p."id" = r."product_id"
         AND p."requires_maintenance" = false
         AND r."next_maintenance_at" IS NOT NULL
         AND r."last_maintenance_at" IS NULL;
    `);
  }

  public async down(): Promise<void> {
    // No-op: data correction — re-flag manually via the admin toggles if needed.
  }
}
