import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `users.maintenance_timer_disabled` — an admin switch to suppress a
 * user's bebedero maintenance timer. When true, rental activation and
 * maintenance resets skip setting `rentals.next_maintenance_at`, so the user
 * never shows as "maintenance due". For subscribers who do not actually hold a
 * physical bebedero. Defaults to false (timer active) for all existing users.
 */
export class AddUserMaintenanceTimerDisabled1791000000000
  implements MigrationInterface
{
  name = 'AddUserMaintenanceTimerDisabled1791000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "maintenance_timer_disabled" boolean NOT NULL DEFAULT false;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN IF EXISTS "maintenance_timer_disabled";
    `);
  }
}
