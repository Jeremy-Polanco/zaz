/**
 * Canonical tax math for the whole API.
 *
 * TAX_RATE ya NO es "la" tasa: es el FALLBACK. La tasa real la fija la zona de
 * reparto a la que cae la dirección de entrega (`delivery_zones.tax_rate`) —
 * New Jersey cobra 6.625% y NYC 8.875%, y cobrarle a los dos lo mismo era
 * cobrarle de más a uno y de menos al otro.
 *
 * Este número se queda por una razón concreta: es la constante histórica con la
 * que se cotizó todo lo que ya está en la base. Una dirección sin zona (sin ZIP,
 * o un ZIP que no matchea ningún prefijo) sigue pagando exactamente lo que venía
 * pagando. Caer en 0 ante un dato faltante sería cobrar de menos, que es el
 * error caro.
 *
 * Los espejos del frontend (dashgo-web/src/lib/tax.ts y dashgo/src/lib/tax.ts)
 * tienen que seguir igual a este valor mientras sigan calculando el fallback.
 */
export const TAX_RATE = 0.08887;

/**
 * Tax owed on a net (pre-tax) cent amount. Rounds to the nearest cent — matches
 * the order quote formula exactly (Math.round(taxable * rate)).
 *
 * `taxRate` es la tasa de la zona; omitirla usa el fallback histórico.
 */
export function computeTaxCents(
  netCents: number,
  taxRate: number = TAX_RATE,
): number {
  return Math.round(netCents * taxRate);
}

/**
 * La tasa como porcentaje para mostrarle al humano: 0.06625 → "6.625%".
 *
 * Tres decimales y no dos porque las tasas reales los usan (6.625%, 8.875%):
 * redondear a "6.63%" en la factura es explicarle mal al cliente por qué pagó
 * lo que pagó.
 */
export function formatTaxRatePct(rate: number): string {
  return `${(rate * 100).toFixed(3)}%`;
}

/**
 * Gross (tax-inclusive) cents for a net amount: net + tax. Used by the
 * subscription plan so the Stripe Price that customers are actually charged —
 * and the price shown in the app — includes tax, while the DB keeps the net
 * amount as the editable source of truth.
 */
export function computeGrossCents(netCents: number): number {
  return netCents + computeTaxCents(netCents);
}

/**
 * Fiscal category of a product.
 *
 * `standard` — taxed at TAX_RATE (the default; every product starts here).
 * `exempt`   — not taxed. Bottled water in NJ is the driving case.
 *
 * Deliberately a string and not a boolean: US sales tax exemption is really a
 * (category × jurisdiction) matrix, not an on/off switch — NJ exempts plain
 * bottled water but taxes the flavoured kind. When multi-state lands, the rate
 * lookup keys off this column plus the destination state; a boolean would have
 * to be thrown away.
 */
export type TaxCategory = 'standard' | 'exempt';

export interface TaxableLine {
  /** Line total in cents (unit price × quantity), already discounted. */
  lineCents: number;
  taxCategory: TaxCategory;
}

export interface TaxableBaseOptions {
  shippingCents?: number;
  pointsRedeemedCents?: number;
  /**
   * Tasa de la zona de reparto. Omitirla usa TAX_RATE (el fallback histórico),
   * que es lo que corresponde cuando la dirección no cae en ninguna zona.
   */
  taxRate?: number;
}

export interface TaxableBase {
  subtotalCents: number;
  taxableSubtotalCents: number;
  exemptSubtotalCents: number;
  /** Portion of shipping attributed to taxable goods. */
  taxableShippingCents: number;
  /** Portion of redeemed points attributed to taxable goods. */
  pointsOnTaxableCents: number;
  /** Final base the rate is applied to. */
  taxableCents: number;
  taxCents: number;
  /**
   * Tasa que se aplicó. Viaja de vuelta para que quien llama la congele en la
   * orden sin volver a adivinarla — `orders.tax_rate` tiene que poder explicar
   * el impuesto cobrado años después.
   */
  taxRate: number;
}

/**
 * Splits an order into its taxable and exempt halves and returns the tax owed.
 *
 * Only `standard` lines are taxed. Shipping and redeemed points are PRORATED by
 * the taxable share of the subtotal: charging delivery on a water-only order
 * must not conjure a taxable base, and letting points come off the taxable side
 * first would understate what is owed. An unknown category is treated as
 * `standard` — under-collecting sales tax is the expensive mistake.
 *
 * La TASA sale de `opts.taxRate` (la de la zona de entrega). Sin ella se usa
 * TAX_RATE, que es lo que cobraba el sistema antes de que existieran zonas.
 *
 * When every line is `standard` this reduces EXACTLY to the historical formula
 * (`max(0, subtotal + shipping - points) × RATE`), so orders already in the
 * system keep their numbers. There is a test pinning that.
 */
export function computeTaxableBase(
  lines: TaxableLine[],
  opts: TaxableBaseOptions = {},
): TaxableBase {
  const shippingCents = opts.shippingCents ?? 0;
  const pointsRedeemedCents = opts.pointsRedeemedCents ?? 0;
  const taxRate = opts.taxRate ?? TAX_RATE;

  let subtotalCents = 0;
  let taxableSubtotalCents = 0;
  for (const line of lines) {
    subtotalCents += line.lineCents;
    if (line.taxCategory !== 'exempt') taxableSubtotalCents += line.lineCents;
  }
  const exemptSubtotalCents = subtotalCents - taxableSubtotalCents;

  // Share of the order that is taxable. A $0 subtotal has nothing to tax, so
  // the share is 0 — this is also what keeps the division safe.
  const taxableShare =
    subtotalCents > 0 ? taxableSubtotalCents / subtotalCents : 0;

  const taxableShippingCents = Math.round(shippingCents * taxableShare);
  const pointsOnTaxableCents = Math.round(pointsRedeemedCents * taxableShare);

  const taxableCents = Math.max(
    0,
    taxableSubtotalCents + taxableShippingCents - pointsOnTaxableCents,
  );

  return {
    subtotalCents,
    taxableSubtotalCents,
    exemptSubtotalCents,
    taxableShippingCents,
    pointsOnTaxableCents,
    taxableCents,
    taxCents: computeTaxCents(taxableCents, taxRate),
    taxRate,
  };
}
