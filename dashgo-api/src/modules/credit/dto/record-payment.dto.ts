import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class RecordPaymentDto {
  @IsInt()
  @Min(1)
  amountCents!: number;

  @IsOptional()
  @IsString()
  note?: string;
}
