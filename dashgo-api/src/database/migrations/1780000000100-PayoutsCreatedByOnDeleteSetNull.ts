import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * FIX HIGH-G5 — payouts.created_by_user_id ON DELETE SET NULL.
 *
 * The original FK was ON DELETE RESTRICT, which broke account deletion for
 * any super_admin who had issued payouts (the deleteAccount transaction
 * would fail at the final users row delete). Switching to SET NULL plus
 * a `created_by_name_snapshot` column preserves the audit display
 * ("issued by Admin X") even after the admin's user row is gone.
 *
 * Changes:
 *   1. Drop the existing RESTRICT FK on payouts.created_by_user_id.
 *   2. Re-add the FK as ON DELETE SET NULL (with created_by_user_id
 *      itself becoming nullable).
 *   3. Add payouts.created_by_name_snapshot text NULL for post-deletion
 *      display. AuthService.deleteAccount fills this column inside the
 *      transaction BEFORE the user row is removed.
 */
export class PayoutsCreatedByOnDeleteSetNull1780000000100
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Snapshot column — nullable, default null. Filled at deletion time
    // for the rows whose admin is being removed.
    await queryRunner.query(`
      ALTER TABLE "payouts"
        ADD COLUMN IF NOT EXISTS "created_by_name_snapshot" text;
    `);

    // Allow created_by_user_id to be null so the SET NULL cascade works.
    await queryRunner.query(`
      ALTER TABLE "payouts"
        ALTER COLUMN "created_by_user_id" DROP NOT NULL;
    `);

    // Drop the existing RESTRICT FK by name, falling back to dynamic
    // lookup if the original constraint name differs between environments.
    await queryRunner.query(`
      DO $$
      DECLARE
        fk_name text;
      BEGIN
        SELECT conname INTO fk_name
        FROM pg_constraint
        WHERE conrelid = 'payouts'::regclass
          AND contype = 'f'
          AND pg_get_constraintdef(oid) LIKE '%created_by_user_id%REFERENCES%users%';
        IF fk_name IS NOT NULL THEN
          EXECUTE 'ALTER TABLE "payouts" DROP CONSTRAINT "' || fk_name || '"';
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      ALTER TABLE "payouts"
        ADD CONSTRAINT "fk_payouts_created_by_user_id"
        FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
        ON DELETE SET NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop the SET NULL FK first.
    await queryRunner.query(`
      ALTER TABLE "payouts"
        DROP CONSTRAINT IF EXISTS "fk_payouts_created_by_user_id";
    `);

    // Backfill null created_by_user_id rows is impossible — we'd have to
    // invent a user. Down assumes the system is rolled back BEFORE any
    // admin who created payouts has been deleted.
    await queryRunner.query(`
      ALTER TABLE "payouts"
        ALTER COLUMN "created_by_user_id" SET NOT NULL;
    `);

    await queryRunner.query(`
      ALTER TABLE "payouts"
        ADD CONSTRAINT "FK_d59786b39d3fcc7db34bd13474e"
        FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
        ON DELETE RESTRICT;
    `);

    await queryRunner.query(`
      ALTER TABLE "payouts"
        DROP COLUMN IF EXISTS "created_by_name_snapshot";
    `);
  }
}
