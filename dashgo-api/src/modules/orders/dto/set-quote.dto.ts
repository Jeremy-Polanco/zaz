import { IsInt, Min } from 'class-validator';

export class SetQuoteDto {
  @IsInt()
  @Min(0)
  shippingCents!: number;
}
