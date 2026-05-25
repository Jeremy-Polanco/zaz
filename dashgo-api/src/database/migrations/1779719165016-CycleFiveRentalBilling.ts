import { MigrationInterface, QueryRunner } from 'typeorm';

export class CycleFiveRentalBilling1779719165016 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // past_due_since: write-once timestamp — set when rental first transitions to PAST_DUE.
    // Day 0 for grace period calculation = UTC date of this column.
    await queryRunner.query(`
      ALTER TABLE "rentals"
        ADD COLUMN "past_due_since" timestamptz NULL,
        ADD COLUMN "last_late_fee_at" timestamptz NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "rentals"
        DROP COLUMN IF EXISTS "last_late_fee_at",
        DROP COLUMN IF EXISTS "past_due_since";
    `);
  }
}
