import { Exclude, Expose } from 'class-transformer';
import type { SubscriptionModel, SubscriptionStatus } from '../../../entities/subscription.entity';

@Exclude()
export class SubscriptionResponseDto {
  @Expose()
  id!: string;

  /** The user this subscription belongs to (required for web admin Dispenser section) */
  @Expose()
  userId!: string;

  @Expose()
  status!: SubscriptionStatus;

  /** 'rental' | 'purchase' — determines Dispenser section branch in web admin */
  @Expose()
  model!: SubscriptionModel;

  @Expose()
  currentPeriodStart!: Date;

  @Expose()
  currentPeriodEnd!: Date;

  @Expose()
  cancelAtPeriodEnd!: boolean;

  @Expose()
  canceledAt!: Date | null;

  /** Set only for model='purchase' rows; null for rentals */
  @Expose()
  purchasedAt!: Date | null;

  // stripeSubscriptionId is excluded (ADR-9)
}
