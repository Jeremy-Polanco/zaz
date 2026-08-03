import { IsBoolean, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { UserRole } from '../../../entities/enums';

/**
 * Admin-only patch of another user: el switch del timer de mantenimiento, el
 * rol, y la asignación de vendedor.
 */
export class UpdateUserAdminDto {
  @IsOptional()
  @IsBoolean()
  maintenanceTimerDisabled?: boolean;

  /**
   * Vendedor asignado a este cliente. `null` lo deja sin vendedor.
   *
   * Solo el super admin llega a este DTO — un vendedor NO puede asignarse
   * clientes ni robarle cartera a otro. El servicio además valida que el id
   * apuntado sea realmente un usuario con rol `seller`.
   */
  @IsOptional()
  @IsUUID()
  sellerId?: string | null;

  /** Cambio de rol (p.ej. promover un cliente a vendedor). */
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
}
