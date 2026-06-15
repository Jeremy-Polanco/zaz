import { IsEnum, IsOptional } from 'class-validator';

/**
 * Filter for the admin "list users" endpoint (GET /users).
 *
 *   ?subscription=active → only users with a currently-active subscription
 *   ?subscription=none   → only users WITHOUT an active subscription
 *   omitted              → all users
 */
export enum UserSubscriptionFilter {
  ACTIVE = 'active',
  NONE = 'none',
}

export class ListUsersQueryDto {
  @IsOptional()
  @IsEnum(UserSubscriptionFilter)
  subscription?: UserSubscriptionFilter;
}
