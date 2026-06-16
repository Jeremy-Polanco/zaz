import { Product } from '../../entities';

export interface EffectivePrice {
  priceCents: number;
  basePriceCents: number;
  discountPct: number | null;
  offerActive: boolean;
}

export function getEffectivePrice(
  product: Product,
  now: Date = new Date(),
): EffectivePrice {
  const base = parseFloat(product.priceToPublic);
  const basePriceCents = Math.round(base * 100);

  const hasOffer = product.offerDiscountPct != null;
  const inWindow =
    hasOffer &&
    (!product.offerStartsAt || product.offerStartsAt <= now) &&
    (!product.offerEndsAt || product.offerEndsAt >= now);

  if (!hasOffer || !inWindow) {
    return {
      priceCents: basePriceCents,
      basePriceCents,
      discountPct: null,
      offerActive: false,
    };
  }

  const discountPct = parseFloat(product.offerDiscountPct!);
  const discountedCents = Math.round(basePriceCents * (1 - discountPct / 100));
  return {
    priceCents: discountedCents,
    basePriceCents,
    discountPct,
    offerActive: true,
  };
}

/**
 * Flat monthly rent (in cents) an active subscriber pays for each bebedero
 * BEYOND their first one. The first bebedero is free ($0); every additional
 * bebedero rents at this rate ($6.99/mo + tax). Non-subscribers pay the
 * product's catalog `monthlyRentCents`.
 */
export const SUBSCRIBER_BEBEDERO_RENT_CENTS = 699;

export type BebederoRentTier = 'free' | 'subscriber' | 'catalog';

export interface BebederoRent {
  monthlyRentCents: number;
  tier: BebederoRentTier;
}

/**
 * Resolve the effective monthly rent for a rental product, applying the
 * subscriber bebedero benefit when it applies.
 *
 * A "bebedero" is a rental dispenser: `pricingMode === 'rental'` AND
 * `requiresMaintenance === true`. Any other product (single_payment, or a
 * rental that is not a dispenser) always uses its catalog `monthlyRentCents`.
 *
 * Benefit (active subscribers only):
 *   - first bebedero ever (priorBebederoCount === 0) → $0/mo  ('free')
 *   - each additional bebedero                       → $6.99/mo ('subscriber')
 *
 * @param product             the rental product being priced
 * @param isActiveSubscriber  whether the user is an active subscriber right now
 * @param priorBebederoCount  lifetime count of bebedero rentals the user has
 *                            had BEFORE this one (any status). 0 → this is
 *                            their first → free.
 */
export function resolveBebederoRentCents(
  product: Product,
  isActiveSubscriber: boolean,
  priorBebederoCount: number,
): BebederoRent {
  const isBebedero =
    product.pricingMode === 'rental' && product.requiresMaintenance === true;

  if (!isActiveSubscriber || !isBebedero) {
    return { monthlyRentCents: product.monthlyRentCents, tier: 'catalog' };
  }

  if (priorBebederoCount === 0) {
    return { monthlyRentCents: 0, tier: 'free' };
  }

  return {
    monthlyRentCents: SUBSCRIBER_BEBEDERO_RENT_CENTS,
    tier: 'subscriber',
  };
}

export type ProductWithPricing = Product & {
  effectivePriceCents: number;
  basePriceCents: number;
  offerActive: boolean;
};

export function decorateProduct(
  product: Product,
  now: Date = new Date(),
): ProductWithPricing {
  const ep = getEffectivePrice(product, now);
  return Object.assign(product, {
    effectivePriceCents: ep.priceCents,
    basePriceCents: ep.basePriceCents,
    offerActive: ep.offerActive,
  });
}
