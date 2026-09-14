/**
 * Tests for haversineMeters util, plus reverseGeocode/forwardGeocode ZIP
 * (postalCode) extraction from Nominatim's `address.postcode`.
 */
import { haversineMeters, reverseGeocode, forwardGeocode } from './geo'

describe('haversineMeters', () => {
  it('returns 0 for identical coordinates', () => {
    expect(haversineMeters({ lat: 18.47, lng: -69.9 }, { lat: 18.47, lng: -69.9 })).toBe(0)
  })

  it('returns ~111km for 1 degree of latitude', () => {
    const dist = haversineMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })
    // 1 degree latitude ≈ 111.19km (Earth meridian)
    expect(dist).toBeGreaterThan(111_000)
    expect(dist).toBeLessThan(112_000)
  })

  it('returns ~111km for 1 degree of longitude at equator', () => {
    const dist = haversineMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })
    expect(dist).toBeGreaterThan(111_000)
    expect(dist).toBeLessThan(112_000)
  })

  it('returns distance within 200m threshold correctly', () => {
    // Two points ~100m apart (≈0.001 degree latitude at equator)
    const a = { lat: 18.47, lng: -69.9 }
    const b = { lat: 18.4709, lng: -69.9 } // ~100m north
    const dist = haversineMeters(a, b)
    expect(dist).toBeLessThan(200)
  })

  it('returns distance greater than 200m for distant points', () => {
    const a = { lat: 18.47, lng: -69.9 }
    const b = { lat: 18.475, lng: -69.9 } // ~556m north
    const dist = haversineMeters(a, b)
    expect(dist).toBeGreaterThan(200)
  })

  it('handles negative coordinates (Southern/Western hemisphere)', () => {
    const a = { lat: -33.87, lng: -70.65 } // Santiago
    const b = { lat: -34.60, lng: -58.38 } // Buenos Aires
    const dist = haversineMeters(a, b)
    // ~1100km
    expect(dist).toBeGreaterThan(1_000_000)
    expect(dist).toBeLessThan(1_200_000)
  })
})

function mockFetchOnce(response: unknown, ok = true) {
  const fn = jest.fn().mockResolvedValue({
    ok,
    json: async () => response,
  })
  global.fetch = fn as unknown as typeof fetch
  return fn
}

describe('reverseGeocode — postalCode extraction', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('returns the trimmed postcode from Nominatim address details', async () => {
    mockFetchOnce({
      display_name: '123 Main St, Bronx, NY, 10451, United States',
      address: { postcode: ' 10451 ', city: 'Bronx' },
    })

    const result = await reverseGeocode(40.8404, -73.9397)

    expect(result.postalCode).toBe('10451')
    expect(result.text).toBe('123 Main St, Bronx, NY, 10451, United States')
  })

  it('returns null postalCode when Nominatim has no postcode', async () => {
    mockFetchOnce({
      display_name: '123 Main St',
      address: { city: 'Bronx' },
    })

    const result = await reverseGeocode(40.8404, -73.9397)

    expect(result.postalCode).toBeNull()
  })

  it('returns null postalCode when there is no address block at all', async () => {
    mockFetchOnce({ display_name: '123 Main St' })

    const result = await reverseGeocode(40.8404, -73.9397)

    expect(result.postalCode).toBeNull()
  })

  it('requests addressdetails=1 so Nominatim includes the postcode', async () => {
    const fetchMock = mockFetchOnce({ display_name: 'x', address: {} })

    await reverseGeocode(40.8404, -73.9397)

    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain('addressdetails=1')
  })

  it('keeps the existing shape — text and raw still present', async () => {
    mockFetchOnce({
      display_name: '123 Main St',
      address: { postcode: '10451' },
    })

    const result = await reverseGeocode(40.8404, -73.9397)

    expect(result).toEqual(
      expect.objectContaining({
        text: '123 Main St',
        postalCode: '10451',
        raw: expect.anything(),
      }),
    )
  })
})

describe('forwardGeocode — postalCode extraction', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('maps postalCode from each result\'s address.postcode', async () => {
    mockFetchOnce([
      {
        lat: '40.8404',
        lon: '-73.9397',
        display_name: '123 Main St, Bronx, NY 10451',
        address: { postcode: '10451' },
      },
      {
        lat: '40.85',
        lon: '-73.93',
        display_name: '456 Other St, Bronx, NY',
        address: {},
      },
    ])

    const results = await forwardGeocode('123 Main St')

    expect(results[0].postalCode).toBe('10451')
    expect(results[1].postalCode).toBeNull()
  })

  it('requests addressdetails=1', async () => {
    const fetchMock = mockFetchOnce([])

    await forwardGeocode('123 Main St')

    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain('addressdetails=1')
  })

  it('keeps the existing shape — lat/lng/text still present', async () => {
    mockFetchOnce([
      {
        lat: '40.8404',
        lon: '-73.9397',
        display_name: '123 Main St',
        address: { postcode: '10451' },
      },
    ])

    const results = await forwardGeocode('123 Main St')

    expect(results[0]).toEqual({
      lat: 40.8404,
      lng: -73.9397,
      text: '123 Main St',
      postalCode: '10451',
    })
  })
})
