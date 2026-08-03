/**
 * Canonical tax math for the whole API. This is the single source of truth for
 * TAX_RATE — orders, payments and subscriptions all import it from here. The
 * frontend mirrors (dashgo-web/src/lib/tax.ts and dashgo/src/lib/tax.ts) must
 * stay identical to this value.
 */
export const TAX_RATE = 0.08887;

/**
 * Tax owed on a net (pre-tax) cent amount. Rounds to the nearest cent — matches
 * the order quote formula exactly (Math.round(taxable * TAX_RATE)).
 */
export function computeTaxCents(netCents: number): number {
  return Math.round(netCents * TAX_RATE);
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
    taxCents: computeTaxCents(taxableCents),
  };
}
