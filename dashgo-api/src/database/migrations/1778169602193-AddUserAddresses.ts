import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserAddresses1778169602193 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "user_addresses" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "label" varchar(60) NOT NULL,
        "line1" varchar(255) NOT NULL,
        "line2" varchar(255),
        "lat" numeric(10,7) NOT NULL,
        "lng" numeric(10,7) NOT NULL,
        "instructions" text,
        "is_default" boolean NOT NULL DEFAULT false,
        "created_at" timestamptz NOT NULL DEFAULT NOW(),
        "updated_at" timestamptz NOT NULL DEFAULT NOW(),
        CONSTRAINT "fk_user_addresses_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      );
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_user_addresses_user_id" ON "user_addresses" ("user_id");
    `);

    // Idempotent seed from existing User.addressDefault JSONB.
    // Only seeds users that have a non-null addressDefault with text+lat+lng AND
    // who don't already have any user_addresses row (prevents dupes on re-run).
    await queryRunner.query(`
      INSERT INTO "user_addresses" (
        "id", "user_id", "label", "line1", "lat", "lng", "is_default", "created_at", "updated_at"
      )
      SELECT
        gen_random_uuid(),
        u.id,
        'Casa',
        (u.address_default->>'text'),
        COALESCE((u.address_default->>'lat')::numeric, 0),
        COALESCE((u.address_default->>'lng')::numeric, 0),
        true,
        NOW(),
        NOW()
      FROM "users" u
      WHERE u.address_default IS NOT NULL
        AND u.address_default ? 'text'
        AND (u.address_default->>'text') IS NOT NULL
        AND (u.address_default->>'text') <> ''
        AND u.id NOT IN (SELECT user_id FROM "user_addresses");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "user_addresses";`);
  }
}
