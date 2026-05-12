import { SubscriptionResponseDto } from './subscription-response.dto';

/**
 * Response shape for GET /admin/users/:userId/subscription.
 * Includes the subscription (or null) plus a boolean indicating whether
 * the user has a Stripe customer ID (= has a payment method on file).
 * The actual stripeCustomerId is not exposed for privacy/security reasons.
 */
export class AdminUserSubscriptionDto {
  subscription!: SubscriptionResponseDto | null;
  /** True if the user has a Stripe customer ID on their account. */
  hasPaymentMethod!: boolean;
}
