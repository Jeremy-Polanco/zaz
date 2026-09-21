/**
 * FALLBACK rate ONLY — usado cuando una dirección no cae dentro de ninguna
 * zona fiscal conocida (el backend la manda como el `taxRate` "sin zona").
 * La tasa REAL siempre viene del backend por dirección/orden: `taxRate` en
 * cada `UserAddress`/`GeoAddress` que devuelve la API, y `Order.taxRate` /
 * `Invoice.taxRate` — congelada por el servidor al crear la orden. Nunca
 * confiar en una tasa calculada en el cliente para cobrar de verdad; esto es
 * solo para que el preview del checkout no se quede en blanco. Mirror del
 * fallback en dashgo-api/src/common/tax.ts — mantenerlos idénticos.
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
 * Rounded tax on a net amount at the given rate. Mirrors the rounding rule
 * backend-side (round-half-up per line, never accumulate fractional cents).
 * Defaults to the no-zone fallback TAX_RATE; pass the address/order's real
 * `taxRate` whenever one is available.
 */
export function computeTaxCents(
  netCents: number,
  taxRate: number = TAX_RATE,
): number {
  return Math.round(netCents * taxRate)
}

/**
 * Gross (tax-inclusive) cents for a net amount: net + tax. Mirrors
 * computeGrossCents in dashgo-api/src/common/tax.ts. The subscription price
 * shown to the customer is gross; the backend already returns it tax-inclusive.
 */
export function computeGrossCents(netCents: number): number {
  return netCents + computeTaxCents(netCents)
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
   * Tasa a usar para este preview — la de la dirección/zona elegida
   * (`UserAddress.taxRate`) o la de la orden ya creada (`Order.taxRate`).
   * Si se omite, cae al fallback TAX_RATE. Nunca es la tasa que realmente
   * cobra el backend — esa se congela server-side.
   */
  taxRate?: number
}): {
  taxableCents: number
  taxCents: number
  totalCents: number
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

/**
 * "6.625%" / "8.887%" — tres decimales fijos, igual que el backend calcula
 * los basis points de cada zona. Única fuente del formato: cualquier label
 * de UI que muestre un % de impuesto pasa por acá.
 */
export function formatTaxRatePct(rate: number): string {
  return `${(rate * 100).toFixed(3)}%`
}
