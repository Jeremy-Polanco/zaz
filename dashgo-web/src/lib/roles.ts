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

/**
 * Roles que compran como cliente (checkout, crédito, banner de mantenimiento).
 * El asociado sigue siendo un cliente más: solo suma el saldo del pool.
 */
export function buysAsClient(role: UserRole | undefined | null): boolean {
  return role === 'client' || role === 'associate'
}

export function isAssociate(role: UserRole | undefined | null): boolean {
  return role === 'associate'
}

/** Etiqueta del rol para la UI. */
export function roleLabel(role: UserRole | undefined | null): string {
  if (role === 'super_admin_delivery') return 'Reparto'
  if (role === 'seller') return 'Vendedor'
  if (role === 'promoter') return 'Promotor'
  if (role === 'associate') return 'Asociado'
  return 'Cliente'
}
