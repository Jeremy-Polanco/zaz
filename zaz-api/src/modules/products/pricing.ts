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
