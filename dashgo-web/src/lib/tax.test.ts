import { describe, expect, it } from 'vitest'
import { TAX_RATE, computeGrossCents, computeQuotePreviewCents } from './tax'

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

describe('computeQuotePreviewCents', () => {
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
