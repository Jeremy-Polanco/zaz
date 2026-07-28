import { describe, it, expect } from 'vitest'
import { serverMessage } from './utils'

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
