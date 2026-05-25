import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreatePayoutDto {
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Las notas no pueden superar los 500 caracteres' })
  notes?: string;
}
