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
  /** When the next bebedero maintenance is due. NULL if this rental doesn't track maintenance. */
  nextMaintenanceAt!: Date | null;
  /** When the last maintenance was completed. NULL until the first one. */
  lastMaintenanceAt!: Date | null;
}
