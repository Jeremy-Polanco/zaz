import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Stripe webhook idempotency + replay protection ledger.
 *
 * Pre-launch audit flagged that the webhook handler did not record processed
 * event ids nor reject stale events. Without this table:
 *   - Stripe retries can double-credit a credit account, double-apply a
 *     refund, or double-mark an order paid.
 *   - A captured signed webhook can be replayed weeks later (signature alone
 *     does not bind the event to a freshness window).
 *
 * Columns mirror StripeWebhookEvent entity. The UNIQUE index on
 * stripe_event_id is the load-bearing constraint — a duplicate Stripe
 * delivery collides at INSERT time and short-circuits re-processing.
 */
export class StripeWebhookEvents1780000000300 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "stripe_webhook_events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "stripe_event_id" text NOT NULL,
        "event_type" text NOT NULL,
        "received_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "processed_at" TIMESTAMP WITH TIME ZONE,
        "status" text NOT NULL DEFAULT 'pending',
        "error" text,
        CONSTRAINT "pk_stripe_webhook_events" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uniq_stripe_webhook_events_stripe_event_id"
        ON "stripe_webhook_events" ("stripe_event_id");
    `);

    // Supports the 30-day retention cleanup cron.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_stripe_webhook_events_received_at"
        ON "stripe_webhook_events" ("received_at");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_stripe_webhook_events_received_at";
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "uniq_stripe_webhook_events_stripe_event_id";
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS "stripe_webhook_events";`);
  }
}
