export class DelinquentSubscriptionDto {
  subscriptionId!: string;
  userId!: string;
  userFullName!: string;
  userPhone!: string | null;
  status!: 'past_due' | 'unpaid';
  currentPeriodEnd!: string;
  daysDelinquent!: number;
  unitAmountCents!: number;
}
