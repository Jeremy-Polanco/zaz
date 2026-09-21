import type { GeoAddress, UserAddress } from './types'

/**
 * Map a saved address (UserAddress) to the delivery-address payload an order
 * expects (backend DeliveryAddressDto). Used when a customer picks one of their
 * saved locations at checkout. `text` is the human-readable line1 (+ line2);
 * the driver-facing note (`instructions`) becomes `reference`. Most optional
 * fields are omitted (undefined) rather than null so they pass the DTO's
 * @IsString. `houseNumber` is the exception: it's always emitted (null when
 * absent) so the frozen order snapshot has the house number even before the
 * server-side merge — DeliveryAddressDto.houseNumber is @IsOptional(), which
 * treats null the same as undefined.
 */
export function userAddressToGeoAddress(addr: UserAddress): {
  text: string
  lat: number
  lng: number
  houseNumber: string | null
  building?: string
  reference?: string
  postalCode?: string
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
    houseNumber: houseNumber || null,
    ...(building ? { building } : {}),
    ...(reference ? { reference } : {}),
    ...(postalCode ? { postalCode } : {}),
  }
}

export interface AddressPart {
  label: string
  value: string
}

const clean = (v: string | null | undefined): string => (v ?? '').trim()

/**
 * Either shape formatAddressShort/formatAddressLine accept: an order/invoice
 * snapshot (GeoAddress, free-text `text`) or one of the customer's saved
 * addresses (UserAddress, structured `line1`/`line2`). Detected by the
 * presence of `line1`, which only UserAddress has.
 */
type FormattableAddress = GeoAddress | UserAddress

function isUserAddress(addr: FormattableAddress): addr is UserAddress {
  return 'line1' in addr
}

/**
 * True when `line1` already begins with `houseNumber` as its own token, so a
 * leading "Casa <n> · " segment would just repeat what's already in the
 * street line (e.g. the API now auto-fills houseNumber "1101" from the
 * geocoder, while line1 is free text customers usually type with the number
 * already in front: "1101 Elizabeth Avenue"). Case/whitespace-insensitive.
 * Must match the WHOLE token, not just a numeric prefix: "11010 Main" does
 * NOT start with "1101" (that's a longer number, not the same one), and
 * "1101-A Ave" does NOT start with "1101" either (the hyphen extends the
 * token into "1101-A", a different door). A houseNumber that itself contains
 * a hyphen (Queens-style, e.g. "120-05") matches as a whole: "120-05 41st
 * Ave" does start with "120-05".
 */
function lineStartsWithHouseNumber(
  line1: string | null | undefined,
  houseNumber: string | null | undefined,
): boolean {
  const line = clean(line1)
  const house = clean(houseNumber)
  if (!line || !house) return false
  if (line.length < house.length) return false
  const prefix = line.slice(0, house.length)
  if (prefix.toLowerCase() !== house.toLowerCase()) return false
  const next = line.charAt(house.length)
  return next === '' || !/[a-zA-Z0-9-]/.test(next)
}

/**
 * Normalizes a GeoAddress or UserAddress into the common field shape the
 * formatters below share, so a saved address renders exactly like an order
 * snapshot (UserAddress.line1 → text, .line2 → unit, .instructions →
 * reference; the rest of the field names already match).
 */
function normalizeAddress(addr: FormattableAddress): {
  text: string
  houseNumber: string | null | undefined
  building: string | null | undefined
  unit: string | null | undefined
  postalCode: string | null | undefined
  reference: string | null | undefined
} {
  if (isUserAddress(addr)) {
    return {
      text: addr.line1,
      houseNumber: addr.houseNumber,
      building: addr.building,
      unit: addr.line2,
      postalCode: addr.postalCode,
      reference: addr.instructions,
    }
  }
  return {
    text: addr.text,
    houseNumber: addr.houseNumber,
    building: addr.building,
    unit: addr.unit,
    postalCode: addr.postalCode,
    reference: addr.reference,
  }
}

/**
 * Compact, route-friendly summary for the orders list. The colmado scans this
 * to place a delivery at a glance: house number first, then the visible
 * landmark ("Casa 24 — frente al colmado"). Falls back through partial data,
 * and finally to the free-text address.
 */
