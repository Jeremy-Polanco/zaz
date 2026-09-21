/**
 * FALLBACK rate — used only for addresses/orders that carry no per-zone
 * taxRate (older cached data, or an address the backend couldn't match to a
 * zone). The real rate comes from the API per address/order (`taxRate` on
 * UserAddress/Order/Invoice) — see `computeTaxCents`/`computeQuotePreviewCents`
 * below, which both accept an explicit `taxRate` and only fall back to this
 * constant when one isn't given. Mirror of the backend's own fallback in
 * dashgo-api/src/common/tax.ts — keep these identical.
 */
export const TAX_RATE = 0.08887

/**
 * Fallback shipping rate, used ONLY if `GET /shipping/rate` cannot be
 * fetched (network error, etc). The real value is the admin-set rate the
 * super admin configures from the panel (see `useShippingRate` in
 * `lib/queries.ts`) — every customer order pays that flat rate, subscribers
 * included (2026-09-14: the subscription's value is the bebedero itself —
 * free rental + no-cost maintenance — not a shipping discount). The only $0
 * case is a system-provisioned subscription order (the bebedero rental),
 * which never goes through this client.
 */
export const DEFAULT_FLAT_SHIPPING_CENTS = 500

/**
 * Compute the quote preview given cent-denominated inputs. Matches the formula
 * in OrdersService.setQuote exactly.
 */
/**
 * Gross (tax-inclusive) cents for a net amount: net + tax. Mirrors
 * computeGrossCents in dashgo-api/src/common/tax.ts. Used to preview the
 * tax-inclusive subscription price the admin types (the backend stores net).
 */
export function computeGrossCents(netCents: number): number {
  return netCents + Math.round(netCents * TAX_RATE)
}

/**
 * Tax on a net (taxable) amount, at the given rate — TAX_RATE (the no-zone
 * fallback) when omitted. Callers that know the address/order's real rate
 * (per-zone) should always pass it explicitly.
 */
export function computeTaxCents(netCents: number, taxRate: number = TAX_RATE): number {
  return Math.round(netCents * taxRate)
}

/**
 * "6.625%" from a decimal rate like 0.06625. Matches the shape the admin/
 * customer UI has always shown ("Impuestos (8.887%)"), just driven by
 * whatever rate applies instead of a hardcoded one.
 */
export function formatTaxRatePct(rate: number): string {
  return `${(rate * 100).toFixed(3)}%`
}

export function computeQuotePreviewCents(input: {
  subtotalCents: number
  shippingCents: number
  pointsRedeemedCents: number
  /**
   * Parte del subtotal que SÍ paga impuesto (líneas con `taxCategory`
   * 'standard'). Si se omite, se asume que todo es gravable — el
   * comportamiento histórico, y el que nunca cobra de menos.
   */
  taxableSubtotalCents?: number
  /**
   * Tasa de impuesto de la dirección/orden (ej. 0.06625 en Elizabeth NJ).
   * Si se omite, cae al fallback TAX_RATE — nunca asumir 8.887% cuando la
   * dirección seleccionada ya trae su propia tasa.
   */
  taxRate?: number
}): {
  taxableCents: number
  taxCents: number
  totalCents: number
  /** La tasa efectivamente usada — TAX_RATE cuando no se pasó ninguna. */
  taxRate: number
} {
  const taxableSubtotalCents = input.taxableSubtotalCents ?? input.subtotalCents
  const taxRate = input.taxRate ?? TAX_RATE

  // Envío y puntos se prorratean por la parte gravable del pedido. Espejo de
  // computeTaxableBase en dashgo-api/src/common/tax.ts.
  const taxableShare =
    input.subtotalCents > 0 ? taxableSubtotalCents / input.subtotalCents : 0
  const taxableShippingCents = Math.round(input.shippingCents * taxableShare)
  const pointsOnTaxableCents = Math.round(
    input.pointsRedeemedCents * taxableShare,
  )

  const taxableCents = Math.max(
    0,
    taxableSubtotalCents + taxableShippingCents - pointsOnTaxableCents,
  )
  const taxCents = computeTaxCents(taxableCents, taxRate)
  // El neto que paga el cliente descuenta TODOS los puntos; el prorrateo solo
  // reparte el descuento entre la mitad gravada y la exenta.
  const netCents = Math.max(
    0,
    input.subtotalCents + input.shippingCents - input.pointsRedeemedCents,
  )
  const totalCents = netCents + taxCents
  return { taxableCents, taxCents, totalCents, taxRate }
}
