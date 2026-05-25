import { IsISO8601, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class AdjustCreditDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  newLimitCents?: number;

  /**
   * ISO 8601 date string or explicit null to clear the due date.
   */
  @IsOptional()
  @IsISO8601()
  dueDate?: string | null;

  @IsOptional()
  @IsString()
  note?: string;
}
