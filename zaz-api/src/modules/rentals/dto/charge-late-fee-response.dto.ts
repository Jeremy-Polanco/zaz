export class ChargeLateFeeResponseDto {
  /** Amount charged in cents (= rental.lateFeeCents). */
  chargedCents!: number;
  /** Stripe PaymentIntent ID for the late-fee charge. */
  paymentIntentId!: string;
  /** True if the Stripe Subscription was canceled as part of this request. */
  subscriptionCanceled!: boolean;
}
