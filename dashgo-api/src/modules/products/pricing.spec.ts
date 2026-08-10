import { Product } from '../../entities';
import {
  PREMIUM_BEBEDERO_CATALOG_SURCHARGE_CENTS,
  SUBSCRIBER_BEBEDERO_RENT_CENTS,
  getEffectivePrice,
  resolveBebederoRentCents,
  resolvePremiumBebederoRentCents,
} from './pricing';

/** Minimal Product builder for pure pricing unit tests. */
function mkProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'prod-1',
    name: 'Test',
    pricingMode: 'rental',
    monthlyRentCents: 2000, // $20 catalog rent
    requiresMaintenance: true, // a bebedero by default
    ...overrides,
  } as unknown as Product;
}

describe('resolveBebederoRentCents', () => {
  it('non-subscriber pays catalog rent even on a bebedero', () => {
    const r = resolveBebederoRentCents(mkProduct(), false, 0);
    expect(r).toEqual({ monthlyRentCents: 2000, tier: 'catalog' });
  });

  it('subscriber gets their FIRST bebedero free ($0)', () => {
    const r = resolveBebederoRentCents(mkProduct(), true, 0);
    expect(r).toEqual({ monthlyRentCents: 0, tier: 'free' });
  });

  it('subscriber pays the fallback rate for an ADDITIONAL bebedero when no plan amount is given', () => {
    const r = resolveBebederoRentCents(mkProduct(), true, 1);
    expect(r).toEqual({
      monthlyRentCents: SUBSCRIBER_BEBEDERO_RENT_CENTS,
      tier: 'subscriber',
    });
    expect(SUBSCRIBER_BEBEDERO_RENT_CENTS).toBe(699);
  });

  it('subscriber pays the SUBSCRIPTION plan price for an ADDITIONAL bebedero', () => {
    // The additional-bebedero rent must track the live subscription price
    // (net cents from subscription_plan.unitAmountCents), not a frozen constant.
    const r = resolveBebederoRentCents(mkProduct(), true, 1, 1299);
    expect(r).toEqual({ monthlyRentCents: 1299, tier: 'subscriber' });
  });

  it('FIRST bebedero is still free regardless of the plan price', () => {
    const r = resolveBebederoRentCents(mkProduct(), true, 0, 1299);
    expect(r).toEqual({ monthlyRentCents: 0, tier: 'free' });
  });

  it('subscriber: a rental that is NOT a bebedero (requiresMaintenance=false) uses catalog rent', () => {
    const r = resolveBebederoRentCents(
      mkProduct({ requiresMaintenance: false }),
      true,
      0,
    );
    expect(r).toEqual({ monthlyRentCents: 2000, tier: 'catalog' });
  });

  it('subscriber: a single_payment product is never a bebedero', () => {
    const r = resolveBebederoRentCents(
      mkProduct({ pricingMode: 'single_payment', monthlyRentCents: 0 }),
      true,
      0,
    );
    expect(r).toEqual({ monthlyRentCents: 0, tier: 'catalog' });
  });
});

describe('resolvePremiumBebederoRentCents', () => {
  // El bebedero premium de $34.99 de catálogo, con el plan premium a $29.99.
  const premium = () =>
    mkProduct({
      id: 'prod-premium',
      isPremiumSubscriberProduct: true,
      monthlyRentCents: 3499,
    });
  const PREMIUM_NET = 2999;

  it('un producto que NO es el premium no aplica (lo resuelve la regla estándar)', () => {
    expect(
      resolvePremiumBebederoRentCents(mkProduct(), true, 0, PREMIUM_NET),
    ).toBeNull();
  });

  it('suscriptor premium, PRIMERA unidad → $0 (1 incluido con la suscripción)', () => {
    expect(resolvePremiumBebederoRentCents(premium(), true, 0, PREMIUM_NET)).toEqual({
      monthlyRentCents: 0,
      tier: 'included',
    });
  });

  it('suscriptor premium, unidad ADICIONAL → el precio de la suscripción', () => {
    expect(resolvePremiumBebederoRentCents(premium(), true, 1, PREMIUM_NET)).toEqual({
      monthlyRentCents: PREMIUM_NET,
      tier: 'premium',
    });
  });

  it('SIN suscripción premium activa → precio de la suscripción + $5', () => {
    expect(resolvePremiumBebederoRentCents(premium(), false, 0, PREMIUM_NET)).toEqual({
      monthlyRentCents: PREMIUM_NET + PREMIUM_BEBEDERO_CATALOG_SURCHARGE_CENTS,
      tier: 'catalog',
    });
    expect(PREMIUM_BEBEDERO_CATALOG_SURCHARGE_CENTS).toBe(500);
  });

  it('un suscriptor ESTÁNDAR no lo lleva gratis: paga el catálogo (+$5)', () => {
    // premiumActive es false para un suscriptor estándar. Este es el carve-out
    // que impide que la regla "primer bebedero gratis" del plan común regale el
    // producto exclusivo del premium.
    const r = resolvePremiumBebederoRentCents(premium(), false, 0, PREMIUM_NET);
    expect(r?.tier).toBe('catalog');
    expect(r?.monthlyRentCents).toBe(3499);
  });

  it('sin plan premium configurado cae al catálogo del producto — nunca cobra de menos', () => {
    expect(resolvePremiumBebederoRentCents(premium(), false, 0, null)).toEqual({
      monthlyRentCents: 3499,
      tier: 'catalog',
    });
    // Estado raro (premium activo sin plan): también catálogo, no gratis.
    expect(resolvePremiumBebederoRentCents(premium(), true, 1, null)).toEqual({
      monthlyRentCents: 3499,
      tier: 'catalog',
    });
  });

  it('la unidad incluida sigue siendo $0 aunque no haya plan (es la instalación)', () => {
    expect(resolvePremiumBebederoRentCents(premium(), true, 0, null)).toEqual({
      monthlyRentCents: 0,
      tier: 'included',
    });
  });
});

