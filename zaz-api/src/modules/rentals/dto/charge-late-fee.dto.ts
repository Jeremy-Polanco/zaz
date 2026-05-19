import { IsBoolean, IsOptional } from 'class-validator';

export class ChargeLateFeeDto {
  /** When true, cancel the Stripe Subscription after successfully charging the late fee. */
  @IsOptional()
  @IsBoolean()
  alsoCancel?: boolean;
}
