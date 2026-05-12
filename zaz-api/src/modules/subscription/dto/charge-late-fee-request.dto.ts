import { IsBoolean } from 'class-validator';

export class ChargeLateFeeRequestDto {
  @IsBoolean()
  alsoCancel!: boolean;
}
