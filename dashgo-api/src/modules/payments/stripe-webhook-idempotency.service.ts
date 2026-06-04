import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import {
  MAX_WEBHOOK_RETRIES,
  StripeWebhookEvent,
} from '../../entities/stripe-webhook-event.entity';

/**
 * Maximum age (in seconds) a Stripe-signed delivery may have when it arrives.
 * This is checked against the `t=` timestamp in the `Stripe-Signature`
 * header — the signed delivery timestamp, NOT `event.created`.
 *
 * `event.created` is the ORIGINAL event creation time and does not advance
 * on Stripe's retry deliveries. Using it as the freshness primary signal
 * silently killed every retry past 5 minutes (Stripe retries for ~3 days).
 *
 * The 5-minute bound here is the replay-attack window: an attacker who
 * captured a signed payload more than 5 minutes ago cannot replay it.
 */
const MAX_SIGNATURE_AGE_SECONDS = 5 * 60;

/**
 * Tolerance for clocks ahead of ours (Stripe's clock vs. ours). A small
 * positive skew is normal NTP drift; rejecting deliveries from more than
 * a minute in the future catches the obvious "forged future timestamp"
 * case without flapping.
 */
const MAX_FUTURE_SKEW_SECONDS = 60;

/**
 * Defence-in-depth bound on `event.created`. Stripe retries for up to ~3
 * days; we accept anything up to that age PROVIDED the signature timestamp
 * is fresh (which is the actual replay guard). This is a sanity ceiling
 * against pathologically misconfigured retries / forged events with a
 * legitimately signed but ancient `created`.
 */
const MAX_EVENT_CREATED_AGE_SECONDS = 3 * 24 * 60 * 60 + 60;

/**
 * Janitor flips `pending` rows whose received_at is older than this and
 * whose retry_count is still 0 into `failed`. The motivation: a crash
 * BETWEEN the INSERT('pending') and the handler's TX commit would otherwise
 * leave a phantom pending row that blocks Stripe retries forever (the row
 * exists, so re-entry is allowed, but Stripe will only retry on a non-2xx
 * response — and our crashed process never sent one). Flipping to `failed`
 * makes the row a normal retry-eligible row again.
 */
const JANITOR_PENDING_GRACE_MS = 10 * 60 * 1000;

/**
 * Minimal shape we need off the Stripe event for idempotency bookkeeping.
 * Avoids a hard dep on Stripe.Event so this service stays testable without
 * the Stripe SDK in the loop.
 */
export interface StripeEventLike {
  id: string;
  type: string;
  /** Unix epoch seconds — Stripe's `event.created` field */
  created: number;
}

export type WebhookOutcome =
  | { status: 'processed' }
  | { status: 'duplicate' }
  | { status: 'failed'; error: Error }
  | { status: 'dead'; error: Error };

@Injectable()
export class StripeWebhookIdempotencyService {
  private readonly logger = new Logger(StripeWebhookIdempotencyService.name);

  constructor(
    @InjectRepository(StripeWebhookEvent)
    private readonly events: Repository<StripeWebhookEvent>,
  ) {}

  /**
   * Parses the unix-epoch `t=` timestamp out of a Stripe-Signature header.
   *
   * The header looks like: `t=1700000000,v1=abc...,v0=def...`. Stripe sets
   * `t` to the time Stripe SIGNED THE DELIVERY (NOT event.created). On a
   * retry, `t` advances; `event.created` does not.
   *
   * Returns null if the header is absent or malformed — callers MUST treat
   * a null result as freshness-unverifiable (we still have signature
   * verification upstream, but the freshness window is the replay guard).
   */
  parseSignatureTimestamp(signatureHeader: string | undefined): number | null {
    if (!signatureHeader) return null;
    const parts = signatureHeader.split(',');
    for (const part of parts) {
      // Trim because Stripe sometimes emits "t=123, v1=..." with a space
      const trimmed = part.trim();
      if (trimmed.startsWith('t=')) {
        const raw = trimmed.slice(2);
        const parsed = Number.parseInt(raw, 10);
        if (Number.isFinite(parsed) && parsed > 0) return parsed;
        return null;
      }
    }
    return null;
  }

