import { IsEnum, IsOptional } from 'class-validator';

/**
 * Filter for the admin "list users" endpoint (GET /users).
 *
 *   ?subscription=active → users whose subscription still counts: active OR
 *                          past_due (a failed renewal in retry, same rule as pricing)
 *   ?subscription=none   → everyone else
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
