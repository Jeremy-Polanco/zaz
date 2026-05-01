import { useEffect, useMemo, useRef } from 'react'
import { MapContainer, Marker, TileLayer, useMap } from 'react-leaflet'
import type { LatLngExpression, Marker as LMarker } from 'leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// Fix default marker icon paths — bundle via Vite asset pipeline instead of unpkg CDN.
const iconUrl = new URL('leaflet/dist/images/marker-icon.png', import.meta.url).href
const iconRetinaUrl = new URL('leaflet/dist/images/marker-icon-2x.png', import.meta.url).href
const shadowUrl = new URL('leaflet/dist/images/marker-shadow.png', import.meta.url).href

const defaultIcon = L.icon({
  iconRetinaUrl,
  iconUrl,
  shadowUrl,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
})

L.Marker.prototype.options.icon = defaultIcon

// Washington Heights fallback center.
const FALLBACK_CENTER: [number, number] = [40.8404, -73.9397]

function Recenter({ center }: { center: LatLngExpression }): null {
  const map = useMap()
  useEffect(() => {
    map.setView(center)
  }, [center, map])
  return null
}

export function MapPicker({
  value,
  onChange,
  className,
}: {
  value: { lat?: number; lng?: number } | null | undefined
  onChange: (coords: { lat: number; lng: number }) => void
  className?: string
}) {
  const markerRef = useRef<LMarker | null>(null)
  const center = useMemo<[number, number]>(
    () =>
      value?.lat !== undefined && value?.lng !== undefined
        ? [value.lat, value.lng]
        : FALLBACK_CENTER,
    [value?.lat, value?.lng],
  )

  return (
    <div
      className={`h-64 w-full overflow-hidden border border-ink/15 ${className ?? ''}`}
    >
      <MapContainer
        center={center}
        zoom={15}
        scrollWheelZoom={false}
        className="h-full w-full"
      >
        <Recenter center={center} />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Marker
          draggable
          position={center}
          ref={(ref) => {
            markerRef.current = ref
          }}
          eventHandlers={{
            dragend: () => {
              const marker = markerRef.current
              if (!marker) return
              const ll = marker.getLatLng()
              onChange({ lat: ll.lat, lng: ll.lng })
            },
          }}
        />
      </MapContainer>
    </div>
  )
}
