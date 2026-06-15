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
