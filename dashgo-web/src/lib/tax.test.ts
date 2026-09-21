import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FLAT_SHIPPING_CENTS,
  TAX_RATE,
  computeGrossCents,
  computeQuotePreviewCents,
  computeTaxCents,
  formatTaxRatePct,
} from './tax'

describe('TAX_RATE', () => {
  it('matches the backend rate in dashgo-api/src/common/tax.ts', () => {
    expect(TAX_RATE).toBe(0.08887)
  })
})

describe('computeGrossCents', () => {
  it('adds the rounded tax on top of the net amount', () => {
    expect(computeGrossCents(1000)).toBe(1089)
  })
})

describe('computeTaxCents', () => {
  it('defaults to TAX_RATE (the no-zone fallback) when no rate is given', () => {
    expect(computeTaxCents(1000)).toBe(Math.round(1000 * TAX_RATE))
  })

  it('uses the given per-zone rate instead of the fallback (Elizabeth NJ 6.625%)', () => {
    expect(computeTaxCents(1000, 0.06625)).toBe(66) // round(1000 * 0.06625) = 66.25 -> 66
  })

  it('uses the Bronx/Brooklyn/Manhattan rate (8.875%)', () => {
    expect(computeTaxCents(1000, 0.08875)).toBe(89) // round(1000 * 0.08875) = 88.75 -> 89
  })
})

describe('formatTaxRatePct', () => {
  it('formats the no-zone fallback rate', () => {
    expect(formatTaxRatePct(TAX_RATE)).toBe('8.887%')
  })

  it('formats the Elizabeth NJ rate', () => {
    expect(formatTaxRatePct(0.06625)).toBe('6.625%')
  })

  it('formats the Bronx/Brooklyn/Manhattan rate', () => {
    expect(formatTaxRatePct(0.08875)).toBe('8.875%')
  })

  it('formats the API fallback-in-no-zone rate', () => {
    expect(formatTaxRatePct(0.08887)).toBe('8.887%')
  })
})

describe('DEFAULT_FLAT_SHIPPING_CENTS', () => {
  it('matches the backend flat shipping fee in dashgo-api/src/common/shipping.ts', () => {
    expect(DEFAULT_FLAT_SHIPPING_CENTS).toBe(500)
  })

  it('taxes a standard line plus the flat shipping', () => {
    const r = computeQuotePreviewCents({
      subtotalCents: 1000,
      shippingCents: DEFAULT_FLAT_SHIPPING_CENTS,
      pointsRedeemedCents: 0,
      taxableSubtotalCents: 1000,
    })
    expect(r.taxCents).toBe(133)
    expect(r.totalCents).toBe(1633)
  })

  it('does not tax the flat shipping on an all-exempt line (e.g. agua)', () => {
    const r = computeQuotePreviewCents({
      subtotalCents: 1000,
      shippingCents: DEFAULT_FLAT_SHIPPING_CENTS,
      pointsRedeemedCents: 0,
      taxableSubtotalCents: 0,
    })
    expect(r.taxCents).toBe(0)
    expect(r.totalCents).toBe(1500)
  })
})

describe('computeQuotePreviewCents', () => {
  describe('taxRate por dirección/zona', () => {
    it('defaults to TAX_RATE (fallback) when no taxRate is given, and returns it', () => {
      const r = computeQuotePreviewCents({
        subtotalCents: 1000,
        shippingCents: 0,
        pointsRedeemedCents: 0,
      })
      expect(r.taxRate).toBe(TAX_RATE)
    })

    it('uses the given per-address taxRate (Elizabeth NJ 6.625%) instead of the fallback', () => {
      const r = computeQuotePreviewCents({
        subtotalCents: 1000,
        shippingCents: 0,
        pointsRedeemedCents: 0,
        taxRate: 0.06625,
      })
      expect(r.taxRate).toBe(0.06625)
      expect(r.taxCents).toBe(66) // round(1000 * 0.06625) = 66.25 -> 66
    })
  })

  describe('sin categoría fiscal — todo gravable (comportamiento histórico)', () => {
    it('reproduces the old formula', () => {
      const r = computeQuotePreviewCents({
        subtotalCents: 1500,
        shippingCents: 300,
        pointsRedeemedCents: 200,
      })
      const expectedTaxable = 1500 + 300 - 200
      expect(r.taxableCents).toBe(expectedTaxable)
      expect(r.taxCents).toBe(Math.round(expectedTaxable * TAX_RATE))
      expect(r.totalCents).toBe(expectedTaxable + r.taxCents)
    })

    it('never goes negative when points exceed the base', () => {
      const r = computeQuotePreviewCents({
        subtotalCents: 500,
        shippingCents: 0,
        pointsRedeemedCents: 9999,
      })
      expect(r.taxableCents).toBe(0)
      expect(r.taxCents).toBe(0)
    })
  })

  describe('con parte exenta', () => {
    it('an all-exempt order owes no tax, shipping included', () => {
      const r = computeQuotePreviewCents({
        subtotalCents: 1000,
        shippingCents: 500,
        pointsRedeemedCents: 0,
        taxableSubtotalCents: 0,
      })
      expect(r.taxCents).toBe(0)
      // El cliente igual paga producto + envío, solo que sin impuesto.
      expect(r.totalCents).toBe(1500)
    })

    it('taxes only the standard half of a mixed order', () => {
      const r = computeQuotePreviewCents({
        subtotalCents: 2000,
        shippingCents: 400,
        pointsRedeemedCents: 0,
        taxableSubtotalCents: 500, // 25% gravable
      })
      // 500 + 25% de 400 = 600
      expect(r.taxableCents).toBe(600)
      expect(r.taxCents).toBe(Math.round(600 * TAX_RATE))
      // El total sigue cobrando los 2400 completos + impuesto
      expect(r.totalCents).toBe(2400 + r.taxCents)
    })

    it('prorates redeemed points by the taxable share', () => {
      const r = computeQuotePreviewCents({
        subtotalCents: 2000,
        shippingCents: 0,
        pointsRedeemedCents: 400,
        taxableSubtotalCents: 500,
      })
      expect(r.taxableCents).toBe(500 - 100)
    })

    it('does not divide by zero on a $0 subtotal', () => {
      const r = computeQuotePreviewCents({
        subtotalCents: 0,
        shippingCents: 500,
        pointsRedeemedCents: 0,
        taxableSubtotalCents: 0,
      })
      expect(Number.isNaN(r.taxCents)).toBe(false)
      expect(r.taxCents).toBe(0)
    })
  })
})
