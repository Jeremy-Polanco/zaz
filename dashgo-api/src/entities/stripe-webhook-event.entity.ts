import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Idempotency + replay-protection ledger for incoming Stripe webhook events.
 *
 * The launch audit flagged that the Stripe webhook handler did not record
 * processed event IDs nor reject stale events. Two production-grade risks:
 *
 *   1. Stripe retries — Stripe retries failed deliveries with exponential
 *      backoff for ~3 days. Without an idempotency table, a retry could
 *      re-credit a credit account, re-mark an order paid, double-apply a
 *      refund, etc.
 *
 *   2. Replay attacks — An attacker who captures a signed webhook payload
 *      could replay it weeks later (signature verification still passes).
 *      Rejecting events whose Stripe-Signature `t=` is older than 5 minutes
 *      drops this entire vector.
 *
 * Lifecycle:
 *   pending   → row inserted at receive (or re-entered when re-driving a
 *               previously failed event)
 *   processed → business handler ran successfully; processed_at set
 *   failed    → business handler threw on the latest attempt; error captured;
 *               row will be reprocessed on the next Stripe retry up to
 *               MAX_RETRIES.
 *   dead      → exhausted MAX_RETRIES; do NOT re-run; ops must intervene.
 *
 * Concurrency model:
 *   The webhook handler takes a postgres advisory lock keyed by
 *   `stripe_evt:{event_id}` so that two simultaneous deliveries with the
 *   same Stripe event id serialise cleanly. This prevents the "INSERT
 *   autocommits → second delivery returns duplicate → first handler fails
 *   → event lost" race.
 *
 * Retention:
 *   StripeWebhookEventCleanupCron purges `processed` rows past the
 *   retention window. `failed`, `pending`, and `dead` rows are kept
 *   indefinitely for forensic trail.
 */
export type StripeWebhookEventStatus =
  | 'pending'
  | 'processed'
  | 'failed'
  | 'dead';

/**
 * Upper bound on how many times we re-execute the business handler for the
 * same Stripe event id. Stripe retries failed deliveries with exponential
 * backoff for ~3 days; 5 attempts covers the realistic Stripe schedule and
 * gives us a deterministic dead-letter point.
 */
export const MAX_WEBHOOK_RETRIES = 5;

@Entity('stripe_webhook_events')
@Index('uniq_stripe_webhook_events_stripe_event_id', ['stripeEventId'], {
  unique: true,
})
export class StripeWebhookEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /**
   * The Stripe-issued event id (e.g. `evt_1ABC...`). The UNIQUE constraint
   * on this column is what guarantees a single row per Stripe event. The
   * advisory lock (taken at the start of webhook handling) serialises
   * concurrent deliveries; this constraint is the defence-in-depth seal.
   */
  @Column({ name: 'stripe_event_id', type: 'text' })
  stripeEventId!: string;

  @Column({ name: 'event_type', type: 'text' })
  eventType!: string;

  @CreateDateColumn({ name: 'received_at', type: 'timestamptz' })
  receivedAt!: Date;

  @Column({ name: 'processed_at', type: 'timestamptz', nullable: true })
  processedAt!: Date | null;

  @Column({ type: 'text', default: 'pending' })
  status!: StripeWebhookEventStatus;

  /**
   * Number of times the business handler has been attempted for this event.
   * Bumped on every re-entry (pending/failed → run handler again). When this
   * reaches MAX_WEBHOOK_RETRIES the row is marked `dead` and the controller
   * returns 500 to Stripe so it stops retrying.
   */
  @Column({ name: 'retry_count', type: 'integer', default: 0 })
  retryCount!: number;

  @Column({ type: 'text', nullable: true })
  error!: string | null;
}
