import { Product } from '../../entities';
import {
  SUBSCRIBER_BEBEDERO_RENT_CENTS,
  resolveBebederoRentCents,
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
