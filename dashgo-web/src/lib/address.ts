import type { GeoAddress } from './types'

export interface AddressPart {
  label: string
  value: string
}

const clean = (v: string | null | undefined): string => (v ?? '').trim()

/**
 * Compact, route-friendly summary for the orders list. The colmado scans this
 * to place a delivery at a glance: house number first, then the visible
 * landmark ("Casa 24 — frente al colmado"). Falls back through partial data,
 * and finally to the free-text address.
 */
export function formatAddressShort(
  addr: GeoAddress | null | undefined,
): string {
  if (!addr) return 'Sin ubicación'
  const house = clean(addr.houseNumber)
  const ref = clean(addr.reference)
  if (house && ref) return `Casa ${house} — ${ref}`
  if (house) return `Casa ${house}`
  if (ref) return ref
  return clean(addr.text) || 'Sin ubicación'
}

/**
 * Full set of structured address fields for the order detail view, in the
 * order a driver reads them. Render-agnostic so web and mobile share the labels
 * and the empty-field skipping. The free-text `text` is shown separately.
 */
export function addressDetailParts(
  addr: GeoAddress | null | undefined,
): AddressPart[] {
  if (!addr) return []
  const parts: AddressPart[] = []
  const house = clean(addr.houseNumber)
  const building = clean(addr.building)
  const unit = clean(addr.unit)
  const ref = clean(addr.reference)
  if (house) parts.push({ label: 'N° de casa', value: house })
  if (building) parts.push({ label: 'Edificio', value: building })
  if (unit) parts.push({ label: 'Apto / Piso', value: unit })
  if (ref) parts.push({ label: 'Referencia', value: ref })
  return parts
}
