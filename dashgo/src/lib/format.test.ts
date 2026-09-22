/**
 * Money formatting — whole dollars render clean ("$20"), fractional amounts
 * always show both cent digits ("$5.44", never "$5.4" or a rounded "$20"
 * for $19.99). Mirrors web's two-decimal precision without padding wholes.
 */
import {
  formatMoney,
  formatCents,
  formatDeliveryDay,
  formatDateOnly,
  isoDayFromDate,
} from './format'

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

/**
 * scheduledDeliveryDate is a 'YYYY-MM-DD' DAY with no time, no timezone.
 * Parsing it with `new Date(isoString)` treats it as UTC midnight, which
 * shifts a day backwards in any negative-UTC-offset timezone (this test
 * suite's machine included) — the whole point of these helpers is to never
 * let that happen.
 */
describe('isoDayFromDate', () => {
  it('reads the local date components, not UTC', () => {
    expect(isoDayFromDate(new Date(2026, 8, 16))).toBe('2026-09-16')
  })

  it('pads single-digit month and day', () => {
    expect(isoDayFromDate(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
})

describe('formatDeliveryDay', () => {
  it('formats a day in Spanish as "weekday day de month" (no shift)', () => {
    // 2026-09-16 is a Wednesday — verified against Date(2026, 8, 16).
    expect(formatDeliveryDay('2026-09-16')).toBe('miércoles 16 de septiembre')
  })

  it('formats a day in English as "Weekday, Month day"', () => {
    expect(formatDeliveryDay('2026-09-16', 'en')).toBe('Wednesday, September 16')
  })

  it('never shifts the day backwards regardless of the machine timezone', () => {
    // 2026-01-01 is the sharpest edge case: a naive `new Date('2026-01-01')`
    // (parsed as UTC) rolls back to Dec 31 in any negative-offset timezone.
    expect(formatDeliveryDay('2026-01-01')).toContain('1 de enero')
    expect(isoDayFromDate(new Date(2026, 0, 1))).toBe('2026-01-01')
  })
})

/**
 * formatDateOnly — same locale conventions as formatDate (es-AR, DD/MM/YYYY)
 * but WITHOUT the time. Used for the plan-delinquency hint on the "Alquileres"
 * admin screen, where "desde 15/01/2026, 14:30" reads worse than "desde
 * 15/01/2026" — the hour the sync ran is not information the operator needs.
 */
describe('formatDateOnly', () => {
  // Noon UTC keeps the same calendar day for every real-world UTC offset this
  // suite runs under (Mac sandbox UTC-4, CI UTC — see jest-TZ gotcha memory),
  // unlike a midnight or late-evening instant which can roll to the
  // neighboring day depending on the machine's local timezone.
  it('formats an ISO instant as DD/MM/YYYY with no time', () => {
    expect(formatDateOnly('2026-01-15T12:00:00Z')).toBe('15/01/2026')
  })

  it('pads single-digit day and month', () => {
    expect(formatDateOnly('2026-03-05T12:00:00Z')).toBe('05/03/2026')
  })
})
