import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class UpdateSubscriptionPlanDto {
  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(100000)
  unitAmountCents?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  purchasePriceCents?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  lateFeeCents?: number;
}
