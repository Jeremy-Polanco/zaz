import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProductRentalPricing1778680953355 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add rental pricing columns to products
    await queryRunner.query(`
      ALTER TABLE "products"
        ADD COLUMN "pricing_mode" varchar(20) NOT NULL DEFAULT 'single_payment',
        ADD COLUMN "monthly_rent_cents" integer NOT NULL DEFAULT 0,
        ADD COLUMN "late_fee_cents" integer NOT NULL DEFAULT 0,
        ADD COLUMN "stripe_product_id" varchar(64),
        ADD COLUMN "stripe_price_id" varchar(64);
    `);

    // Create the rental_status enum type
    await queryRunner.query(`
      CREATE TYPE rental_status AS ENUM (
        'pending_setup',
        'active',
        'past_due',
        'unpaid',
        'canceled'
      );
    `);

    // Create rentals table
    await queryRunner.query(`
      CREATE TABLE "rentals" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "product_id" uuid NOT NULL,
        "order_id" uuid,
        "stripe_subscription_id" varchar(64) UNIQUE,
        "stripe_price_id" varchar(64) NOT NULL,
        "status" rental_status NOT NULL DEFAULT 'pending_setup',
        "monthly_rent_cents" integer NOT NULL,
        "late_fee_cents" integer NOT NULL,
        "current_period_start" timestamptz,
        "current_period_end" timestamptz,
        "activated_at" timestamptz,
        "canceled_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT NOW(),
        "updated_at" timestamptz NOT NULL DEFAULT NOW(),
        CONSTRAINT "FK_rentals_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_rentals_product" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_rentals_order" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL
      );
    `);

    // Create indexes
    await queryRunner.query(`
      CREATE INDEX "IDX_rentals_user_id" ON "rentals" ("user_id");
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_rentals_status" ON "rentals" ("status");
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_rentals_user_product_status" ON "rentals" ("user_id", "product_id", "status");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_rentals_user_product_status";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_rentals_status";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_rentals_user_id";`);

    // Drop rentals table
    await queryRunner.query(`DROP TABLE IF EXISTS "rentals";`);

    // Drop enum type
    await queryRunner.query(`DROP TYPE IF EXISTS rental_status;`);

    // Remove rental pricing columns from products
    await queryRunner.query(`
      ALTER TABLE "products"
        DROP COLUMN IF EXISTS "stripe_price_id",
        DROP COLUMN IF EXISTS "stripe_product_id",
        DROP COLUMN IF EXISTS "late_fee_cents",
        DROP COLUMN IF EXISTS "monthly_rent_cents",
        DROP COLUMN IF EXISTS "pricing_mode";
    `);
  }
}
