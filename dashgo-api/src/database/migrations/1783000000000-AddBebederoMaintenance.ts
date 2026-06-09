import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Bebedero maintenance countdown.
 *
 * - products.requires_maintenance     → marks a rentable dispenser that needs
 *   periodic (30-day) maintenance. Starts the rental's countdown on activation.
 * - products.is_maintenance_service   → marks THE "Mantenimiento Bebedero"
 *   service product. Delivering an order with this product resets the countdown.
 * - rentals.next_maintenance_at        → when the next maintenance is due
 *   (countdown anchor; timer = next_maintenance_at − now).
 * - rentals.last_maintenance_at        → when the last maintenance completed.
 *
 * Forward-looking: existing active rentals get next_maintenance_at populated on
 * their next activation/maintenance event, not retroactively backfilled.
 */
export class AddBebederoMaintenance1783000000000 implements MigrationInterface {
  name = 'AddBebederoMaintenance1783000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "products"
        ADD COLUMN "requires_maintenance" boolean NOT NULL DEFAULT false,
        ADD COLUMN "is_maintenance_service" boolean NOT NULL DEFAULT false;
    `);

    await queryRunner.query(`
      ALTER TABLE "rentals"
        ADD COLUMN "next_maintenance_at" timestamptz,
        ADD COLUMN "last_maintenance_at" timestamptz;
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_rentals_next_maintenance_at"
        ON "rentals" ("next_maintenance_at");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_rentals_next_maintenance_at";`,
    );
    await queryRunner.query(`
      ALTER TABLE "rentals"
        DROP COLUMN IF EXISTS "last_maintenance_at",
        DROP COLUMN IF EXISTS "next_maintenance_at";
    `);
    await queryRunner.query(`
      ALTER TABLE "products"
        DROP COLUMN IF EXISTS "is_maintenance_service",
        DROP COLUMN IF EXISTS "requires_maintenance";
    `);
  }
}
