import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Push notifications (Expo) — device token registry.
 *
 * One row per device; token globally unique (upsert moves a token between
 * users on re-login). ON DELETE CASCADE: deleting a user drops their devices.
 */
export class AddPushTokens1796000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "push_tokens" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "token" varchar(128) NOT NULL,
        "platform" varchar(16) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_push_tokens_token"
        ON "push_tokens" ("token");
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_push_tokens_user_id"
        ON "push_tokens" ("user_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "push_tokens";`);
  }
}
