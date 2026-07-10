import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

export const BROADCAST_AUDIENCES = ['all', 'active', 'lapsed'] as const;
export type BroadcastAudience = (typeof BROADCAST_AUDIENCES)[number];

export class BroadcastDto {
  /** Push title — iOS truncates around ~60 chars, keep it short. */
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  title!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(220)
  body!: string;

  /**
   * all    — every user with a registered device
   * active — ordered (non-cancelled) within the last 8 days
   * lapsed — last non-cancelled order is 8+ days old (win-back audience)
   */
  @IsIn(BROADCAST_AUDIENCES)
  audience!: BroadcastAudience;
}
