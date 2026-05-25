import { MigrationInterface, QueryRunner } from "typeorm";

export class AddSubscriptionPlan1777680132517 implements MigrationInterface {
    name = 'AddSubscriptionPlan1777680132517'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "subscription_plan" (
                "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                "stripe_product_id" varchar(64) NOT NULL,
                "active_stripe_price_id" varchar(64) NOT NULL,
                "unit_amount_cents" integer NOT NULL,
                "currency" varchar(8) NOT NULL DEFAULT 'usd',
                "interval" varchar(16) NOT NULL DEFAULT 'month',
                "created_at" timestamptz NOT NULL DEFAULT NOW(),
                "updated_at" timestamptz NOT NULL DEFAULT NOW()
            )
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "subscription_plan"`);
    }
}
