import {
  TAX_RATE,
  computeGrossCents,
  computeTaxCents,
  computeTaxableBase,
} from './tax';

const std = (lineCents: number) => ({ lineCents, taxCategory: 'standard' as const });
const exempt = (lineCents: number) => ({ lineCents, taxCategory: 'exempt' as const });

describe('computeTaxCents / computeGrossCents', () => {
  it('rounds to the nearest cent', () => {
    expect(computeTaxCents(1000)).toBe(89); // 88.87 → 89
    expect(computeGrossCents(1000)).toBe(1089);
  });
});

describe('computeTaxableBase', () => {
  describe('backwards compatibility — every line standard', () => {
    // These MUST match the pre-existing formula exactly:
    //   taxable = max(0, subtotal + shipping - points); tax = round(taxable * RATE)
    // Any drift here silently re-prices every order already in the system.
    it('reproduces the old formula with no shipping and no points', () => {
      const r = computeTaxableBase([std(1000)]);
      expect(r.subtotalCents).toBe(1000);
      expect(r.taxableSubtotalCents).toBe(1000);
      expect(r.exemptSubtotalCents).toBe(0);
      expect(r.taxableCents).toBe(1000);
      expect(r.taxCents).toBe(Math.round(1000 * TAX_RATE));
    });

    it('reproduces the old formula with shipping and points', () => {
      const r = computeTaxableBase([std(1000), std(500)], {
        shippingCents: 300,
        pointsRedeemedCents: 200,
      });
      const expectedTaxable = 1500 + 300 - 200;
      expect(r.taxableCents).toBe(expectedTaxable);
      expect(r.taxCents).toBe(Math.round(expectedTaxable * TAX_RATE));
    });

    it('never goes negative when points exceed the base', () => {
      const r = computeTaxableBase([std(500)], { pointsRedeemedCents: 9999 });
      expect(r.taxableCents).toBe(0);
      expect(r.taxCents).toBe(0);
    });
  });

  describe('exempt lines', () => {
    it('an all-exempt order owes no tax', () => {
      const r = computeTaxableBase([exempt(1000), exempt(500)]);
      expect(r.subtotalCents).toBe(1500);
      expect(r.taxableSubtotalCents).toBe(0);
      expect(r.exemptSubtotalCents).toBe(1500);
      expect(r.taxableCents).toBe(0);
      expect(r.taxCents).toBe(0);
    });

    it('taxes only the standard lines in a mixed order', () => {
      // $10 water (exempt) + $10 soda (standard) → only the soda is taxed.
      const r = computeTaxableBase([exempt(1000), std(1000)]);
      expect(r.taxableSubtotalCents).toBe(1000);
      expect(r.exemptSubtotalCents).toBe(1000);
      expect(r.taxableCents).toBe(1000);
      expect(r.taxCents).toBe(Math.round(1000 * TAX_RATE));
    });

    it('an all-exempt order owes no tax even with shipping', () => {
      // Delivery of exempt goods is exempt too — shipping must not sneak a
      // taxable base into an otherwise untaxed order.
      const r = computeTaxableBase([exempt(1000)], { shippingCents: 500 });
      expect(r.taxableCents).toBe(0);
      expect(r.taxCents).toBe(0);
    });
  });

  describe('proration across a mixed order', () => {
    it('prorates shipping by the taxable share of the subtotal', () => {
      // 25% of the subtotal is taxable → 25% of the $4.00 shipping is taxable.
      const r = computeTaxableBase([std(500), exempt(1500)], {
        shippingCents: 400,
      });
      expect(r.taxableShippingCents).toBe(100);
      expect(r.taxableCents).toBe(500 + 100);
    });

    it('prorates redeemed points by the taxable share', () => {
      // Without proration the full 400 points would come off the taxable side
      // and understate the tax owed.
      const r = computeTaxableBase([std(500), exempt(1500)], {
        pointsRedeemedCents: 400,
      });
      expect(r.pointsOnTaxableCents).toBe(100);
      expect(r.taxableCents).toBe(500 - 100);
    });

    it('prorates shipping and points together', () => {
      const r = computeTaxableBase([std(500), exempt(1500)], {
        shippingCents: 400,
        pointsRedeemedCents: 400,
      });
      expect(r.taxableCents).toBe(500 + 100 - 100);
    });
  });

  describe('degenerate inputs', () => {
    it('an empty order is all zeroes', () => {
      const r = computeTaxableBase([]);
      expect(r).toMatchObject({
        subtotalCents: 0,
        taxableSubtotalCents: 0,
        taxableCents: 0,
        taxCents: 0,
      });
    });

    it('a zero subtotal does not divide by zero when shipping is charged', () => {
      // A $0 order (all lines free) with shipping: no taxable goods, so the
      // share is 0 and nothing is taxed.
      const r = computeTaxableBase([std(0)], { shippingCents: 500 });
      expect(Number.isNaN(r.taxableCents)).toBe(false);
      expect(r.taxableCents).toBe(0);
      expect(r.taxCents).toBe(0);
    });

    it('treats an unknown tax category as standard (fail closed, never under-collect)', () => {
      const r = computeTaxableBase([
        { lineCents: 1000, taxCategory: 'weird' as never },
      ]);
      expect(r.taxableSubtotalCents).toBe(1000);
    });
  });
});
