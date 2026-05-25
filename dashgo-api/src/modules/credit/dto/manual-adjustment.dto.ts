import { IsInt, IsNotEmpty, IsString } from 'class-validator';

export class ManualAdjustmentDto {
  /**
   * Signed integer. Positive → add to balance; negative → subtract from balance.
   */
  @IsInt()
  amountCents!: number;

  /** Required for manual adjustments — always provide a reason. */
  @IsString()
  @IsNotEmpty()
  note!: string;
}
