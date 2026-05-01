import { IsInt, IsISO8601, IsOptional, IsString, Min } from 'class-validator';

export class GrantCreditDto {
  @IsInt()
  @Min(1)
  amountCents!: number;

  @IsOptional()
  @IsString()
  note?: string;

  /**
   * Optional ISO-8601 due-date. Only applied on the FIRST grant (when the
   * account currently has no due_date). Subsequent grants ignore this field —
   * admin must use PATCH /admin/credit-accounts/:userId to override.
   */
  @IsOptional()
  @IsISO8601()
  dueDate?: string;
}