  /**
   * Freshness check on the SIGNATURE timestamp (defence: replay attacks)
   * and a sanity ceiling on `event.created` (defence in depth).
   *
   * Throws BadRequestException (mapped to HTTP 400) on violation. Tests
   * pin "now" via the second arg.
   *
   * Critical: the primary freshness signal is the Stripe-Signature `t=`
   * value, NOT event.created. See module-level docstring.
   */
  assertFresh(
    event: StripeEventLike,
    signatureTimestampSeconds: number | null,
    now: Date = new Date(),
  ): void {
    const nowSeconds = Math.floor(now.getTime() / 1000);

    // Primary check: signature delivery freshness (replay window).
    if (signatureTimestampSeconds === null) {
      throw new BadRequestException(
        `Stripe event ${event.id} rejected: missing Stripe-Signature timestamp`,
      );
    }
    const sigAgeSeconds = nowSeconds - signatureTimestampSeconds;
    if (sigAgeSeconds > MAX_SIGNATURE_AGE_SECONDS) {
      throw new BadRequestException(
        `Stripe event ${event.id} rejected: signature age ${sigAgeSeconds}s exceeds ${MAX_SIGNATURE_AGE_SECONDS}s replay window`,
      );
    }
    if (-sigAgeSeconds > MAX_FUTURE_SKEW_SECONDS) {
      throw new BadRequestException(
        `Stripe event ${event.id} rejected: signature ${-sigAgeSeconds}s in the future exceeds ${MAX_FUTURE_SKEW_SECONDS}s skew tolerance`,
      );
    }

    // Defence in depth: cap event.created at the upper bound of Stripe's
    // own retry schedule (~3 days). A `t=` that's fresh + `created` from
    // a year ago is pathological — either a forged delivery whose signature
    // was generated against an old payload, or a serious misconfiguration.
    const createdAgeSeconds = nowSeconds - event.created;
    if (createdAgeSeconds > MAX_EVENT_CREATED_AGE_SECONDS) {
      throw new BadRequestException(
        `Stripe event ${event.id} rejected: event.created age ${createdAgeSeconds}s exceeds ${MAX_EVENT_CREATED_AGE_SECONDS}s ceiling`,
      );
    }
    if (-createdAgeSeconds > MAX_FUTURE_SKEW_SECONDS) {
      throw new BadRequestException(
        `Stripe event ${event.id} rejected: event.created ${-createdAgeSeconds}s in the future exceeds ${MAX_FUTURE_SKEW_SECONDS}s skew tolerance`,
      );
    }
  }

