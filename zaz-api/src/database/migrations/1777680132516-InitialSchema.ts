import { MigrationInterface, QueryRunner } from "typeorm";

export class InitialSchema1777680132516 implements MigrationInterface {
    name = 'InitialSchema1777680132516'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "categories" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(100) NOT NULL, "slug" character varying(120) NOT NULL, "icon_emoji" character varying(8), "display_order" integer NOT NULL DEFAULT '0', "image_bytes" bytea, "image_content_type" character varying(100), "image_updated_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_8b0be371d28245da6e4f4b61878" UNIQUE ("name"), CONSTRAINT "UQ_420d9f679d41281f282f5bc7d09" UNIQUE ("slug"), CONSTRAINT "PK_24dbc6126a28ff948da33e97d3b" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "products" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(255) NOT NULL, "description" text, "price_to_public" numeric(10,2) NOT NULL, "is_available" boolean NOT NULL DEFAULT true, "stock" integer NOT NULL DEFAULT '0', "image_bytes" bytea, "image_content_type" character varying(100), "image_updated_at" TIMESTAMP WITH TIME ZONE, "promoter_commission_pct" numeric(5,2) NOT NULL DEFAULT '0', "points_pct" numeric(5,2) NOT NULL DEFAULT '1', "category_id" uuid, "offer_label" character varying(40), "offer_discount_pct" numeric(5,2), "offer_starts_at" TIMESTAMP WITH TIME ZONE, "offer_ends_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_0806c755e0aca124e67c0cf6d7d" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "order_items" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "order_id" uuid NOT NULL, "product_id" uuid NOT NULL, "quantity" integer NOT NULL, "price_at_order" numeric(10,2) NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_005269d8574e6fac0493715c308" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."orders_status_enum" AS ENUM('pending_quote', 'quoted', 'pending_validation', 'confirmed_by_colmado', 'in_delivery_route', 'delivered', 'cancelled')`);
        await queryRunner.query(`CREATE TYPE "public"."orders_payment_method_enum" AS ENUM('cash', 'digital')`);
        await queryRunner.query(`CREATE TABLE "orders" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "customer_id" uuid NOT NULL, "status" "public"."orders_status_enum" NOT NULL DEFAULT 'pending_quote', "delivery_address" jsonb NOT NULL, "subtotal" numeric(10,2) NOT NULL DEFAULT '0', "points_redeemed" numeric(10,2) NOT NULL DEFAULT '0', "shipping" numeric(10,2) NOT NULL DEFAULT '0', "tax" numeric(10,2) NOT NULL DEFAULT '0', "tax_rate" numeric(6,5) NOT NULL DEFAULT '0.08887', "total_amount" numeric(10,2) NOT NULL, "credit_applied" numeric(10,2) NOT NULL DEFAULT '0.00', "payment_method" "public"."orders_payment_method_enum" NOT NULL DEFAULT 'cash', "stripe_payment_intent_id" character varying(128), "paid_at" TIMESTAMP WITH TIME ZONE, "quoted_at" TIMESTAMP WITH TIME ZONE, "authorized_at" TIMESTAMP WITH TIME ZONE, "captured_at" TIMESTAMP WITH TIME ZONE, "was_subscriber_at_quote" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_710e2d4957aa5878dfe94e4ac2f" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_772d0ce0473ac2ccfa26060dbe" ON "orders" ("customer_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_775c9f06fc27ae3ff8fb26f2c4" ON "orders" ("status") `);
        await queryRunner.query(`CREATE INDEX "IDX_db623beca8ff9ede5d7d45a9bd" ON "orders" ("stripe_payment_intent_id") `);
        await queryRunner.query(`CREATE TYPE "public"."users_role_enum" AS ENUM('client', 'promoter', 'super_admin_delivery')`);
        await queryRunner.query(`CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "email" character varying(255), "full_name" character varying(255) NOT NULL, "phone" character varying(40), "role" "public"."users_role_enum" NOT NULL DEFAULT 'client', "address_default" jsonb, "referral_code" character varying(10), "referred_by_id" uuid, "stripe_customer_id" character varying(64), "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_5ffbe395603641c29e8ce9b4c97" UNIQUE ("stripe_customer_id"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_e2dd77cb8a46c78d8ea34de039" ON "users" ("email") WHERE "email" IS NOT NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_875541f7dbe1b8565414f9f80b" ON "users" ("phone") WHERE "phone" IS NOT NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_9cd0cc9e7a9f1d76cc8794d12b" ON "users" ("referral_code") WHERE "referral_code" IS NOT NULL`);
        await queryRunner.query(`CREATE TABLE "otp_codes" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "phone" character varying(40) NOT NULL, "code_hash" character varying(255) NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "consumed_at" TIMESTAMP WITH TIME ZONE, "attempts" integer NOT NULL DEFAULT '0', "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_9d0487965ac1837d57fec4d6a26" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_d482c842066eaa6667ee339968" ON "otp_codes" ("phone", "consumed_at") `);
        await queryRunner.query(`CREATE TYPE "public"."points_ledger_entries_type_enum" AS ENUM('earned', 'redeemed', 'expired')`);
        await queryRunner.query(`CREATE TYPE "public"."points_ledger_entries_status_enum" AS ENUM('pending', 'claimable', 'redeemed', 'expired')`);
        await queryRunner.query(`CREATE TABLE "points_ledger_entries" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "type" "public"."points_ledger_entries_type_enum" NOT NULL, "status" "public"."points_ledger_entries_status_enum" NOT NULL, "amount_cents" integer NOT NULL, "order_id" uuid, "claimable_at" TIMESTAMP WITH TIME ZONE, "expires_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_1c232ef24c83dcb7a3a649d4e0a" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_3f1e276875a77c983a166e2703" ON "points_ledger_entries" ("user_id") `);
        await queryRunner.query(`CREATE TABLE "invoices" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "order_id" uuid NOT NULL, "invoice_number" character varying(32) NOT NULL, "subtotal" numeric(10,2) NOT NULL, "points_redeemed" numeric(10,2) NOT NULL DEFAULT '0', "shipping" numeric(10,2) NOT NULL DEFAULT '0', "tax" numeric(10,2) NOT NULL, "tax_rate" numeric(6,5) NOT NULL, "total" numeric(10,2) NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_ea83c3b911906a3578de2340fdf" UNIQUE ("order_id"), CONSTRAINT "UQ_d8f8d3788694e1b3f96c42c36fb" UNIQUE ("invoice_number"), CONSTRAINT "REL_ea83c3b911906a3578de2340fd" UNIQUE ("order_id"), CONSTRAINT "PK_668cef7c22a427fd822cc1be3ce" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "counters" ("key" character varying(64) NOT NULL, "value" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_c6c33328f872db2d0aaabbacbc8" PRIMARY KEY ("key"))`);
        await queryRunner.query(`CREATE TABLE "payouts" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "promoter_id" uuid NOT NULL, "amount_cents" integer NOT NULL, "notes" text, "created_by_user_id" uuid NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_76855dc4f0a6c18c72eea302e87" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_d0cfc7a3787f07147a2b948def" ON "payouts" ("promoter_id") `);
        await queryRunner.query(`CREATE TYPE "public"."promoter_commission_entries_type_enum" AS ENUM('earned', 'paid_out')`);
        await queryRunner.query(`CREATE TYPE "public"."promoter_commission_entries_status_enum" AS ENUM('pending', 'claimable', 'paid')`);
        await queryRunner.query(`CREATE TABLE "promoter_commission_entries" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "promoter_id" uuid NOT NULL, "referred_user_id" uuid, "order_id" uuid, "type" "public"."promoter_commission_entries_type_enum" NOT NULL, "status" "public"."promoter_commission_entries_status_enum" NOT NULL, "amount_cents" integer NOT NULL, "claimable_at" TIMESTAMP WITH TIME ZONE, "payout_id" uuid, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_c3f40e4f7a4cd7112a39e1cd639" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_db69b795f9235559aba2f0f39a" ON "promoter_commission_entries" ("promoter_id") `);
        await queryRunner.query(`CREATE TABLE "credit_account" ("user_id" uuid NOT NULL, "balance_cents" integer NOT NULL DEFAULT '0', "credit_limit_cents" integer NOT NULL DEFAULT '0', "due_date" TIMESTAMP WITH TIME ZONE, "currency" character varying(3) NOT NULL DEFAULT 'usd', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_732c5e2904abfd4fa28cc567979" PRIMARY KEY ("user_id"))`);
        await queryRunner.query(`CREATE TYPE "public"."credit_movement_type_enum" AS ENUM('grant', 'charge', 'reversal', 'payment', 'adjustment', 'adjustment_increase', 'adjustment_decrease')`);
        await queryRunner.query(`CREATE TABLE "credit_movement" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "credit_account_id" uuid NOT NULL, "type" "public"."credit_movement_type_enum" NOT NULL, "amount_cents" integer NOT NULL, "order_id" uuid, "performed_by_user_id" uuid, "note" text, "stripe_payment_intent_id" character varying(255), "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_bdf9b6b4f626beb47afc98e9f5b" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."subscriptions_status_enum" AS ENUM('active', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired')`);
        await queryRunner.query(`CREATE TABLE "subscriptions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "stripe_subscription_id" character varying(64) NOT NULL, "status" "public"."subscriptions_status_enum" NOT NULL, "current_period_start" TIMESTAMP WITH TIME ZONE NOT NULL, "current_period_end" TIMESTAMP WITH TIME ZONE NOT NULL, "cancel_at_period_end" boolean NOT NULL DEFAULT false, "canceled_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_d0a95ef8a28188364c546eb65c1" UNIQUE ("user_id"), CONSTRAINT "UQ_3a2d09d943f39912a01831a9272" UNIQUE ("stripe_subscription_id"), CONSTRAINT "PK_a87248d73155605cf782be9ee5e" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "products" ADD CONSTRAINT "FK_9a5f6868c96e0069e699f33e124" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "order_items" ADD CONSTRAINT "FK_145532db85752b29c57d2b7b1f1" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "order_items" ADD CONSTRAINT "FK_9263386c35b6b242540f9493b00" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "orders" ADD CONSTRAINT "FK_772d0ce0473ac2ccfa26060dbe9" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "users" ADD CONSTRAINT "FK_a78a00605c95ca6737389f6360b" FOREIGN KEY ("referred_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "points_ledger_entries" ADD CONSTRAINT "FK_3f1e276875a77c983a166e27039" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "invoices" ADD CONSTRAINT "FK_ea83c3b911906a3578de2340fdf" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "payouts" ADD CONSTRAINT "FK_d0cfc7a3787f07147a2b948def2" FOREIGN KEY ("promoter_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "payouts" ADD CONSTRAINT "FK_d59786b39d3fcc7db34bd13474e" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "promoter_commission_entries" ADD CONSTRAINT "FK_db69b795f9235559aba2f0f39a4" FOREIGN KEY ("promoter_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "promoter_commission_entries" ADD CONSTRAINT "FK_aac04478b0bad2045ebffaef0ce" FOREIGN KEY ("referred_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "promoter_commission_entries" ADD CONSTRAINT "FK_f21d78fe30ceb3f4779c2a58225" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "promoter_commission_entries" ADD CONSTRAINT "FK_9a46266f4367c363f526af8de4d" FOREIGN KEY ("payout_id") REFERENCES "payouts"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "credit_account" ADD CONSTRAINT "FK_732c5e2904abfd4fa28cc567979" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "credit_movement" ADD CONSTRAINT "FK_d729eaf253dcaa62f4cf2dd5584" FOREIGN KEY ("credit_account_id") REFERENCES "credit_account"("user_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "credit_movement" ADD CONSTRAINT "FK_c6562317d67766c83becdf7a4ae" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "credit_movement" ADD CONSTRAINT "FK_0c865a5dd300537ecd802d4c871" FOREIGN KEY ("performed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "subscriptions" ADD CONSTRAINT "FK_d0a95ef8a28188364c546eb65c1" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "subscriptions" DROP CONSTRAINT "FK_d0a95ef8a28188364c546eb65c1"`);
        await queryRunner.query(`ALTER TABLE "credit_movement" DROP CONSTRAINT "FK_0c865a5dd300537ecd802d4c871"`);
        await queryRunner.query(`ALTER TABLE "credit_movement" DROP CONSTRAINT "FK_c6562317d67766c83becdf7a4ae"`);
        await queryRunner.query(`ALTER TABLE "credit_movement" DROP CONSTRAINT "FK_d729eaf253dcaa62f4cf2dd5584"`);
        await queryRunner.query(`ALTER TABLE "credit_account" DROP CONSTRAINT "FK_732c5e2904abfd4fa28cc567979"`);
        await queryRunner.query(`ALTER TABLE "promoter_commission_entries" DROP CONSTRAINT "FK_9a46266f4367c363f526af8de4d"`);
        await queryRunner.query(`ALTER TABLE "promoter_commission_entries" DROP CONSTRAINT "FK_f21d78fe30ceb3f4779c2a58225"`);
        await queryRunner.query(`ALTER TABLE "promoter_commission_entries" DROP CONSTRAINT "FK_aac04478b0bad2045ebffaef0ce"`);
        await queryRunner.query(`ALTER TABLE "promoter_commission_entries" DROP CONSTRAINT "FK_db69b795f9235559aba2f0f39a4"`);
        await queryRunner.query(`ALTER TABLE "payouts" DROP CONSTRAINT "FK_d59786b39d3fcc7db34bd13474e"`);
        await queryRunner.query(`ALTER TABLE "payouts" DROP CONSTRAINT "FK_d0cfc7a3787f07147a2b948def2"`);
        await queryRunner.query(`ALTER TABLE "invoices" DROP CONSTRAINT "FK_ea83c3b911906a3578de2340fdf"`);
        await queryRunner.query(`ALTER TABLE "points_ledger_entries" DROP CONSTRAINT "FK_3f1e276875a77c983a166e27039"`);
        await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "FK_a78a00605c95ca6737389f6360b"`);
        await queryRunner.query(`ALTER TABLE "orders" DROP CONSTRAINT "FK_772d0ce0473ac2ccfa26060dbe9"`);
        await queryRunner.query(`ALTER TABLE "order_items" DROP CONSTRAINT "FK_9263386c35b6b242540f9493b00"`);
        await queryRunner.query(`ALTER TABLE "order_items" DROP CONSTRAINT "FK_145532db85752b29c57d2b7b1f1"`);
        await queryRunner.query(`ALTER TABLE "products" DROP CONSTRAINT "FK_9a5f6868c96e0069e699f33e124"`);
        await queryRunner.query(`DROP TABLE "subscriptions"`);
        await queryRunner.query(`DROP TYPE "public"."subscriptions_status_enum"`);
        await queryRunner.query(`DROP TABLE "credit_movement"`);
        await queryRunner.query(`DROP TYPE "public"."credit_movement_type_enum"`);
        await queryRunner.query(`DROP TABLE "credit_account"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_db69b795f9235559aba2f0f39a"`);
        await queryRunner.query(`DROP TABLE "promoter_commission_entries"`);
        await queryRunner.query(`DROP TYPE "public"."promoter_commission_entries_status_enum"`);
        await queryRunner.query(`DROP TYPE "public"."promoter_commission_entries_type_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_d0cfc7a3787f07147a2b948def"`);
        await queryRunner.query(`DROP TABLE "payouts"`);
        await queryRunner.query(`DROP TABLE "counters"`);
        await queryRunner.query(`DROP TABLE "invoices"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_3f1e276875a77c983a166e2703"`);
        await queryRunner.query(`DROP TABLE "points_ledger_entries"`);
        await queryRunner.query(`DROP TYPE "public"."points_ledger_entries_status_enum"`);
        await queryRunner.query(`DROP TYPE "public"."points_ledger_entries_type_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_d482c842066eaa6667ee339968"`);
        await queryRunner.query(`DROP TABLE "otp_codes"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_9cd0cc9e7a9f1d76cc8794d12b"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_875541f7dbe1b8565414f9f80b"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_e2dd77cb8a46c78d8ea34de039"`);
        await queryRunner.query(`DROP TABLE "users"`);
        await queryRunner.query(`DROP TYPE "public"."users_role_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_db623beca8ff9ede5d7d45a9bd"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_775c9f06fc27ae3ff8fb26f2c4"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_772d0ce0473ac2ccfa26060dbe"`);
        await queryRunner.query(`DROP TABLE "orders"`);
        await queryRunner.query(`DROP TYPE "public"."orders_payment_method_enum"`);
        await queryRunner.query(`DROP TYPE "public"."orders_status_enum"`);
        await queryRunner.query(`DROP TABLE "order_items"`);
        await queryRunner.query(`DROP TABLE "products"`);
        await queryRunner.query(`DROP TABLE "categories"`);
    }

}
