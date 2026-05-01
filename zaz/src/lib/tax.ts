/**
 * Mirror of the backend TAX_RATE in zaz-api/src/modules/orders/orders.service.ts.
 * Keep these identical — the backend is the source of truth, this is advisory
 * for preview math (quote bottom sheet).
 */
export const TAX_RATE = 0.08887

export function computeQuotePreviewCents(input: {
  subtotalCents: number
  shippingCents: number
  pointsRedeemedCents: number
}): {
  taxableCents: number
  taxCents: number
  totalCents: number
} {
  const taxableCents = Math.max(
    0,
    input.subtotalCents + input.shippingCents - input.pointsRedeemedCents,
  )
  const taxCents = Math.round(taxableCents * TAX_RATE)
  const totalCents = taxableCents + taxCents
  return { taxableCents, taxCents, totalCents }
}