  /**
   * Runs the webhook business logic exactly once for a given Stripe event id,
   * with safe semantics for concurrent deliveries and Stripe-driven retries.
   *
   * Flow (single transaction):
   *
   *   0. BEGIN.
   *   1. Acquire postgres advisory lock keyed by `stripe_evt:{event.id}`
   *      with `pg_advisory_xact_lock`. Two concurrent deliveries serialise
   *      here; the second one waits until the first commits.
   *   2. SELECT existing row by stripe_event_id.
   *        a. NULL    → INSERT new row (status='pending', retry_count=0)
   *        b. processed → COMMIT, return `duplicate` (no re-run)
   *        c. dead      → COMMIT, return `dead`        (no re-run, 500 to Stripe)
   *        d. pending or failed → re-run is allowed, fall through to step 3.
   *   3. Bump retry_count (or set to 1 on first insert). If new value
   *      exceeds MAX_WEBHOOK_RETRIES, set status='dead', COMMIT, return
   *      `dead` (no handler run).
   *   4. Run `handler()` (inside the same TX). On success, mark
   *      status='processed' with processed_at=NOW, COMMIT, return
   *      `processed`. On failure, ROLLBACK; THEN in a separate write,
   *      mark status='failed' with the error captured.
   *
   * The advisory lock is `xact` so it's released automatically at COMMIT
   * or ROLLBACK — no leak risk.
   */
  async runOnce(
    event: StripeEventLike,
    handler: () => Promise<void>,
  ): Promise<WebhookOutcome> {
    type FastReturn =
      | { kind: 'fast'; outcome: WebhookOutcome }
      | { kind: 'run'; retryCount: number };

    // We MUST type the let as the open union so the compiler does not narrow
    // it to {kind:'run'} from the initialiser. If we let TS infer, the
    // post-transaction `kind === 'fast'` check becomes unreachable and TS
    // reports TS2367/TS2339. The explicit annotation keeps both arms live.
    let runDecision: FastReturn = { kind: 'run', retryCount: 0 } as FastReturn;

    // Decision TX: lock + read + write. If THIS throws (DB outage,
    // advisory-lock contention, etc.) we have NOT run the handler, and
    // the error propagates to the controller which 500s Stripe so the
    // delivery is retried.
    await this.events.manager.transaction(async (tx) => {
      // Step 1 — advisory lock keyed by event id. hashtext() folds the
      // string into a stable 32-bit int that pg_advisory_xact_lock(bigint)
      // accepts. Two simultaneous deliveries for the same event id will
      // serialise here.
      await tx.query(`SELECT pg_advisory_xact_lock(hashtext($1)::bigint)`, [
        `stripe_evt:${event.id}`,
      ]);

      // Step 2 — SELECT existing row inside the locked critical section.
      const existing = await tx
        .createQueryBuilder(StripeWebhookEvent, 'e')
        .where('e.stripeEventId = :id', { id: event.id })
        .getOne();

      if (!existing) {
        // 2a — first time we've seen this event. Insert + run handler.
        await tx.insert(StripeWebhookEvent, {
          stripeEventId: event.id,
          eventType: event.type,
          status: 'pending',
          retryCount: 1,
        });
        runDecision = { kind: 'run', retryCount: 1 };
        return;
      }

      if (existing.status === 'processed') {
        // 2b — already done. Idempotent short-circuit.
        runDecision = { kind: 'fast', outcome: { status: 'duplicate' } };
        return;
      }

      if (existing.status === 'dead') {
        // 2c — exhausted retries previously. Surface as dead again so
        // the controller returns 500 and Stripe ultimately stops trying.
        runDecision = {
          kind: 'fast',
          outcome: {
            status: 'dead',
            error: new Error(
              existing.error ?? 'event previously exhausted retries',
            ),
          },
        };
        return;
      }

      // 2d — pending or failed. Re-drive.
      const nextRetry = existing.retryCount + 1;
      if (nextRetry > MAX_WEBHOOK_RETRIES) {
        // Cap reached. Flip to dead inside the lock and report dead.
        await tx.update(
          StripeWebhookEvent,
          { stripeEventId: event.id },
          { status: 'dead', retryCount: nextRetry },
        );
        runDecision = {
          kind: 'fast',
          outcome: {
            status: 'dead',
            error: new Error(
              `exceeded MAX_WEBHOOK_RETRIES=${MAX_WEBHOOK_RETRIES}`,
            ),
          },
        };
        return;
      }

      // Bump retry_count, reset status back to pending while we re-run.
      // We deliberately do NOT clear `error` here — if the new attempt
      // also fails, markFailed will overwrite with the new error.
      await tx.update(
        StripeWebhookEvent,
        { stripeEventId: event.id },
        { status: 'pending', retryCount: nextRetry },
      );
      runDecision = { kind: 'run', retryCount: nextRetry };
    });

    // Narrow without the no-unsafe-return false positive: pull the outcome
    // into a typed local before returning.
    if (runDecision.kind === 'fast') {
      const outcome: WebhookOutcome = runDecision.outcome;
      return outcome;
    }

    // Step 3 — run the handler in its own TX. Ledger update piggy-backs on
    // the handler's TX so a handler failure cannot leave a `processed` row
    // referencing rolled-back work.
    try {
      await this.events.manager.transaction(async (tx) => {
        await handler();
        await tx.update(
          StripeWebhookEvent,
          { stripeEventId: event.id },
          {
            status: 'processed',
            processedAt: new Date(),
            error: null,
          },
        );
      });
      return { status: 'processed' };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      // Critical: markFailed MUST surface DB errors. Swallowing here would
      // leave the row stuck `pending`, mask a real outage, and make Stripe
      // think we accepted the delivery (we'd return 200).
      await this.markFailed(event.id, error);
      this.logger.error(
        `stripe webhook handler failed for ${event.type} ${event.id} (attempt ${runDecision.retryCount}): ${error.message}`,
        error.stack,
      );
      return { status: 'failed', error };
    }
  }

