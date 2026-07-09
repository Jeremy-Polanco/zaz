import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Win-back reminders (WinBackCron) — adds `last_order_reminder_at` to users.
 *
 * Stamped when the 8-day inactivity WhatsApp reminder is accepted by Meta.
 * The cron reminds once per lapse: only when this timestamp is NULL or
 * predates the user's most recent order. No index — the daily query already
 * aggregates over orders and runs once a day on a small user table.
 */
export class AddUserLastOrderReminderAt1795000000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "last_order_reminder_at" timestamptz;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN IF EXISTS "last_order_reminder_at";
    `);
  }
}
