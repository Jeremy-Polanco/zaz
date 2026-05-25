import { IsString, Matches } from 'class-validator';

export class SendOtpDto {
  @IsString()
  @Matches(/^\+\d{8,15}$/, {
    message: 'El teléfono debe estar en formato E.164 (ej: +18091234567)',
  })
  phone!: string;
}
