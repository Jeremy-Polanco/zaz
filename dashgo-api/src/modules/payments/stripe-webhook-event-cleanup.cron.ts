import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { StripeWebhookIdempotencyService } from './stripe-webhook-idempotency.service';

/**
 * 30-day retention sweep for the stripe_webhook_events ledger.
 *
 * Scope (NC-tier fix): ONLY rows with status='processed' are purged. The
 * previous behaviour deleted every row past 30 days regardless of status,
 * which obliterated the forensic trail for `failed` and `dead` rows just
 * when ops most needed them (a complaint days/weeks after the incident).
 *
 * - `processed` rows are pure idempotency residue once Stripe's retry
 *   window (~3 days) has passed. 30 days is a comfortable margin.
 * - `failed`, `pending`, and `dead` rows are KEPT INDEFINITELY. They are
 *   rare (handler failures or stuck deliveries), low-volume, and load-
 *   bearing for incident response and Stripe-driven retries.
 *
 * Cadence: 02:30 daily, staggered from LateFeeCron (03:00) to spread DB
 * load. The companion janitor cron runs every 5 min on a separate schedule.
 */
@Injectable()
export class StripeWebhookEventCleanupCron {
  private readonly logger = new Logger(StripeWebhookEventCleanupCron.name);
  private static readonly RETENTION_DAYS = 30;

  constructor(private readonly idempotency: StripeWebhookIdempotencyService) {}

  @Cron('30 2 * * *')
  async runDaily(): Promise<void> {
    const cutoff = new Date(
      Date.now() -
        StripeWebhookEventCleanupCron.RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );
    try {
      const deleted = await this.idempotency.deleteProcessedOlderThan(cutoff);
      this.logger.log(
        `stripe webhook events cleanup: deleted ${deleted} processed row(s) older than ${cutoff.toISOString()}; failed/pending/dead retained for forensics`,
      );
    } catch (err) {
      this.logger.error(
        `stripe webhook events cleanup failed: ${(err as Error).message}`,
      );
    }
  }
}
