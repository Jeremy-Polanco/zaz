import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSubscriptions1746000000000 implements MigrationInterface {
  name = 'AddSubscriptions1746000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // 1. ENUM type
    await queryRunner.query(`
      CREATE TYPE subscription_status AS ENUM (
        'active',
        'past_due',
        'canceled',
        'unpaid',
        'incomplete',
        'incomplete_expired'
      )
    `);

    // 2. subscriptions table
    await queryRunner.query(`
      CREATE TABLE subscriptions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        stripe_subscription_id varchar(64) NOT NULL,
        status subscription_status NOT NULL,
        current_period_start timestamptz NOT NULL,
        current_period_end timestamptz NOT NULL,
        cancel_at_period_end boolean NOT NULL DEFAULT false,
        canceled_at timestamptz NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    // 3. Unique index on user_id (one active subscription per user)
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_subscriptions_user_id
        ON subscriptions(user_id)
    `);

    // 4. Unique index on stripe_subscription_id (idempotency / upsert conflict target)
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_subscriptions_stripe_id
        ON subscriptions(stripe_subscription_id)
    `);

    // 5. Composite index for isActiveSubscriber hot-path query
    await queryRunner.query(`
      CREATE INDEX ix_subscriptions_status_period_end
        ON subscriptions(status, current_period_end)
    `);

    // 6. stripe_customer_id column on users
    await queryRunner.query(`
      ALTER TABLE users
        ADD COLUMN stripe_customer_id varchar(64) NULL
    `);

    // 7. Partial unique index allows multiple NULLs but enforces uniqueness for non-null values
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_users_stripe_customer_id
        ON users(stripe_customer_id)
        WHERE stripe_customer_id IS NOT NULL
    `);

    // 8. was_subscriber_at_quote column on orders
    await queryRunner.query(`
      ALTER TABLE orders
        ADD COLUMN was_subscriber_at_quote boolean NOT NULL DEFAULT false
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Reverse in opposite order
    await queryRunner.query(`
      ALTER TABLE orders
        DROP COLUMN was_subscriber_at_quote
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS uq_users_stripe_customer_id
    `);

    await queryRunner.query(`
      ALTER TABLE users
        DROP COLUMN stripe_customer_id
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS ix_subscriptions_status_period_end
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS uq_subscriptions_stripe_id
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS uq_subscriptions_user_id
    `);

    await queryRunner.query(`DROP TABLE subscriptions`);

    await queryRunner.query(`DROP TYPE subscription_status`);
  }
}
