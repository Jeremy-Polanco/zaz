/**
 * Mirror of the backend TAX_RATE in dashgo-api/src/modules/orders/orders.service.ts.
 * Keep these identical — the backend is the source of truth, this is advisory
 * for preview math (quote bottom sheet).
 */
export const TAX_RATE = 0.08887

/**
 * Fallback ONLY — used when the general delivery rate can't be fetched from
 * the API (GET /shipping/rate). The super admin now controls the real rate
 * from the app; this constant is just what we show if that call fails, so
 * the checkout preview never blanks out. Every customer order ships for a
 * flat fee — subscribers included. The subscription no longer implies free
 * shipping (owner decision, 2026-09-14); it keeps the free bebedero rental,
 * maintenance at no cost, and subscriber prices.
 */
export const DEFAULT_FLAT_SHIPPING_CENTS = 500

/**
 * Gross (tax-inclusive) cents for a net amount: net + tax. Mirrors
 * computeGrossCents in dashgo-api/src/common/tax.ts. The subscription price
 * shown to the customer is gross; the backend already returns it tax-inclusive.
 */
export function computeGrossCents(netCents: number): number {
  return netCents + Math.round(netCents * TAX_RATE)
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
}): {
  taxableCents: number
  taxCents: number
  totalCents: number
} {
  const taxableSubtotalCents = input.taxableSubtotalCents ?? input.subtotalCents

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
  const taxCents = Math.round(taxableCents * TAX_RATE)
  // El neto que paga el cliente descuenta TODOS los puntos; el prorrateo solo
  // reparte el descuento entre la mitad gravada y la exenta.
  const netCents = Math.max(
    0,
    input.subtotalCents + input.shippingCents - input.pointsRedeemedCents,
  )
  const totalCents = netCents + taxCents
  return { taxableCents, taxCents, totalCents }
}
