/**
 * Tests for haversineMeters util.
 */
import { haversineMeters } from './geo'

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
