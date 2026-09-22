import type { SubscriptionTier } from '../../entities/subscription-plan.entity';
import type { SubscriptionStatus } from '../../entities/subscription.entity';

/**
 * Domain events emitted around the SaaS subscription lifecycle. Kept in a
 * shared location so emitters (SubscriptionService) and listeners (OrdersModule,
 * RentalsModule) depend on the contract, not on each other — this is what lets
 * side effects like the auto-bebedero provisioning and the plan-delinquency
 * mirror run without a circular module dependency.
 */

/** Fired when a user's subscription is (re)confirmed ACTIVE. */
export const SUBSCRIPTION_ACTIVATED = 'subscription.activated';

export interface SubscriptionActivatedEvent {
  userId: string;
  /**
   * En qué plan quedó. Los listeners deciden qué provisionar según el tier:
   * el bebedero va para todos, el producto exclusivo solo para premium.
   * Opcional para no romper emisores viejos — se asume standard.
   */
  tier?: SubscriptionTier;
}

/**
 * Fired whenever a user's subscription status CHANGES (any transition,
 * including the first time a row is written for that stripeSubscriptionId,
 * where previousStatus is null). Unlike SUBSCRIPTION_ACTIVATED — which only
 * fires on the transition INTO active — this fires on every transition, so
 * listeners that need to react to past_due/unpaid/canceled too (e.g. mirroring
 * plan delinquency onto the $0 bebedero rental it pays for) don't have to
 * re-derive "did the status change" themselves.
 */
export const SUBSCRIPTION_STATUS_CHANGED = 'subscription.status_changed';

export interface SubscriptionStatusChangedEvent {
  userId: string;
  status: SubscriptionStatus;
  previousStatus: SubscriptionStatus | null;
}

/**
 * Fired once at the end of every `reconcileWithStripe` run (never when Stripe
 * is disabled, since nothing was reconciled). Lets listeners re-sweep
 * derived state that only cares about the CURRENT truth, not each individual
 * status transition — e.g. PlanDelinquencyListener re-syncing every $0
 * rental after the hourly reconcile, the same way the SaaS reconcile itself
 * heals a lost webhook.
 */
export const SUBSCRIPTION_RECONCILED = 'subscription.reconciled';

export interface SubscriptionReconciledEvent {
  scanned: number;
  upserted: number;
  skipped: number;
  purged: number;
  failed: number;
}
