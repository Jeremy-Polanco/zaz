import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { SubscriptionTier } from '../../../entities/subscription-plan.entity';

export class UpdateSubscriptionPlanDto {
  /** Qué plan se está editando. Omitido = standard (compatibilidad). */
  @IsOptional()
  @IsEnum(SubscriptionTier)
  tier?: SubscriptionTier;

  @IsInt()
  @Min(100)
  @Max(100000)
  unitAmountCents!: number;
}
