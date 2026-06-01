import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * FIX HIGH-G6 — Durable AccountDeletion audit table (GDPR defensibility).
 *
 * Creates account_deletions to give the deletion flow a queryable,
 * non-ephemeral trail. The original `logger.warn` was lost on log
 * rotation and could not answer "was this number deleted?" months later.
 *
 * Columns:
 *   id                    uuid pk
 *   hashed_phone          text NOT NULL  — sha256(phone + JWT_SECRET)
 *   hashed_email          text NULL      — sha256(email + JWT_SECRET) when set
 *   stripe_customer_id    text NULL      — kept for ops reconciliation
 *   requested_via         text NULL      — 'in-app' | 'support' | …
 *   created_at            timestamptz NOT NULL DEFAULT NOW()
 *
 * No FK to users — the users row is gone by the time anyone reads this.
 * Indexed by hashed_phone to make "was this phone deleted?" lookups fast.
 */
export class AccountDeletionAudit1780000000200 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "account_deletions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "hashed_phone" text NOT NULL,
        "hashed_email" text,
        "stripe_customer_id" text,
        "requested_via" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk_account_deletions" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_account_deletions_hashed_phone"
        ON "account_deletions" ("hashed_phone");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_account_deletions_hashed_phone";
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS "account_deletions";`);
  }
}
