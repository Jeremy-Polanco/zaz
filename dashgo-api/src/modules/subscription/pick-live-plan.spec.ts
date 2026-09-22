/**
 * Unit specs for `pickLivePlan` — extraído de
 * `PlanDelinquencyListener.resolvePlanStatus` (R1, bebedero-precio-del-plan).
 * Pura función, sin DB ni Stripe.
 */

import { pickLivePlan } from './pick-live-plan';
import { Subscription, SubscriptionStatus } from '../../entities/subscription.entity';
import { SubscriptionTier } from '../../entities/subscription-plan.entity';

function fakeSubscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: 'sub-db-1',
    userId: 'user-1',
    stripeSubscriptionId: 'sub_plan_1',
    status: SubscriptionStatus.ACTIVE,
    tier: SubscriptionTier.STANDARD,
    currentPeriodStart: new Date('2026-01-01T00:00:00Z'),
    currentPeriodEnd: new Date('2026-02-01T00:00:00Z'),
    cancelAtPeriodEnd: false,
    canceledAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    user: {} as never,
    ...overrides,
  } as Subscription;
}

describe('pickLivePlan', () => {
  it('returns null for an empty array', () => {
    expect(pickLivePlan([])).toBeNull();
  });

  it('a live ACTIVE row beats a stale CANCELED row', () => {
    const liveActive = fakeSubscription({
      id: 'live-active',
      status: SubscriptionStatus.ACTIVE,
      currentPeriodEnd: new Date(Date.now() + 30 * 86400 * 1000),
    });
    const staleCanceled = fakeSubscription({
      id: 'stale-canceled',
      status: SubscriptionStatus.CANCELED,
      currentPeriodEnd: new Date(Date.now() + 365 * 86400 * 1000), // even "newer" — must NOT win
    });

    const result = pickLivePlan([staleCanceled, liveActive]);

    expect(result?.id).toBe('live-active');
  });

  it('a live PAST_DUE row beats a stale row when there is no live ACTIVE row', () => {
    const livePastDue = fakeSubscription({
      id: 'live-past-due',
      status: SubscriptionStatus.PAST_DUE,
      currentPeriodEnd: new Date(Date.now() + 5 * 86400 * 1000),
    });
    const staleActive = fakeSubscription({
      id: 'stale-active',
      status: SubscriptionStatus.ACTIVE,
      currentPeriodEnd: new Date(Date.now() - 5 * 86400 * 1000), // lapsed — not live
    });

    const result = pickLivePlan([staleActive, livePastDue]);

    expect(result?.id).toBe('live-past-due');
  });

  it('falls back to the newest row by currentPeriodEnd when none are live', () => {
    const older = fakeSubscription({
      id: 'older',
      status: SubscriptionStatus.CANCELED,
      currentPeriodEnd: new Date('2026-01-01T00:00:00Z'),
    });
    const newer = fakeSubscription({
      id: 'newer',
      status: SubscriptionStatus.CANCELED,
      currentPeriodEnd: new Date('2026-03-01T00:00:00Z'),
    });

    const result = pickLivePlan([older, newer]);

    expect(result?.id).toBe('newer');
  });

  it('a single live row is returned as-is', () => {
    const only = fakeSubscription({
      id: 'only',
      status: SubscriptionStatus.ACTIVE,
      currentPeriodEnd: new Date(Date.now() + 30 * 86400 * 1000),
    });

    expect(pickLivePlan([only])?.id).toBe('only');
  });
});
