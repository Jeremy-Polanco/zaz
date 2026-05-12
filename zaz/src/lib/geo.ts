import * as Location from 'expo-location'

export type Coords = { lat: number; lng: number }

/**
 * Haversine formula — distance between two lat/lng points in meters.
 *
 * Pure function, no external dependencies.
 */
export function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6_371_000 // Earth radius in metres
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const sinDLat = Math.sin(dLat / 2)
  const sinDLng = Math.sin(dLng / 2)
  const h =
    sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng
  return 2 * R * Math.asin(Math.sqrt(h))
}

export type ReverseGeocodeResult = {
  text: string
  raw?: unknown
}

export async function requestDeviceLocation(): Promise<Coords> {
  const { status } = await Location.requestForegroundPermissionsAsync()
  if (status !== 'granted') {
    throw new Error('Permiso de ubicación denegado')
  }
  const pos = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  })
  return { lat: pos.coords.latitude, lng: pos.coords.longitude }
}

const NOMINATIM = 'https://nominatim.openstreetmap.org'
const USER_AGENT = 'Zaz/1.0'

export async function reverseGeocode(
  lat: number,
  lng: number,
): Promise<ReverseGeocodeResult> {
  const url = `${NOMINATIM}/reverse?format=jsonv2&lat=${lat}&lon=${lng}`
  const res = await fetch(url, {
    headers: {
      'Accept-Language': 'es,en',
      'User-Agent': USER_AGENT,
    },
  })
  if (!res.ok) throw new Error('Reverse geocode failed')
  const data = (await res.json()) as {
    display_name?: string
    address?: Record<string, string>
  }
  const text = data.display_name ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`
  return { text, raw: data }
}

export type ForwardGeocodeResult = {
  lat: number
  lng: number
  text: string
}

export async function forwardGeocode(
  query: string,
): Promise<ForwardGeocodeResult[]> {
  const url = `${NOMINATIM}/search?format=jsonv2&countrycodes=us&limit=5&q=${encodeURIComponent(
    query,
  )}`
  const res = await fetch(url, {
    headers: {
      'Accept-Language': 'es,en',
      'User-Agent': USER_AGENT,
    },
  })
  if (!res.ok) throw new Error('Forward geocode failed')
  const data = (await res.json()) as Array<{
    lat: string
    lon: string
    display_name: string
  }>
  return data.map((r) => ({
    lat: parseFloat(r.lat),
    lng: parseFloat(r.lon),
    text: r.display_name,
  }))
}
