import { IsEnum, IsInt, Max, Min } from 'class-validator';
import { SubscriptionTier } from '../../../entities/subscription-plan.entity';

/**
 * Crear el plan de un tier que todavía no existe. En la práctica, premium —
 * el standard se siembra desde `STRIPE_SUBSCRIPTION_PRICE_ID` al bootear.
 */
export class CreateSubscriptionPlanDto {
  @IsEnum(SubscriptionTier)
  tier!: SubscriptionTier;

  /** Precio NETO mensual en cents. El cliente paga neto + impuesto. */
  @IsInt()
  @Min(100)
  @Max(100000)
  unitAmountCents!: number;
}
