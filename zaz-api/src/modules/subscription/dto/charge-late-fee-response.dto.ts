export class ChargeLateFeeResponseDto {
  chargedCents!: number;
  paymentIntentId!: string;
  subscriptionCanceled!: boolean;
}
