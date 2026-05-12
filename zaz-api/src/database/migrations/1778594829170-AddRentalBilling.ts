import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRentalBilling1778594829170 implements MigrationInterface {
  name = 'AddRentalBilling1778594829170';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "subscriptions"
        ADD COLUMN "model" varchar(16) NOT NULL DEFAULT 'rental',
        ADD COLUMN "stripe_charge_id" varchar(64),
        ADD COLUMN "purchased_at" timestamptz
    `);
    await queryRunner.query(`
      ALTER TABLE "subscription_plan"
        ADD COLUMN "purchase_price_cents" integer NOT NULL DEFAULT 0,
        ADD COLUMN "late_fee_cents" integer NOT NULL DEFAULT 0
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "subscription_plan" DROP COLUMN "late_fee_cents", DROP COLUMN "purchase_price_cents"`,
    );
    await queryRunner.query(
      `ALTER TABLE "subscriptions" DROP COLUMN "purchased_at", DROP COLUMN "stripe_charge_id", DROP COLUMN "model"`,
    );
  }
}
