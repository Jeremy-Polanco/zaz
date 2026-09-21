import { useCallback, useRef, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import { requestDeviceLocation, type Coords } from './geo'

export type DevicePositionStatus =
  | 'idle'
  | 'locating'
  | 'granted'
  | 'denied'
  | 'unavailable'

const LOCATE_TIMEOUT_MS = 8_000

// Matches the message requestDeviceLocation throws on a refused permission
// (lib/geo.ts) — used to tell "denied" apart from any other GPS failure.
const PERMISSION_DENIED_MESSAGE = 'Permiso de ubicación denegado'

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Location request timed out')),
      ms,
    )
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

/**
 * Device GPS position for the admin dispatch screen — where the repartidor
 * actually IS right now, not a saved address. Reuses lib/geo's
 * requestDeviceLocation (same permission + GPS call as the "Usar mi
 * ubicación" flow in LocationBottomSheet) so there's a single place that
 * talks to expo-location.
 *
 * Never throws: a refused permission settles into 'denied', any other GPS
 * failure (including our own timeout guard) into 'unavailable' — callers
 * fall back to date-order and show a one-line notice instead of crashing.
 */
export function useDevicePosition() {
  const [position, setPosition] = useState<Coords | null>(null)
  const [status, setStatus] = useState<DevicePositionStatus>('idle')
  // Guards against overlapping locate() runs — focus and pull-to-refresh
  // can fire back to back.
  const inFlight = useRef(false)

  const refresh = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    setStatus('locating')
    try {
      const coords = await withTimeout(requestDeviceLocation(), LOCATE_TIMEOUT_MS)
      setPosition(coords)
      setStatus('granted')
    } catch (e) {
      setPosition(null)
      setStatus(
        (e as Error)?.message === PERMISSION_DENIED_MESSAGE
          ? 'denied'
          : 'unavailable',
      )
    } finally {
      inFlight.current = false
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      void refresh()
    }, [refresh]),
  )

  return { position, status, refresh }
}
