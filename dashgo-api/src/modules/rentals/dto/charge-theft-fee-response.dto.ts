export class ChargeTheftFeeResponseDto {
  /** Amount charged in cents (= rental.theftFeeCents). */
  chargedCents!: number;
  /** Stripe PaymentIntent ID for the theft-fee charge. */
  paymentIntentId!: string;
  /** True if the Stripe Subscription was canceled as part of this request. */
  subscriptionCanceled!: boolean;
}
