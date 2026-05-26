/**
 * Response shape returned by admin rental endpoints.
 * `daysDelinquent` is computed server-side:
 *   max(0, floor((NOW - currentPeriodEnd) / 86400_000))
 * Only meaningful when status is 'past_due' or 'unpaid'; 0 otherwise.
 */
export class AdminRentalResponseDto {
  id!: string;
  orderId!: string;
  userId!: string;
  userName!: string;
  userPhone!: string | null;
  productId!: string;
  productName!: string;
  status!: string;
  monthlyRentCents!: number;
  lateFeeCents!: number;
  stripeSubscriptionId!: string | null;
  currentPeriodEnd!: Date | null;
  pastDueSince!: Date | null;
  lastLateFeeAt!: Date | null;
  activatedAt!: Date | null;
  canceledAt!: Date | null;
  /** Days overdue since currentPeriodEnd. Computed: max(0, days from currentPeriodEnd to NOW). */
  daysDelinquent!: number;
  createdAt!: Date;
}
