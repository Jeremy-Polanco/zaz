import { useCallback, useEffect, useState } from 'react'
import { requestBrowserLocation, type Coords } from './geo'

export type DevicePositionStatus =
  | 'idle'
  | 'locating'
  | 'granted'
  | 'denied'
  | 'unavailable'

export interface UseDevicePositionResult {
  position: Coords | null
  status: DevicePositionStatus
  /** Re-pide la posición actual (p. ej. el botón "Actualizar mi ubicación"). */
  refresh: () => void
}

// GeolocationPositionError.PERMISSION_DENIED === 1. requestBrowserLocation
// (src/lib/geo.ts) also rejects with a plain Error (sin `.code`) cuando
// navigator.geolocation no existe — ese caso y TIMEOUT/POSITION_UNAVAILABLE
// caen todos en 'unavailable': el panel sigue mostrando los pedidos, solo
// que ordenados por fecha en vez de por cercanía.
const PERMISSION_DENIED = 1

/**
 * La lista de reparto se ordena desde donde ESTÁ el repartidor ahora mismo.
 * Este hook pide la posición del dispositivo una vez al montar. Nunca lanza:
 * sin GPS, quien llama simplemente se queda con status 'unavailable'/'denied'
 * y position null, y decide qué mostrar (p. ej. el aviso "Sin tu ubicación…").
 */
export function useDevicePosition(): UseDevicePositionResult {
  const [position, setPosition] = useState<Coords | null>(null)
  const [status, setStatus] = useState<DevicePositionStatus>('idle')

  const refresh = useCallback(() => {
    setStatus('locating')
    requestBrowserLocation({
      enableHighAccuracy: false,
      timeout: 8000,
      maximumAge: 60_000,
    })
      .then((coords) => {
        setPosition(coords)
        setStatus('granted')
      })
      .catch((err: unknown) => {
        const code = (err as { code?: number } | undefined)?.code
        setStatus(code === PERMISSION_DENIED ? 'denied' : 'unavailable')
      })
  }, [])

  useEffect(() => {
    refresh()
    // Solo al montar — refresh es estable (useCallback sin deps); se vuelve a
    // invocar manualmente desde el botón de refrescar ubicación.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { position, status, refresh }
}
