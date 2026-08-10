import { Product } from '../../entities';

export interface EffectivePrice {
  priceCents: number;
  basePriceCents: number;
  discountPct: number | null;
  offerActive: boolean;
  /** True when `priceCents` came from the product's subscriber price. */
  subscriberPriceApplied: boolean;
}

export interface EffectivePriceOptions {
  /**
   * Whether the buyer is an active subscriber RIGHT NOW. Must be resolved
   * server-side against the subscription — never taken from the client.
   */
  isSubscriber?: boolean;
}

export function getEffectivePrice(
  product: Product,
  now: Date = new Date(),
  opts: EffectivePriceOptions = {},
): EffectivePrice {
  const base = parseFloat(product.priceToPublic);
  const basePriceCents = Math.round(base * 100);

  // 1) Precio público: catálogo, o el de la oferta si está vigente.
  const hasOffer = product.offerDiscountPct != null;
  const inWindow =
    hasOffer &&
    (!product.offerStartsAt || product.offerStartsAt <= now) &&
    (!product.offerEndsAt || product.offerEndsAt >= now);

  let publicPriceCents = basePriceCents;
  let discountPct: number | null = null;
  let offerActive = false;
  if (hasOffer && inWindow) {
    discountPct = parseFloat(product.offerDiscountPct!);
    publicPriceCents = Math.round(basePriceCents * (1 - discountPct / 100));
    offerActive = true;
  }

  // 2) El precio de suscriptor es un PISO, no un precio fijo: el suscriptor
  // paga el MENOR entre su precio y el precio público. Nunca más caro que
  // alguien sin suscripción — una promo agresiva no puede dejar al suscriptor
  // peor que al público, y las dos nunca se acumulan.
  // `!= null` a propósito: 0 es un precio válido (gratis para suscriptores).
  if (
    opts.isSubscriber &&
    product.subscriberPriceCents != null &&
    product.subscriberPriceCents < publicPriceCents
  ) {
    return {
      priceCents: product.subscriberPriceCents,
      basePriceCents,
      discountPct: null,
      offerActive: false,
      subscriberPriceApplied: true,
    };
  }

  return {
    priceCents: publicPriceCents,
    basePriceCents,
    discountPct,
    offerActive,
    subscriberPriceApplied: false,
  };
}

/**
 * Fallback monthly rent (in net cents) an active subscriber pays for each
 * bebedero BEYOND their first one, used only when the live subscription plan
 * price is unavailable. Normally the additional-bebedero rent TRACKS the
 * subscription's own monthly price (`subscription_plan.unitAmountCents`) so the
 * two can never drift apart — pass it as `subscriberRentCents`.
 *
 * The first bebedero is free ($0); every additional bebedero rents at the
 * subscription price + tax. Non-subscribers pay the product's catalog
 * `monthlyRentCents`.
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
 *   - first bebedero ever (priorBebederoCount === 0) → $0/mo          ('free')
 *   - each additional bebedero                       → subscription price ('subscriber')
 *
 * @param product             the rental product being priced
 * @param isActiveSubscriber  whether the user is an active subscriber right now
 * @param priorBebederoCount  lifetime count of bebedero rentals the user has
 *                            had BEFORE this one (any status). 0 → this is
 *                            their first → free.
 * @param subscriberRentCents net monthly rent for additional bebederos — the
 *                            live subscription price. Defaults to the frozen
 *                            fallback when the plan price is unavailable.
 */
export function resolveBebederoRentCents(
  product: Product,
  isActiveSubscriber: boolean,
  priorBebederoCount: number,
  subscriberRentCents: number = SUBSCRIBER_BEBEDERO_RENT_CENTS,
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
    monthlyRentCents: subscriberRentCents,
    tier: 'subscriber',
  };
}

/**
 * Recargo de catálogo del bebedero premium: quien NO tiene la suscripción
 * premium activa lo alquila al precio de la suscripción + este monto.
 */
export const PREMIUM_BEBEDERO_CATALOG_SURCHARGE_CENTS = 500;

export type PremiumBebederoRentTier = 'included' | 'premium' | 'catalog';

export interface PremiumBebederoRent {
  monthlyRentCents: number;
  tier: PremiumBebederoRentTier;
}

/**
 * Renta mensual del producto exclusivo del plan premium.
 *
 * Regla del negocio: 1 unidad viene INCLUIDA con la suscripción premium ($0);
 * cada adicional cuesta lo mismo que la suscripción; sin suscripción premium
 * activa, cuesta la suscripción + $5.
 *
 * Devuelve `null` para cualquier otro producto: el premium queda EXCLUIDO de
 * `resolveBebederoRentCents` a propósito. Si pasara por la regla estándar, un
 * suscriptor común sin bebederos previos se llevaría gratis (primer bebedero
 * free) el producto exclusivo de un plan que no paga.
 *
 * `premiumActive` es "tiene la suscripción PREMIUM activa" (getActiveTier),
 * no cualquier suscripción. `priorPremiumCount` cuenta rentals de ESTE
 * producto en cualquier estado — una vez usada la unidad incluida, no se
 * repite. Sin plan premium configurado se cae al catálogo del producto:
 * cobrar de menos es el error caro; la única excepción es la unidad incluida,
 * que es $0 por definición (es la orden de instalación).
 */
export function resolvePremiumBebederoRentCents(
  product: Product,
  premiumActive: boolean,
  priorPremiumCount: number,
  premiumNetCents: number | null,
): PremiumBebederoRent | null {
  if (!product.isPremiumSubscriberProduct) return null;

  if (premiumActive && priorPremiumCount === 0) {
    return { monthlyRentCents: 0, tier: 'included' };
  }

  if (premiumActive && premiumNetCents != null) {
    return { monthlyRentCents: premiumNetCents, tier: 'premium' };
  }

  return {
    monthlyRentCents:
      premiumNetCents != null
        ? premiumNetCents + PREMIUM_BEBEDERO_CATALOG_SURCHARGE_CENTS
        : product.monthlyRentCents,
    tier: 'catalog',
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
