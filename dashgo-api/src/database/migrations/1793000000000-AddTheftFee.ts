import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the one-time theft / replacement fee:
 *   - products.theft_fee_cents      — configurable per rental product (cents)
 *   - rentals.theft_fee_cents       — snapshot at rental creation
 *   - rentals.theft_fee_charged_at  — set once the fee is charged (guards against
 *                                     double-charging; null = never charged)
 *
 * Charged off-session via RentalsService.chargeTheftFee when a subscriber keeps
 * the rented unit without paying. Defaults to 0 (disabled) for existing rows.
 */
export class AddTheftFee1793000000000 implements MigrationInterface {
  name = 'AddTheftFee1793000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "products"
        ADD COLUMN IF NOT EXISTS "theft_fee_cents" integer NOT NULL DEFAULT 0;
    `);
    await queryRunner.query(`
      ALTER TABLE "rentals"
        ADD COLUMN IF NOT EXISTS "theft_fee_cents" integer NOT NULL DEFAULT 0;
    `);
    await queryRunner.query(`
      ALTER TABLE "rentals"
        ADD COLUMN IF NOT EXISTS "theft_fee_charged_at" timestamptz NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "rentals" DROP COLUMN IF EXISTS "theft_fee_charged_at";
    `);
    await queryRunner.query(`
      ALTER TABLE "rentals" DROP COLUMN IF EXISTS "theft_fee_cents";
    `);
    await queryRunner.query(`
      ALTER TABLE "products" DROP COLUMN IF EXISTS "theft_fee_cents";
    `);
  }
}
