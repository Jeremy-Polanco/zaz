import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds a `stripe_payment_intent_id` column to `credit_movement` so customer
 * self-payments via Stripe are idempotent end-to-end. The unique partial index
 * lets two webhook deliveries for the same PaymentIntent collapse into a
 * single PAYMENT movement (UniqueViolation → caught by the service).
 *
 * DOWN: drops the index and column.
 */
export class AddCreditMovementStripeIntent1746200000000 implements MigrationInterface {
  name = 'AddCreditMovementStripeIntent1746200000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE credit_movement
        ADD COLUMN stripe_payment_intent_id VARCHAR(255) NULL
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX idx_credit_movement_stripe_pi
        ON credit_movement (stripe_payment_intent_id)
        WHERE stripe_payment_intent_id IS NOT NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_credit_movement_stripe_pi`);
    await queryRunner.query(
      `ALTER TABLE credit_movement DROP COLUMN IF EXISTS stripe_payment_intent_id`,
    );
  }
}
