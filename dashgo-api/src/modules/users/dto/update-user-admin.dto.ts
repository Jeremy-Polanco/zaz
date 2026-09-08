import { IsBoolean, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { UserRole } from '../../../entities/enums';

/**
 * Admin-only patch of another user: el switch del timer de mantenimiento, el
 * rol, y las asignaciones de vendedor y promotor.
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

  /**
   * Promotor al que se le atribuye este cliente. `null` lo deja sin promotor.
   *
   * Hasta ahora esto solo se escribía UNA vez, en el alta, desde el link de
   * referido del promotor (`AuthService.register`). El dueño necesita poder
   * pasarle un cliente ya registrado a un promotor sin rehacer el alta, así
   * que el super admin lo edita como edita `sellerId`. El servicio valida que
   * el id apuntado tenga rol `promoter`.
   */
  @IsOptional()
  @IsUUID()
  referredById?: string | null;

  /** Cambio de rol (p.ej. promover un cliente a vendedor). */
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
}
