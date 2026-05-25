/**
 * Entity fixture builders for tests.
 *
 * All builders return plain objects that can be used with manager.save() or
 * with TypeORM's create() + save(). They accept partial overrides so individual
 * tests only need to specify the properties relevant to their scenario.
 *
 * Builders do NOT save to the database — callers control persistence.
 */

import { UserRole, OrderStatus, PaymentMethod } from '../entities/enums';
import { CreditMovementType } from '../entities/credit-movement.entity';
import { SubscriptionStatus } from '../entities/subscription.entity';

// ---------------------------------------------------------------------------
// User
// ---------------------------------------------------------------------------

export interface UserFixture {
  fullName: string;
  email: string | null;
  phone: string | null;
  role: UserRole;
  stripeCustomerId: string | null;
  referralCode: string | null;
  referredById: string | null;
  addressDefault: null;
}

let userSeq = 0;

export function makeUser(
  overrides: Partial<UserFixture> & { role?: UserRole } = {},
): UserFixture {
  userSeq += 1;
  return {
    fullName: `Test User ${userSeq}`,
    email: `user${userSeq}@test.example`,
    phone: `+1555000${String(userSeq).padStart(4, '0')}`,
    role: UserRole.CLIENT,
    stripeCustomerId: null,
    referralCode: null,
    referredById: null,
    addressDefault: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Order
// ---------------------------------------------------------------------------

export interface OrderFixture {
  customerId: string;
  status: OrderStatus;
  deliveryAddress: { text: string };
  subtotal: string;
  pointsRedeemed: string;
  shipping: string;
  tax: string;
  taxRate: string;
  totalAmount: string;
  creditApplied: string;
  paymentMethod: PaymentMethod;
  stripePaymentIntentId: string | null;
  paidAt: Date | null;
  quotedAt: Date | null;
  authorizedAt: Date | null;
  capturedAt: Date | null;
  wasSubscriberAtQuote: boolean;
}

export function makeOrder(
  overrides: Partial<OrderFixture> & { customerId: string },
): OrderFixture {
  const totalAmount = overrides.totalAmount ?? '10.00';
  return {
    customerId: overrides.customerId,
    status: OrderStatus.PENDING_QUOTE,
    deliveryAddress: { text: '123 Test St' },
    subtotal: '10.00',
    pointsRedeemed: '0.00',
    shipping: '0.00',
    tax: '0.00',
    taxRate: '0.08887',
    totalAmount,
    creditApplied: '0.00',
    paymentMethod: PaymentMethod.CASH,
    stripePaymentIntentId: null,
    paidAt: null,
    quotedAt: null,
    authorizedAt: null,
    capturedAt: null,
    wasSubscriberAtQuote: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// CreditAccount
// ---------------------------------------------------------------------------

export interface CreditAccountFixture {
  userId: string;
  balanceCents: number;
  creditLimitCents: number;
  dueDate: Date | null;
  currency: string;
}

export function makeCreditAccount(
  overrides: Partial<CreditAccountFixture> & { userId: string },
): CreditAccountFixture {
  return {
    userId: overrides.userId,
    balanceCents: 0,
    creditLimitCents: 0,
    dueDate: null,
    currency: 'usd',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// CreditMovement
// ---------------------------------------------------------------------------

export interface CreditMovementFixture {
  creditAccountId: string;
  type: CreditMovementType;
  amountCents: number;
  orderId: string | null;
  performedByUserId: string | null;
  note: string | null;
}

export function makeCreditMovement(
  overrides: Partial<CreditMovementFixture> & {
    creditAccountId: string;
    type: CreditMovementType;
    amountCents: number;
  },
): CreditMovementFixture {
  return {
    creditAccountId: overrides.creditAccountId,
    type: overrides.type,
    amountCents: overrides.amountCents,
    orderId: null,
    performedByUserId: null,
    note: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Subscription
// ---------------------------------------------------------------------------

export interface SubscriptionFixture {
  userId: string;
  stripeSubscriptionId: string;
  status: SubscriptionStatus;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  canceledAt: Date | null;
}

let subSeq = 0;

export function makeSubscription(
  overrides: Partial<SubscriptionFixture> & { userId: string },
): SubscriptionFixture {
  subSeq += 1;
  const now = new Date();
  const end = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  return {
    userId: overrides.userId,
    stripeSubscriptionId: `sub_test_${subSeq}`,
    status: SubscriptionStatus.ACTIVE,
    currentPeriodStart: now,
    currentPeriodEnd: end,
    cancelAtPeriodEnd: false,
    canceledAt: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Stripe payload helpers (for webhook test events)
// ---------------------------------------------------------------------------

export interface MockStripeCustomer {
  id: string;
  email: string | null;
  name: string | null;
  metadata: Record<string, string>;
}

export function makeStripeCustomer(
  overrides: Partial<MockStripeCustomer> & { id: string },
): MockStripeCustomer {
  return {
    id: overrides.id,
    email: null,
    name: null,
    metadata: {},
    ...overrides,
  };
}

export interface MockStripeSubscription {
  id: string;
  status: string;
  current_period_start?: number;
  current_period_end?: number;
  items?: { data?: Array<{ current_period_start?: number; current_period_end?: number }> };
  cancel_at_period_end: boolean;
  canceled_at: number | null;
  metadata: Record<string, string>;
}

export function makeStripeSubscription(
  overrides: Partial<MockStripeSubscription> & { id: string; metadata: Record<string, string> },
): MockStripeSubscription {
  const nowUnix = Math.floor(Date.now() / 1000);
  return {
    id: overrides.id,
    status: 'active',
    current_period_start: nowUnix - 86400,
    current_period_end: nowUnix + 86400 * 29,
    cancel_at_period_end: false,
    canceled_at: null,
    metadata: overrides.metadata,
    ...overrides,
  };
}

export interface MockStripeSubscriptionEvent {
  type: string;
  data: {
    object: MockStripeSubscription | Record<string, unknown>;
  };
}

export function makeStripeSubscriptionEvent(
  type: string,
  subscriptionObject: MockStripeSubscription | Record<string, unknown>,
): MockStripeSubscriptionEvent {
  return {
    type,
    data: { object: subscriptionObject },
  };
}

export function makeStripeCheckoutSessionEvent(
  sessionObject: Record<string, unknown>,
): MockStripeSubscriptionEvent {
  return {
    type: 'checkout.session.completed',
    data: { object: sessionObject },
  };
}
