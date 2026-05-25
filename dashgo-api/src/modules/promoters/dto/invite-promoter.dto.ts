import { IsString, Matches, MinLength } from 'class-validator';

export class InvitePromoterDto {
  @IsString()
  @Matches(/^\+\d{8,15}$/, {
    message: 'El teléfono debe estar en formato E.164 (ej: +18091234567)',
  })
  phone!: string;

  @IsString()
  @MinLength(2, { message: 'El nombre debe tener al menos 2 caracteres' })
  fullName!: string;
}
