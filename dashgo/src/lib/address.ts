import type { GeoAddress, UserAddress } from './types'

/**
 * Map a saved address (UserAddress) to the delivery-address payload an order
 * expects (backend DeliveryAddressDto). Used when a customer picks one of their
 * saved locations at checkout. `text` is the human-readable line1 (+ line2);
 * the driver-facing note (`instructions`) becomes `reference`. Optional fields
 * are omitted (undefined) rather than null so they pass the DTO's @IsString.
 */
export function userAddressToGeoAddress(addr: UserAddress): {
  text: string
  lat: number
  lng: number
  building?: string
  reference?: string
  postalCode?: string
  // Unlike the other optional fields above, houseNumber is always present
  // (null rather than omitted) — the API's snapshot DTO accepts it, and
  // explicit null is clearer than a silently missing field.
  houseNumber: string | null
} {
  const line2 = (addr.line2 ?? '').trim()
  const text = line2 ? `${addr.line1}, ${line2}` : addr.line1
  const building = (addr.building ?? '').trim()
  const reference = (addr.instructions ?? '').trim()
  const postalCode = (addr.postalCode ?? '').trim()
  const houseNumber = (addr.houseNumber ?? '').trim()
  return {
    text,
    lat: addr.lat,
    lng: addr.lng,
    ...(building ? { building } : {}),
    ...(reference ? { reference } : {}),
    ...(postalCode ? { postalCode } : {}),
    houseNumber: houseNumber ? houseNumber : null,
  }
}

export interface AddressPart {
  label: string
  value: string
}

/**
 * Minimal shape of a saved address (UserAddress) as used by the list/summary
 * formatters below. Distinguished from GeoAddress (an order snapshot, which
 * has `text`/`unit`/`reference`) by the presence of `line1` — a saved
 * address always has one, an order snapshot never does. Unlike GeoAddress,
 * the house number is always shown as its own leading segment (not just a
 * fallback for missing free text), since a saved address's `line1` is
 * customer-entered street info, not a full formatted address.
 */
export interface SavedAddressLike {
  line1: string
  line2?: string | null
  houseNumber?: string | null
  building?: string | null
  postalCode?: string | null
  city?: string | null
  state?: string | null
}

const clean = (v: string | null | undefined): string => (v ?? '').trim()

function isSavedAddressLike(
  addr: GeoAddress | SavedAddressLike,
): addr is SavedAddressLike {
  return 'line1' in addr
}

/**
 * True when `line1` already leads with `houseNumber` as its own token
 * (case/whitespace-insensitive whole-token match — not a substring or
 * prefix check). The API auto-fills `houseNumber` from the geocoder (e.g.
 * "1101") while `line1` is customer-typed and usually already starts with
 * the house number ("1101 Elizabeth Avenue"), so showing "Casa 1101" in
 * front of it would just repeat the same number. "11010 Main" does NOT
 * match "1101" (prefix only, a different token) and "1101-A Main" does NOT
 * match "1101" either (different token) — only an exact leading token
 * counts as a duplicate.
 */
function line1HasLeadingHouseNumber(line1: string, houseNumber: string): boolean {
  const leadingToken = line1.trim().split(/\s+/)[0] ?? ''
  return leadingToken.toLowerCase() === houseNumber.trim().toLowerCase()
}

/**
 * Compact, route-friendly summary for the orders list. The colmado scans this
 * to place a delivery at a glance: house number first, then the visible
 * landmark ("Casa 24 — frente al colmado"). Falls back through partial data,
 * and finally to the free-text address. Also accepts a saved address
 * (UserAddress-shaped) — same house-number-first idea, "Casa 24 · ZIP 07201".
 */
export function formatAddressShort(
  addr: GeoAddress | SavedAddressLike | null | undefined,
): string {
  if (!addr) return 'Sin ubicación'
  const zip = clean(addr.postalCode)
  const zipSuffix = zip ? ` · ZIP ${zip}` : ''
  if (isSavedAddressLike(addr)) {
    const house = clean(addr.houseNumber)
    const line1 = clean(addr.line1)
    const showHouse = house !== '' && !line1HasLeadingHouseNumber(line1, house)
    if (showHouse) return `Casa ${house}${zipSuffix}`
    return line1 ? `${line1}${zipSuffix}` : 'Sin ubicación'
  }
  const house = clean(addr.houseNumber)
  const ref = clean(addr.reference)
  if (house && ref) return `Casa ${house} — ${ref}${zipSuffix}`
  if (house) return `Casa ${house}${zipSuffix}`
  if (ref) return `${ref}${zipSuffix}`
  const text = clean(addr.text)
  return text ? `${text}${zipSuffix}` : 'Sin ubicación'
}

/**
 * One-line address for the orders list: the street / free-text line, then the
 * building and the apartment/floor, joined with " · " (e.g. "Calle 1, Casa 24 ·
 * Edif. 4 · Apto 3B"). Falls back to the house number when there's no free-text,
 * and to "Sin ubicación" when empty. Use addressDetailParts() for the full
 * breakdown (reference, etc.) shown in the order detail.
 *
 * Also accepts a saved address (UserAddress-shaped): house number always
 * leads when present ("Casa 24 · Calle X · Torre B · Apto 3B · ZIP 07201").
 */
export function formatAddressLine(
  addr: GeoAddress | SavedAddressLike | null | undefined,
): string {
  if (!addr) return 'Sin ubicación'
  const zip = clean(addr.postalCode)
  if (isSavedAddressLike(addr)) {
    const house = clean(addr.houseNumber)
    const line1 = clean(addr.line1)
    const showHouse = house !== '' && !line1HasLeadingHouseNumber(line1, house)
    const segments = [
      showHouse ? `Casa ${house}` : '',
      line1,
      clean(addr.building),
      clean(addr.line2),
      zip ? `ZIP ${zip}` : '',
    ].filter(Boolean)
    return segments.length ? segments.join(' · ') : 'Sin ubicación'
  }
  const house = clean(addr.houseNumber)
  const primary = clean(addr.text) || (house ? `Casa ${house}` : '')
  const segments = [
    primary,
    clean(addr.building),
    clean(addr.unit),
    zip ? `ZIP ${zip}` : '',
  ].filter(Boolean)
  return segments.length ? segments.join(' · ') : 'Sin ubicación'
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