/** Single-payment product builder for getEffectivePrice tests. $10.00 base. */
function mkPriced(overrides: Partial<Product> = {}): Product {
  return {
    id: 'prod-2',
    name: 'Botellón',
    priceToPublic: '10.00',
    pricingMode: 'single_payment',
    offerLabel: null,
    offerDiscountPct: null,
    offerStartsAt: null,
    offerEndsAt: null,
    subscriberPriceCents: null,
    ...overrides,
  } as unknown as Product;
}

const NOW = new Date('2026-08-02T12:00:00Z');

describe('getEffectivePrice', () => {
  describe('sin precio de suscriptor (comportamiento existente)', () => {
    it('no offer → base price', () => {
      expect(getEffectivePrice(mkPriced(), NOW)).toEqual({
        priceCents: 1000,
        basePriceCents: 1000,
        discountPct: null,
        offerActive: false,
        subscriberPriceApplied: false,
      });
    });

    it('offer inside its window → discounted price', () => {
      const p = mkPriced({
        offerDiscountPct: '20',
        offerStartsAt: new Date('2026-08-01T00:00:00Z'),
        offerEndsAt: new Date('2026-08-31T00:00:00Z'),
      });
      expect(getEffectivePrice(p, NOW)).toEqual({
        priceCents: 800,
        basePriceCents: 1000,
        discountPct: 20,
        offerActive: true,
        subscriberPriceApplied: false,
      });
    });

    it('offer already expired → base price', () => {
      const p = mkPriced({
        offerDiscountPct: '20',
        offerEndsAt: new Date('2026-07-01T00:00:00Z'),
      });
      expect(getEffectivePrice(p, NOW).priceCents).toBe(1000);
    });

    it('offer not started yet → base price', () => {
      const p = mkPriced({
        offerDiscountPct: '20',
        offerStartsAt: new Date('2026-09-01T00:00:00Z'),
      });
      expect(getEffectivePrice(p, NOW).priceCents).toBe(1000);
    });
  });

  describe('precio de suscriptor', () => {
    it('subscriber with a subscriber price pays it', () => {
      const p = mkPriced({ subscriberPriceCents: 750 });
      expect(getEffectivePrice(p, NOW, { isSubscriber: true })).toEqual({
        priceCents: 750,
        basePriceCents: 1000,
        discountPct: null,
        offerActive: false,
        subscriberPriceApplied: true,
      });
    });

    it('non-subscriber IGNORES the subscriber price', () => {
      const p = mkPriced({ subscriberPriceCents: 750 });
      const r = getEffectivePrice(p, NOW, { isSubscriber: false });
      expect(r.priceCents).toBe(1000);
      expect(r.subscriberPriceApplied).toBe(false);
    });

    it('defaults to non-subscriber when no options are passed', () => {
      const p = mkPriced({ subscriberPriceCents: 750 });
      expect(getEffectivePrice(p, NOW).priceCents).toBe(1000);
    });

    it('subscriber price beats a weaker offer — never stacked', () => {
      // $10 base, 20% off ⇒ $8. The $7.50 subscriber price is lower, so it is
      // the one charged, and the offer is not reported as active: the two
      // never combine.
      const p = mkPriced({
        subscriberPriceCents: 750,
        offerDiscountPct: '20',
        offerStartsAt: new Date('2026-08-01T00:00:00Z'),
        offerEndsAt: new Date('2026-08-31T00:00:00Z'),
      });
      expect(getEffectivePrice(p, NOW, { isSubscriber: true })).toEqual({
        priceCents: 750,
        basePriceCents: 1000,
        discountPct: null,
        offerActive: false,
        subscriberPriceApplied: true,
      });
    });

    it('a CHEAPER offer wins — a subscriber never pays more than the public', () => {
      // 60% off ⇒ $4, below the $7.50 subscriber price. The subscriber price is
      // a FLOOR, not a fixed price: nobody with a subscription may end up worse
      // off than someone without one.
      const p = mkPriced({
        subscriberPriceCents: 750,
        offerDiscountPct: '60',
      });
      expect(getEffectivePrice(p, NOW, { isSubscriber: true })).toEqual({
        priceCents: 400,
        basePriceCents: 1000,
        discountPct: 60,
        offerActive: true,
        subscriberPriceApplied: false,
      });
    });

    it('ties go to the public price (no subscriber badge for the same money)', () => {
      // 25% off ⇒ $7.50, exactly the subscriber price. Nothing is gained by
      // claiming the subscriber price applied.
      const p = mkPriced({
        subscriberPriceCents: 750,
        offerDiscountPct: '25',
      });
      const r = getEffectivePrice(p, NOW, { isSubscriber: true });
      expect(r.priceCents).toBe(750);
      expect(r.subscriberPriceApplied).toBe(false);
      expect(r.offerActive).toBe(true);
    });

    it('a subscriber price of 0 is honoured (free), not treated as unset', () => {
      const p = mkPriced({ subscriberPriceCents: 0 });
      const r = getEffectivePrice(p, NOW, { isSubscriber: true });
      expect(r.priceCents).toBe(0);
      expect(r.subscriberPriceApplied).toBe(true);
    });

    it('subscriber with NO subscriber price falls back to the offer', () => {
      const p = mkPriced({
        subscriberPriceCents: null,
        offerDiscountPct: '20',
      });
      const r = getEffectivePrice(p, NOW, { isSubscriber: true });
      expect(r.priceCents).toBe(800);
      expect(r.offerActive).toBe(true);
      expect(r.subscriberPriceApplied).toBe(false);
    });
  });
});
