import type { UserRole } from './types'

/**
 * Roles que entran al panel `/super`. El vendedor entra, pero a una versión
 * recortada: solo Ruta (pedidos) y Usuarios, y en ambas la API le devuelve
 * únicamente su cartera.
 *
 * Espejo de las decisiones del backend. Ojo: esto es SOLO navegación. Lo que
 * un vendedor puede ver y tocar lo decide el servidor —
 * `OrdersService.buildScope` y `UsersService.findAll`. Esconder un link no es
 * un permiso.
 */
export function isStaff(role: UserRole | undefined | null): boolean {
  return role === 'super_admin_delivery' || role === 'seller'
}

export function isSuperAdmin(role: UserRole | undefined | null): boolean {
  return role === 'super_admin_delivery'
}

export function isSeller(role: UserRole | undefined | null): boolean {
  return role === 'seller'
}

/** Etiqueta del rol para la UI. */
export function roleLabel(role: UserRole | undefined | null): string {
  if (role === 'super_admin_delivery') return 'Reparto'
  if (role === 'seller') return 'Vendedor'
  if (role === 'promoter') return 'Promotor'
  return 'Cliente'
}
