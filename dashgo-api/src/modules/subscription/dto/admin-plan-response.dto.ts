import type { SubscriptionTier } from '../../../entities/subscription-plan.entity';

export class AdminPlanResponseDto {
  id!: string;
  /** Qué plan es: 'standard' o 'premium'. */
  tier!: SubscriptionTier;
  stripeProductId!: string;
  activeStripePriceId!: string;
  /** Net (pre-tax) monthly price — the editable source of truth. */
  unitAmountCents!: number;
  /** Gross (tax-inclusive) price actually charged in Stripe = net + 8.887% tax. */
  grossAmountCents!: number;
  currency!: string;
  interval!: string;
  updatedAt!: Date;
}
