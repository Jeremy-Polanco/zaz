import {
  IsOptional,
  IsString,
  Length,
  Matches,
  MinLength,
} from 'class-validator';

export class VerifyOtpDto {
  @IsString()
  @Matches(/^\+\d{8,15}$/, {
    message: 'El teléfono debe estar en formato E.164 (ej: +18091234567)',
  })
  phone!: string;

  @IsString()
  @Length(6, 6, { message: 'El código debe tener 6 dígitos' })
  code!: string;

  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'El nombre debe tener al menos 2 caracteres' })
  fullName?: string;

  @IsOptional()
  @IsString()
  @Length(8, 8, { message: 'El código de referido debe tener 8 caracteres' })
  referralCode?: string;
}
