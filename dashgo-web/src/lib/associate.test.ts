import { describe, expect, it } from 'vitest'
import {
  canCarryAssociatePrice,
  parseAssociatePrice,
  productsQueryKey,
  showsRentalsEntry,
  showsSubscriptionEntry,
} from './associate'

describe('parseAssociatePrice', () => {
  it('treats blank as "no associate price"', () => {
    expect(parseAssociatePrice('')).toEqual({ cents: null, error: null })
    expect(parseAssociatePrice('   ')).toEqual({ cents: null, error: null })
  })

  it('accepts a dot decimal', () => {
    expect(parseAssociatePrice('4.50')).toEqual({ cents: 450, error: null })
  })

  it('accepts a Spanish comma decimal (never silently saves $4.00)', () => {
    expect(parseAssociatePrice('4,50')).toEqual({ cents: 450, error: null })
  })

  it('rejects zero, negatives and garbage', () => {
    const err = 'Ingresa un precio mayor a 0'
    expect(parseAssociatePrice('0')).toEqual({ cents: null, error: err })
    expect(parseAssociatePrice('-3')).toEqual({ cents: null, error: err })
    expect(parseAssociatePrice('abc').error).toBe(err)
  })
})

describe('canCarryAssociatePrice', () => {
  const base = {
    pricingMode: 'single_payment',
    isMaintenanceService: false,
    isDefaultSubscriberBebedero: false,
    isPremiumSubscriberProduct: false,
  }

  it('is true for a plain one-time product', () => {
    expect(canCarryAssociatePrice(base)).toBe(true)
  })

  it('is false for a rental', () => {
    expect(canCarryAssociatePrice({ ...base, pricingMode: 'rental' })).toBe(false)
  })

  it.each([
    'isMaintenanceService',
    'isDefaultSubscriberBebedero',
    'isPremiumSubscriberProduct',
  ] as const)('is false when %s is set', (flag) => {
    expect(canCarryAssociatePrice({ ...base, [flag]: true })).toBe(false)
  })
})

describe('showsSubscriptionEntry / showsRentalsEntry', () => {
  it('hides the entries only for an associate without one', () => {
    expect(showsSubscriptionEntry('associate', false)).toBe(false)
    expect(showsSubscriptionEntry('associate', true)).toBe(true)
    expect(showsSubscriptionEntry('client', false)).toBe(true)
    expect(showsSubscriptionEntry(undefined, false)).toBe(true)
    expect(showsRentalsEntry('associate', false)).toBe(false)
    expect(showsRentalsEntry('associate', true)).toBe(true)
    expect(showsRentalsEntry('client', false)).toBe(true)
  })
})

describe('productsQueryKey', () => {
  it('keys the public catalog by role, guest when absent', () => {
    expect(productsQueryKey(undefined)).toEqual(['products', 'public', 'guest'])
    expect(productsQueryKey(null)).toEqual(['products', 'public', 'guest'])
    expect(productsQueryKey('associate')).toEqual(['products', 'public', 'associate'])
  })
})
