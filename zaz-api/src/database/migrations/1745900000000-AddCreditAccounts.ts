import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCreditAccounts1745900000000 implements MigrationInterface {
  name = 'AddCreditAccounts1745900000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // credit_account table
    await queryRunner.query(`
      CREATE TABLE credit_account (
        user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
        balance_cents INTEGER NOT NULL DEFAULT 0,
        credit_limit_cents INTEGER NOT NULL DEFAULT 0,
        due_date TIMESTAMPTZ NULL,
        currency VARCHAR(3) NOT NULL DEFAULT 'usd',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    // Index for overdue dashboard: accounts with negative balance and a due date
    await queryRunner.query(`
      CREATE INDEX idx_credit_account_overdue
        ON credit_account (due_date)
        WHERE balance_cents < 0
    `);

    // ENUM type for movement types
    await queryRunner.query(`
      CREATE TYPE credit_movement_type AS ENUM (
        'grant', 'charge', 'reversal', 'payment', 'adjustment'
      )
    `);

    // credit_movement table
    await queryRunner.query(`
      CREATE TABLE credit_movement (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        credit_account_id UUID NOT NULL REFERENCES credit_account(user_id) ON DELETE CASCADE,
        type credit_movement_type NOT NULL,
        amount_cents INTEGER NOT NULL,
        order_id UUID NULL REFERENCES orders(id) ON DELETE SET NULL,
        performed_by_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
        note TEXT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    // Index for account history (newest first)
    await queryRunner.query(`
      CREATE INDEX idx_credit_movement_account
        ON credit_movement (credit_account_id, created_at DESC)
    `);

    // Index for reversal lookup by order
    await queryRunner.query(`
      CREATE INDEX idx_credit_movement_order
        ON credit_movement (order_id)
        WHERE order_id IS NOT NULL
    `);

    // Unique partial index for reversal idempotency (ADR-4)
    await queryRunner.query(`
      CREATE UNIQUE INDEX idx_credit_movement_reversal
        ON credit_movement (credit_account_id, order_id)
        WHERE type = 'reversal'
    `);

    // Add credit_applied column to orders
    await queryRunner.query(`
      ALTER TABLE orders
        ADD COLUMN credit_applied NUMERIC(10,2) NOT NULL DEFAULT '0.00'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Remove credit_applied from orders
    await queryRunner.query(`
      ALTER TABLE orders DROP COLUMN credit_applied
    `);

    // Drop indexes before tables
    await queryRunner.query(`DROP INDEX IF EXISTS idx_credit_movement_reversal`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_credit_movement_order`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_credit_movement_account`);

    // Drop credit_movement (before credit_account — respects FK)
    await queryRunner.query(`DROP TABLE credit_movement`);

    // Drop credit_account
    await queryRunner.query(`DROP TABLE credit_account`);

    // Drop ENUM type
    await queryRunner.query(`DROP TYPE credit_movement_type`);

    // Drop overdue index
    await queryRunner.query(`DROP INDEX IF EXISTS idx_credit_account_overdue`);
  }
}