  /**
   * Marks an event row `failed` with the captured error message.
   *
   * Runs OUTSIDE the rolled-back transaction so the failure is durably
   * recorded even when the handler's TX is aborted. If THIS write also
   * fails (DB outage during error recording), we MUST re-throw — otherwise
   * the controller would 200 Stripe with the row stuck in `pending`,
   * meaning the event silently disappears.
   */
  private async markFailed(stripeEventId: string, error: Error): Promise<void> {
    try {
      await this.events.update(
        { stripeEventId },
        {
          status: 'failed',
          // truncate to avoid pathological multi-MB stack strings
          error: error.message.slice(0, 2000),
        },
      );
    } catch (bookkeepingErr) {
      this.logger.error(
        `failed to mark webhook event ${stripeEventId} as failed — re-throwing so Stripe retries`,
        bookkeepingErr,
      );
      throw new InternalServerErrorException(
        `webhook ledger write failed for ${stripeEventId}: ${(bookkeepingErr as Error).message}`,
      );
    }
  }

  /**
   * Cleanup-cron primitive: delete only `processed` rows past the cutoff.
   *
   * `failed`, `pending`, and `dead` rows are KEPT regardless of age so ops
   * has a forensic trail. (NC-tier review caught the previous bug where we
   * purged failed rows on a 30-day timer.)
   */
  async deleteProcessedOlderThan(cutoff: Date): Promise<number> {
    const result = await this.events.delete({
      status: 'processed',
      processedAt: LessThan(cutoff),
    });
    return result.affected ?? 0;
  }

  /**
   * Janitor primitive: flip stuck `pending` rows to `failed` so Stripe's
   * retry can drive them to completion. A row is stuck if:
   *   - status='pending'
   *   - received_at older than JANITOR_PENDING_GRACE_MS
   *   - retry_count = 0 (never made it past the first INSERT)
   *
   * This catches a crash BETWEEN the INSERT and the handler-TX commit.
   * Without the flip the row would block re-entry forever (the SELECT in
   * runOnce would see `pending`, allow re-run, but the controller would
   * still return 200 the first time so Stripe never retries).
   */
  async janitorFlipStuckPending(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - JANITOR_PENDING_GRACE_MS);
    const result = await this.events.update(
      {
        status: 'pending',
        retryCount: 0,
        receivedAt: LessThan(cutoff),
      },
      {
        status: 'failed',
        error: 'janitor: stuck pending past grace window',
      },
    );
    return result.affected ?? 0;
  }

  // Re-exported for tests that pin the cutoff without hard-coding the number.
  static readonly JANITOR_PENDING_GRACE_MS = JANITOR_PENDING_GRACE_MS;

  // ─── compatibility shim ──────────────────────────────────────────────
  // Older call sites used `deleteOlderThan` and the broader "delete all
  // rows past cutoff" semantics. Keep the export so existing imports
  // compile, but route it to the corrected processed-only purge.
  async deleteOlderThan(cutoff: Date): Promise<number> {
    return this.deleteProcessedOlderThan(cutoff);
  }
}

// Re-export the janitor grace window so cron + tests share a single
// source of truth without reaching into the class.
export { JANITOR_PENDING_GRACE_MS };
