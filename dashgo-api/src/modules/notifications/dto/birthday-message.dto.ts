import { IsString, MaxLength, MinLength } from 'class-validator';

/** Birthday push copy — `{nombre}` is replaced with the first name at send. */
export class BirthdayMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  title!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(220)
  body!: string;
}