export function formatAddressShort(
  addr: FormattableAddress | null | undefined,
): string {
  if (!addr) return 'Sin ubicación'
  const n = normalizeAddress(addr)
  const house = clean(n.houseNumber)
  const ref = clean(n.reference)
  const zip = clean(n.postalCode)
  const zipSuffix = zip ? ` · ZIP ${zip}` : ''
  if (house && ref) return `Casa ${house} — ${ref}${zipSuffix}`
  if (house) return `Casa ${house}${zipSuffix}`
  if (ref) return `${ref}${zipSuffix}`
  const text = clean(n.text)
  return text ? `${text}${zipSuffix}` : 'Sin ubicación'
}

/**
 * One-line address for the orders table (GeoAddress order/invoice snapshots)
 * and the saved-addresses list (UserAddress). Both join building and
 * apartment/floor the same way, but the two shapes disagree on the house
 * number:
 *  - Order snapshot (GeoAddress): `text` is a single free-typed line the
 *    colmado wrote by hand — it may already include the house number, so
 *    `houseNumber` is only used as a FALLBACK when `text` is empty (unchanged
 *    from the original behavior — driver-facing route lists already rely on
 *    this exact string, e.g. super.orders.tsx).
 *  - Saved address (UserAddress): `houseNumber` and `line1` are distinct
 *    structured fields (separate inputs in UserAddressesPanel), so a house
 *    number is always shown up front, combined with line1, e.g.
 *    "Casa 24 · Calle Duarte 100 · ZIP 07201".
 * Falls back to "Sin ubicación" when nothing is set. Use addressDetailParts()
 * for the full breakdown (reference, etc.) shown in the details modal.
 */
export function formatAddressLine(
  addr: FormattableAddress | null | undefined,
): string {
  if (!addr) return 'Sin ubicación'
  const house = clean(addr.houseNumber)
  const houseSegment = house ? `Casa ${house}` : ''
  if (isUserAddress(addr)) {
    // Skip "Casa <n>" when line1 already leads with that house number
    // (geocoder-filled houseNumber vs. free-typed line1 — see review finding:
    // double-printed house number, e.g. "Casa 1101 · 1101 Elizabeth Avenue").
    const skipHouseSegment = lineStartsWithHouseNumber(addr.line1, addr.houseNumber)
    const segments = [
      skipHouseSegment ? '' : houseSegment,
      clean(addr.line1),
      clean(addr.building),
      clean(addr.line2),
    ].filter(Boolean)
    if (!segments.length) return 'Sin ubicación'
    const zip = clean(addr.postalCode)
    return zip ? `${segments.join(' · ')} · ZIP ${zip}` : segments.join(' · ')
  }
  const primary = clean(addr.text) || houseSegment
  const segments = [primary, clean(addr.building), clean(addr.unit)].filter(
    Boolean,
  )
  if (!segments.length) return 'Sin ubicación'
  const zip = clean(addr.postalCode)
  return zip ? `${segments.join(' · ')} · ZIP ${zip}` : segments.join(' · ')
}

/**
 * "Elizabeth, NJ 07201" from the server-derived city/state/ZIP — the US
 * "City, ST ZIP" convention. Used to show the admin/customer what the backend
 * resolved from reverse geocoding. Any subset may be missing (older data, or
 * an address outside a recognized zone); joins only what's present, and
 * returns '' when nothing is set.
 */
export function formatResolvedPlace(
  addr:
    | { city?: string | null; state?: string | null; postalCode?: string | null }
    | null
    | undefined,
): string {
  if (!addr) return ''
  const cityState = [clean(addr.city), clean(addr.state)].filter(Boolean).join(', ')
  return [cityState, clean(addr.postalCode)].filter(Boolean).join(' ')
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
  const zip = clean(addr.postalCode)
  const ref = clean(addr.reference)
  if (house) parts.push({ label: 'N° de casa', value: house })
  if (building) parts.push({ label: 'Edificio', value: building })
  if (unit) parts.push({ label: 'Apto / Piso', value: unit })
  if (zip) parts.push({ label: 'ZIP', value: zip })
  if (ref) parts.push({ label: 'Referencia', value: ref })
  return parts
}
