import type { UserRole } from './types'

/**
 * Parsea el precio para asociados que escribe el admin. Vacío = sin precio
 * (null). Acepta "," o "." como separador decimal: `parseFloat('4,50')` daría
 * 4 y guardaría $4.00 en silencio.
 */
export function parseAssociatePrice(text: string): {
  cents: number | null
  error: string | null
} {
  const trimmed = text.trim()
  if (trimmed === '') return { cents: null, error: null }
  const value = Number(trimmed.replace(',', '.'))
  if (!Number.isFinite(value) || value <= 0) {
    return { cents: null, error: 'Ingresa un precio mayor a 0' }
  }
  return { cents: Math.round(value * 100), error: null }
}

/**
 * Solo un producto de pago único "normal" puede tener precio para asociados.
 * Misma regla que la API (`canCarryAssociatePrice`).
 */
export function canCarryAssociatePrice(p: {
  pricingMode?: string | null
  isMaintenanceService?: boolean
  isDefaultSubscriberBebedero?: boolean
  isPremiumSubscriberProduct?: boolean
}): boolean {
  return (
    p.pricingMode === 'single_payment' &&
    !p.isMaintenanceService &&
    !p.isDefaultSubscriberBebedero &&
    !p.isPremiumSubscriberProduct
  )
}

/** El asociado no ve la entrada de suscripción salvo que ya tenga una. */
export function showsSubscriptionEntry(
  role: UserRole | null | undefined,
  hasSubscription: boolean,
): boolean {
  return role !== 'associate' || hasSubscription
}

/** El asociado no ve la entrada de alquileres salvo que ya tenga alguno. */
export function showsRentalsEntry(
  role: UserRole | null | undefined,
  hasRentals: boolean,
): boolean {
  return role !== 'associate' || hasRentals
}

/** Clave del catálogo público: el catálogo del asociado difiere del del cliente. */
export function productsQueryKey(
  role: UserRole | null | undefined,
): readonly ['products', 'public', string] {
  return ['products', 'public', role ?? 'guest'] as const
}
