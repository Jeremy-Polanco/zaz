import { IsBoolean, IsOptional } from 'class-validator';

/**
 * Admin-only patch of another user. Currently scoped to the bebedero
 * maintenance timer switch; extend as more admin-editable fields appear.
 */
export class UpdateUserAdminDto {
  @IsOptional()
  @IsBoolean()
  maintenanceTimerDisabled?: boolean;
}
