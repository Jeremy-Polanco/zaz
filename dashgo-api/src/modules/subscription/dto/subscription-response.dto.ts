import { Exclude, Expose } from 'class-transformer';
import type { SubscriptionStatus } from '../../../entities/subscription.entity';

@Exclude()
export class SubscriptionResponseDto {
  @Expose()
  id!: string;

  @Expose()
  status!: SubscriptionStatus;

  @Expose()
  currentPeriodStart!: Date;

  @Expose()
  currentPeriodEnd!: Date;

  @Expose()
  cancelAtPeriodEnd!: boolean;

  @Expose()
  canceledAt!: Date | null;

  // stripeSubscriptionId is excluded (ADR-9)
}
