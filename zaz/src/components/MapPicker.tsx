import { useEffect, useRef } from 'react'
import { View } from 'react-native'
import MapView, {
  Marker,
  PROVIDER_DEFAULT,
  type MapMarker,
  type Region,
} from 'react-native-maps'

// Washington Heights fallback center.
const FALLBACK_LAT = 40.8404
const FALLBACK_LNG = -73.9397

export function MapPicker({
  value,
  onChange,
  className,
}: {
  value: { lat?: number; lng?: number } | null | undefined
  onChange: (coords: { lat: number; lng: number }) => void
  className?: string
}) {
  const mapRef = useRef<MapView | null>(null)
  const markerRef = useRef<MapMarker | null>(null)

  const latitude = value?.lat ?? FALLBACK_LAT
  const longitude = value?.lng ?? FALLBACK_LNG

  const region: Region = {
    latitude,
    longitude,
    latitudeDelta: 0.008,
    longitudeDelta: 0.008,
  }

  useEffect(() => {
    mapRef.current?.animateToRegion(region, 300)
    // region is recomputed from props; safe to depend on lat/lng primitives
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latitude, longitude])

  return (
    <View className={`h-56 w-full overflow-hidden border border-ink/15 ${className ?? ''}`}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_DEFAULT}
        style={{ flex: 1 }}
        initialRegion={region}
        showsUserLocation={false}
        pitchEnabled={false}
        rotateEnabled={false}
      >
        <Marker
          ref={(ref) => {
            markerRef.current = ref
          }}
          coordinate={{ latitude, longitude }}
          draggable
          onDragEnd={(e) => {
            const { latitude: lat, longitude: lng } = e.nativeEvent.coordinate
            onChange({ lat, lng })
          }}
        />
      </MapView>
    </View>
  )
}
