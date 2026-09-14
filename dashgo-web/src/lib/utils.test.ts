import { describe, it, expect } from 'vitest'
import { formatDeliveryDay, isoDayFromDate, serverMessage } from './utils'

/**
 * `serverMessage` is what stands between an operator and a useless error box.
 * The admin panels used to hardcode "Intentá de nuevo", which made a 403
 * ("no podés eliminar tu propia cuenta") indistinguishable from a real crash.
 */
describe('serverMessage', () => {
  it('returns the API message when the axios error carries one', () => {
    const err = {
      response: { data: { message: 'No podés eliminar tu propia cuenta.' } },
    }
    expect(serverMessage(err, 'fallback')).toBe(
      'No podés eliminar tu propia cuenta.',
    )
  })

  it('falls back when the error has no response body', () => {
    expect(serverMessage(new Error('Network Error'), 'fallback')).toBe(
      'fallback',
    )
  })

  it('falls back on null and undefined', () => {
    expect(serverMessage(null, 'fallback')).toBe('fallback')
    expect(serverMessage(undefined, 'fallback')).toBe('fallback')
  })

  it('falls back when data exists but carries no message', () => {
    expect(serverMessage({ response: { data: {} } }, 'fallback')).toBe(
      'fallback',
    )
  })

  it('falls back when Nest sends message as an array of validation errors', () => {
    // class-validator responses use `message: string[]`. Rendering "a,b" is
    // worse than the caller's fallback, so treat a non-string as absent.
    const err = { response: { data: { message: ['a must be a string'] } } }
    expect(serverMessage(err, 'fallback')).toBe('fallback')
  })
})

/**
 * scheduledDeliveryDate travels as a bare 'YYYY-MM-DD' DAY, no time, no
 * timezone. `new Date('2026-09-16')` parses that as UTC midnight, which a
 * viewer west of Greenwich (Udash ops are in New Jersey) then renders back as
 * the 15th — the classic off-by-one. formatDeliveryDay must build the Date
 * from the numeric y/m/d parts (local midnight) instead of handing the raw
 * string to `new Date()`.
 */
describe('formatDeliveryDay', () => {
  it('formats a YYYY-MM-DD day in Spanish, weekday + day + month', () => {
    // 2026-09-16 is a Wednesday.
    expect(formatDeliveryDay('2026-09-16')).toBe('miércoles 16 de septiembre')
  })

  it('does NOT shift 2026-09-16 back to the 15th', () => {
    const result = formatDeliveryDay('2026-09-16')
    expect(result).toContain('16')
    expect(result).not.toContain('15')
  })

  it('handles single-digit days and months correctly', () => {
    // 2026-01-05 is a Monday.
    expect(formatDeliveryDay('2026-01-05')).toBe('lunes 5 de enero')
  })
})

describe('isoDayFromDate', () => {
  it('formats a local Date as YYYY-MM-DD', () => {
    expect(isoDayFromDate(new Date(2026, 8, 16))).toBe('2026-09-16')
  })

  it('zero-pads single-digit months and days', () => {
    expect(isoDayFromDate(new Date(2026, 0, 5))).toBe('2026-01-05')
  })

  it('round-trips through formatDeliveryDay without shifting the day', () => {
    const d = new Date(2026, 8, 16)
    const iso = isoDayFromDate(d)
    expect(formatDeliveryDay(iso)).toContain('16')
  })
})
