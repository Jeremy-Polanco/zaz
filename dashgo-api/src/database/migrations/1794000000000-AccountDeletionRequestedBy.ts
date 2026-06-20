import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Super-admin user deletion — audit attribution.
 *
 * Adds `requested_by_user_id` to account_deletions so an admin-initiated
 * deletion (requested_via = 'admin') records WHICH super admin performed it.
 * NULL for self-service ('in-app') deletions.
 *
 * No FK to users — both the actor and the deleted target may be gone by the
 * time this row is queried. Indexed so "what did admin X delete?" is fast.
 */
export class AccountDeletionRequestedBy1794000000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "account_deletions"
        ADD COLUMN IF NOT EXISTS "requested_by_user_id" uuid;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_account_deletions_requested_by_user_id"
        ON "account_deletions" ("requested_by_user_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_account_deletions_requested_by_user_id";
    `);
    await queryRunner.query(`
      ALTER TABLE "account_deletions"
        DROP COLUMN IF EXISTS "requested_by_user_id";
    `);
  }
}
