import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { reverseGeocode, forwardGeocode } from './geo'

// Nominatim (addressdetails=1) returns address.postcode alongside display_name.
// reverseGeocode/forwardGeocode currently keep only display_name/lat/lon — this
// suite locks in that they also surface the ZIP as `postalCode`, trimmed, or
// null when Nominatim doesn't have one.

function mockFetchOnce(body: unknown, ok = true) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('reverseGeocode', () => {
  it('returns postalCode from address.postcode', async () => {
    mockFetchOnce({
      display_name: 'Calle Duarte 100, Santo Domingo',
      address: { postcode: '10451' },
    })

    const result = await reverseGeocode(18.47, -69.9)

    expect(result.postalCode).toBe('10451')
    expect(result.text).toBe('Calle Duarte 100, Santo Domingo')
  })

  it('trims whitespace around the postcode', async () => {
    mockFetchOnce({
      display_name: 'Calle Duarte 100',
      address: { postcode: '  10451  ' },
    })

    const result = await reverseGeocode(18.47, -69.9)

    expect(result.postalCode).toBe('10451')
  })

  it('returns null when Nominatim has no postcode', async () => {
    mockFetchOnce({ display_name: 'Calle Duarte 100', address: {} })

    const result = await reverseGeocode(18.47, -69.9)

    expect(result.postalCode).toBeNull()
  })

  it('returns null when Nominatim omits the address block entirely', async () => {
    mockFetchOnce({ display_name: 'Calle Duarte 100' })

    const result = await reverseGeocode(18.47, -69.9)

    expect(result.postalCode).toBeNull()
  })
})

describe('forwardGeocode', () => {
  it('maps postalCode for each search result', async () => {
    mockFetchOnce([
      {
        display_name: 'Calle Duarte 100, Santo Domingo',
        lat: '18.47',
        lon: '-69.9',
        address: { postcode: '10451' },
      },
      {
        display_name: 'Av. Winston Churchill, Santo Domingo',
        lat: '18.48',
        lon: '-69.91',
        address: {},
      },
    ])

    const results = await forwardGeocode('Calle Duarte')

    expect(results[0].postalCode).toBe('10451')
    expect(results[1].postalCode).toBeNull()
  })

  it('returns an empty array without calling fetch for a blank query', async () => {
    const fetchMock = mockFetchOnce([])
    const results = await forwardGeocode('   ')
    expect(results).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
