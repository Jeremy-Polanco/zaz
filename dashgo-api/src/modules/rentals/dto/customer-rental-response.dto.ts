/**
 * Response shape returned to a customer for their own rentals.
 * Read-only — no admin-only fields (no stripeSubscriptionId, no lateFeeCents).
 */
export class CustomerRentalResponseDto {
  id!: string;
  productId!: string;
  productName!: string;
  productImageUrl!: string | null;
  monthlyRentCents!: number;
  status!: string;
  /** Next billing date — equal to currentPeriodEnd from the Stripe Subscription. */
  nextChargeAt!: Date | null;
  activatedAt!: Date | null;
}
