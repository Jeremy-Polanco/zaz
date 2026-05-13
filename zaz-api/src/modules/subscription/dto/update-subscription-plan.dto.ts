import { IsInt, Max, Min } from 'class-validator';

export class UpdateSubscriptionPlanDto {
  @IsInt()
  @Min(100)
  @Max(100000)
  unitAmountCents!: number;
}
