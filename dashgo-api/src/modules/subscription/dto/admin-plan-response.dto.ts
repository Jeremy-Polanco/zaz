export class AdminPlanResponseDto {
  id!: string;
  stripeProductId!: string;
  activeStripePriceId!: string;
  unitAmountCents!: number;
  currency!: string;
  interval!: string;
  updatedAt!: Date;
}
