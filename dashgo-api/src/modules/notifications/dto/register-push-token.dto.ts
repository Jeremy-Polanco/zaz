import { IsIn, IsString, Matches, MaxLength } from 'class-validator';

export class RegisterPushTokenDto {
  /** Expo push token, e.g. ExponentPushToken[xxxxxxxx]. */
  @IsString()
  @MaxLength(128)
  @Matches(/^Expo(nent)?PushToken\[.+\]$/, {
    message: 'token must be an Expo push token',
  })
  token!: string;

  @IsIn(['ios', 'android'])
  platform!: 'ios' | 'android';
}
