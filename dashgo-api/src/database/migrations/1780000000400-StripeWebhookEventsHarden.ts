import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase-N hardening of the stripe_webhook_events ledger.
 *
 * Background — the launch audit + a subsequent NC-tier review caught three
 * production bugs in the original ledger design (migration ...300):
 *
 *   NC2  Freshness was clamped against Stripe's `event.created`, which is
 *        the ORIGINAL event creation time. Stripe retries failed deliveries
 *        for ~3 days with exponential backoff, but `event.created` does not
 *        advance on retry — every retry past 5 minutes was silently rejected
 *        as "stale", killing recovery.
 *
 *   NC3  The handler used INSERT('pending')+catch-unique as its idempotency
 *        primitive. The INSERT autocommits before the handler TX runs, so a
 *        second simultaneous delivery for the same event id sees the row,
 *        returns `duplicate`, and 200s Stripe BEFORE the first delivery's
 *        handler finishes. If delivery #1 then fails, the event is gone.
 *        Also: once a row is `failed`, the next Stripe retry collides on
 *        UNIQUE, is reported as duplicate, and we 200 Stripe — failed events
 *        could never recover.
 *
 *   HIGH Cleanup cron deleted ALL rows past 30 days, including `failed`
 *        rows we wanted to keep as a forensic trail.
 *
 * This migration adds:
 *
 *   1. `retry_count` integer column — bumped each time the handler is
 *      re-driven. Capped at MAX_WEBHOOK_RETRIES (5) by the service; rows
 *      that exceed the cap are flipped to `dead`.
 *
 *   2. CHECK constraint binding `processed_at` to the `processed` state.
 *      Catches code paths that try to set processed without a timestamp
 *      (or vice versa) — would otherwise hide silent state corruption.
 *
 *   3. Composite index on `(status, received_at)`. Three callers benefit:
 *      - cleanup cron filters `WHERE status='processed' AND processed_at<X`
 *      - janitor cron filters `WHERE status='pending' AND received_at<X`
 *      - ops dashboards filter by status with a time-range.
 *
 * Backfill: existing rows get retry_count=0. Existing `failed` and `pending`
 * rows continue to be honoured by the new handler (they will be re-run on
 * the next Stripe retry).
 */
export class StripeWebhookEventsHarden1780000000400
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. retry_count column — default 0 so existing rows backfill cleanly.
    await queryRunner.query(`
      ALTER TABLE "stripe_webhook_events"
        ADD COLUMN IF NOT EXISTS "retry_count" integer NOT NULL DEFAULT 0;
    `);

    // 2. Composite index for (status, received_at).
    //
    // Both cleanup-cron and janitor-cron filter on status first then a
    // timestamp. A single composite index serves both query shapes and is
    // strictly better than two single-column indexes (the existing
    // received_at index is preserved for ad-hoc range scans).
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_stripe_webhook_events_status_received_at"
        ON "stripe_webhook_events" ("status", "received_at");
    `);

    // 3. CHECK constraint: processed_at is non-null IFF status='processed'.
    //
    // Drop first if it exists from a prior partial run (defensive — ALTER
    // ADD CONSTRAINT IF NOT EXISTS is Postgres 16+ only, we target 13+).
    await queryRunner.query(`
      ALTER TABLE "stripe_webhook_events"
        DROP CONSTRAINT IF EXISTS "chk_stripe_webhook_events_processed_at";
    `);
    await queryRunner.query(`
      ALTER TABLE "stripe_webhook_events"
        ADD CONSTRAINT "chk_stripe_webhook_events_processed_at"
        CHECK (
          (status = 'processed' AND processed_at IS NOT NULL)
          OR
          (status <> 'processed' AND processed_at IS NULL)
        );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "stripe_webhook_events"
        DROP CONSTRAINT IF EXISTS "chk_stripe_webhook_events_processed_at";
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_stripe_webhook_events_status_received_at";
    `);
    await queryRunner.query(`
      ALTER TABLE "stripe_webhook_events"
        DROP COLUMN IF EXISTS "retry_count";
    `);
  }
}
