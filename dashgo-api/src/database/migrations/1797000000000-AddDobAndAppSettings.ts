import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Birthday feature:
 *  - users.date_of_birth (nullable date) — optional, captured at signup or in
 *    the profile. Month/day drive the daily BirthdayCron greeting.
 *  - app_settings — tiny key/value store for admin-editable copy (first use:
 *    the birthday push title/body configured from the web Notificar panel).
 */
export class AddDobAndAppSettings1797000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "date_of_birth" date;
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "app_settings" (
        "key" varchar(64) PRIMARY KEY,
        "value" text NOT NULL,
        "updated_at" timestamptz NOT NULL DEFAULT now()
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "date_of_birth";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "app_settings";`);
  }
}
