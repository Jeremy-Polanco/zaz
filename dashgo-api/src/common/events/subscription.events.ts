/**
 * Domain events emitted around the SaaS subscription lifecycle. Kept in a
 * shared location so emitters (SubscriptionService) and listeners (OrdersModule)
 * depend on the contract, not on each other — this is what lets the
 * auto-bebedero side-effect run without a circular module dependency.
 */

/** Fired when a user's subscription is (re)confirmed ACTIVE. */
export const SUBSCRIPTION_ACTIVATED = 'subscription.activated';

export interface SubscriptionActivatedEvent {
  userId: string;
}
