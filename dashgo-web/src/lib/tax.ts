/**
 * Mirror of the backend TAX_RATE in dashgo-api/src/modules/orders/orders.service.ts.
 * Keep these identical — the backend is the source of truth, this is advisory
 * for preview math (quote drawer).
 */
export const TAX_RATE = 0.08887

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
