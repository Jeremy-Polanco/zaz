import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { StripeWebhookIdempotencyService } from './stripe-webhook-idempotency.service';

/**
 * Janitor for orphaned `pending` Stripe webhook events.
 *
 * Failure mode caught by NC-tier review:
 *
 *   1. Stripe POSTs an event.
 *   2. runOnce() opens its decision TX, takes the advisory lock, INSERTs
 *      a `pending` row with retry_count=1.
 *   3. The process CRASHES (OOM, k8s eviction, deploy mid-flight) BEFORE
 *      the handler-TX commits — actually, before the decision TX even
 *      commits in extreme cases.
 *   4. Without intervention, Stripe never gets a non-2xx response (we
 *      crashed mid-flight), so its retry counters don't increment normally,
 *      OR Stripe does retry — and the row sits there as `pending` with
 *      retry_count=0 from the crashed-before-commit case, OR pending with
 *      retry_count=1 from the crashed-after-decision-commit case.
 *
 *   In the retry_count=0 case, runOnce() on a retry sees the row, allows
 *   re-entry (pending is re-runnable), bumps to 1, and proceeds. Fine.
 *
 *   But if the decision TX crashed mid-write, or worse, if a future bug
 *   path leaves rows stuck pending, those rows would NEVER get reprocessed
 *   without manual ops intervention.
 *
 *   This janitor closes the gap: any row stuck `pending` for >10 minutes
 *   with retry_count=0 is flipped to `failed`, which makes it eligible for
 *   re-drive on the next Stripe retry without any code-path change.
 *
 * Cadence: every 5 minutes. Cheap query (uses the new (status, received_at)
 * composite index from migration ...400).
 */
@Injectable()
export class StripeWebhookEventJanitorCron {
  private readonly logger = new Logger(StripeWebhookEventJanitorCron.name);

  constructor(private readonly idempotency: StripeWebhookIdempotencyService) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async runJanitor(): Promise<void> {
    try {
      const flipped = await this.idempotency.janitorFlipStuckPending();
      if (flipped > 0) {
        this.logger.warn(
          `stripe webhook janitor: flipped ${flipped} stuck pending row(s) → failed (will be re-driven on next Stripe retry)`,
        );
      }
    } catch (err) {
      this.logger.error(
        `stripe webhook janitor failed: ${(err as Error).message}`,
      );
    }
  }
}
