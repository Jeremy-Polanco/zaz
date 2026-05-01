import * as Location from 'expo-location'

export type Coords = { lat: number; lng: number }

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
