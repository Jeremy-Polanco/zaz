export interface Coords {
  lat: number
  lng: number
}

export interface ReverseGeocodeResult {
  text: string
  lat: number
  lng: number
}

export function requestBrowserLocation(options?: PositionOptions): Promise<Coords> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('Geolocalización no disponible en este navegador'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60_000, ...options },
    )
  })
}

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org'
const USER_AGENT_HEADER = 'Zaz/1.0'

export async function reverseGeocode(
  lat: number,
  lng: number,
): Promise<ReverseGeocodeResult> {
  const params = new URLSearchParams({
    format: 'jsonv2',
    lat: String(lat),
    lon: String(lng),
    addressdetails: '1',
    zoom: '18',
  })
  const res = await fetch(`${NOMINATIM_BASE}/reverse?${params.toString()}`, {
    headers: {
      'Accept-Language': 'es,en',
      'User-Agent': USER_AGENT_HEADER,
    },
  })
  if (!res.ok) {
    throw new Error(`Nominatim respondió ${res.status}`)
  }
  const data = (await res.json()) as { display_name?: string }
  return {
    text: data.display_name ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
    lat,
    lng,
  }
}

export async function forwardGeocode(query: string): Promise<ReverseGeocodeResult[]> {
  if (!query.trim()) return []
  const params = new URLSearchParams({
    format: 'jsonv2',
    q: query,
    limit: '5',
    countrycodes: 'us',
  })
  const res = await fetch(`${NOMINATIM_BASE}/search?${params.toString()}`, {
    headers: {
      'Accept-Language': 'es,en',
      'User-Agent': USER_AGENT_HEADER,
    },
  })
  if (!res.ok) return []
  const data = (await res.json()) as Array<{
    display_name: string
    lat: string
    lon: string
  }>
  return data.map((item) => ({
    text: item.display_name,
    lat: parseFloat(item.lat),
    lng: parseFloat(item.lon),
  }))
}
