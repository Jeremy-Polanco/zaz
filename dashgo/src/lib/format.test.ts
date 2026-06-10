/**
 * Money formatting — whole dollars render clean ("$20"), fractional amounts
 * always show both cent digits ("$5.44", never "$5.4" or a rounded "$20"
 * for $19.99). Mirrors web's two-decimal precision without padding wholes.
 */
import { formatMoney, formatCents } from './format'

describe('formatMoney', () => {
  it('renders whole dollars without decimals', () => {
    expect(formatMoney(10)).toBe('$10')
    expect(formatMoney(20)).toBe('$20')
  })

  it('renders fractional amounts with two decimals', () => {
    expect(formatMoney(5.44)).toBe('$5.44')
    expect(formatMoney(10.5)).toBe('$10.50')
  })

  it('parses string input', () => {
    expect(formatMoney('10.50')).toBe('$10.50')
  })
})

describe('formatCents', () => {
  it('renders whole-dollar cents without decimals', () => {
    expect(formatCents(2000)).toBe('$20')
  })

  it('never hides or rounds a cent', () => {
    expect(formatCents(544)).toBe('$5.44')
    expect(formatCents(44)).toBe('$0.44')
    expect(formatCents(540)).toBe('$5.40')
    expect(formatCents(1999)).toBe('$19.99')
  })
})
