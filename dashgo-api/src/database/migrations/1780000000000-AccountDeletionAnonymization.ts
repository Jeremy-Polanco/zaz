import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * FIX C2 — Account deletion (Apple Guideline 5.1.1(v)).
 *
 * To comply with the "in-app account deletion" requirement while keeping the
 * 7-year invoice retention mandated by RD tax law, orders are soft-anonymized
 * instead of hard-deleted when a user removes their account.
 *
 * Changes:
 *   1. orders.customer_id becomes NULLABLE — the FK switches from RESTRICT
 *      to SET NULL so the DB itself enforces the anonymization.
 *   2. Two snapshot columns are added (NULL at rest, populated at deletion).
 *      - customer_name_snapshot: 'Cuenta eliminada' marker
 *      - customer_phone_snapshot: kept null after deletion; reserved here
 *        for symmetry / future expansion.
 *
 * The existing FK constraint is dropped and recreated with the new ON DELETE
 * behavior because PostgreSQL does not allow modifying an existing FK in
 * place.
 */
export class AccountDeletionAnonymization1780000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Snapshot columns first — both nullable, default null.
    await queryRunner.query(`
      ALTER TABLE "orders"
        ADD COLUMN IF NOT EXISTS "customer_name_snapshot" varchar(255),
        ADD COLUMN IF NOT EXISTS "customer_phone_snapshot" varchar(40);
    `);

    // Allow customer_id to be null.
    await queryRunner.query(`
      ALTER TABLE "orders"
        ALTER COLUMN "customer_id" DROP NOT NULL;
    `);

    // Swap the FK from RESTRICT to SET NULL. TypeORM's auto-generated FK
    // name is conventionally "FK_<random hash>"; we look it up dynamically
    // to avoid hard-coding a name that might differ between environments.
    await queryRunner.query(`
      DO $$
      DECLARE
        fk_name text;
      BEGIN
        SELECT conname INTO fk_name
        FROM pg_constraint
        WHERE conrelid = 'orders'::regclass
          AND contype = 'f'
          AND pg_get_constraintdef(oid) LIKE '%customer_id%REFERENCES%users%';
        IF fk_name IS NOT NULL THEN
          EXECUTE 'ALTER TABLE "orders" DROP CONSTRAINT "' || fk_name || '"';
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      ALTER TABLE "orders"
        ADD CONSTRAINT "fk_orders_customer_id"
        FOREIGN KEY ("customer_id") REFERENCES "users"("id")
        ON DELETE SET NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop the SET NULL FK first.
    await queryRunner.query(`
      ALTER TABLE "orders"
        DROP CONSTRAINT IF EXISTS "fk_orders_customer_id";
    `);

    // Backfill any null customer_id rows is impossible — we'd have to invent
    // a user. The migration down assumes the system is being rolled back
    // BEFORE any account has been deleted. If that's not the case, this
    // down() will fail at the NOT NULL constraint addition.
    await queryRunner.query(`
      ALTER TABLE "orders"
        ALTER COLUMN "customer_id" SET NOT NULL;
    `);

    await queryRunner.query(`
      ALTER TABLE "orders"
        ADD CONSTRAINT "fk_orders_customer_id"
        FOREIGN KEY ("customer_id") REFERENCES "users"("id")
        ON DELETE RESTRICT;
    `);

    await queryRunner.query(`
      ALTER TABLE "orders"
        DROP COLUMN IF EXISTS "customer_name_snapshot",
        DROP COLUMN IF EXISTS "customer_phone_snapshot";
    `);
  }
}
