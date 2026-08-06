import { SubscriptionTier } from '../../../entities/subscription-plan.entity';

export class PlanDto {
  /** Qué plan es: standard (el de siempre) o premium. */
  tier!: SubscriptionTier;
  priceCents!: number;
  currency!: 'usd';
  interval!: 'month';
}
