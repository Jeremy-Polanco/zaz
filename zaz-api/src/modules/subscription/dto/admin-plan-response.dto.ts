export class AdminPlanResponseDto {
  id!: string;
  stripeProductId!: string;
  activeStripePriceId!: string;
  unitAmountCents!: number;
  purchasePriceCents!: number;
  lateFeeCents!: number;
  currency!: string;
  interval!: string;
  updatedAt!: Date;
}
