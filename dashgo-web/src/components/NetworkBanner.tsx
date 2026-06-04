/**
 * NetworkBanner — global offline/online indicator (web).
 *
 * Subscribes to `window.online` / `window.offline` events plus `navigator.onLine`
 * and renders:
 *  - A sticky top banner while the browser reports offline.
 *  - A brief "Conexión restaurada" toast that auto-dismisses ~2s after the
 *    network comes back.
 *
 * Mounted globally from `src/routes/__root.tsx` above the header so it sits
 * above all routes without occluding the navbar.
 *
 * Testability:
 *  - data-testid="network-banner-offline" / "network-banner-restored".
 *  - Tests drive state via dispatching `online`/`offline` events on `window`
 *    after stubbing `navigator.onLine`.
 */
import { useEffect, useRef, useState } from 'react'

const RESTORED_TOAST_MS = 2000
const NETWORK_ERROR_TOAST_MS = 3000

/**
 * Module-level event channel for network errors surfaced by axios/TanStack Query.
 * The QueryClient onError handler calls `notifyNetworkError()` when it detects
 * `axios.isAxiosError(err) && err.code === 'ERR_NETWORK'`. The banner listens
 * for this event and shows a transient toast even when `navigator.onLine` is
 * (incorrectly) reporting connectivity.
 */
const NETWORK_ERROR_EVENT = 'dashgo:network-error'

export function notifyNetworkError() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(NETWORK_ERROR_EVENT))
}

type BannerState = 'idle' | 'offline' | 'restored' | 'network-error'

export function NetworkBanner() {
  const [state, setState] = useState<BannerState>(() => {
    if (typeof navigator === 'undefined') return 'idle'
    return navigator.onLine === false ? 'offline' : 'idle'
  })
  const wasOfflineRef = useRef<boolean>(
    typeof navigator !== 'undefined' && navigator.onLine === false,
  )
  const restoredTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return

    const onOffline = () => {
      wasOfflineRef.current = true
      if (restoredTimerRef.current) {
        clearTimeout(restoredTimerRef.current)
        restoredTimerRef.current = null
      }
      setState('offline')
    }

    const onOnline = () => {
      if (!wasOfflineRef.current) {
        // Never been offline this session — nothing to celebrate.
        setState('idle')
        return
      }
      wasOfflineRef.current = false
      setState('restored')
      if (restoredTimerRef.current) clearTimeout(restoredTimerRef.current)
      restoredTimerRef.current = setTimeout(() => {
        setState('idle')
        restoredTimerRef.current = null
      }, RESTORED_TOAST_MS)
    }

    const onNetworkError = () => {
      // Don't overwrite the persistent offline banner — it's more informative.
      if (wasOfflineRef.current) return
      if (restoredTimerRef.current) {
        clearTimeout(restoredTimerRef.current)
        restoredTimerRef.current = null
      }
      setState('network-error')
      restoredTimerRef.current = setTimeout(() => {
        setState('idle')
        restoredTimerRef.current = null
      }, NETWORK_ERROR_TOAST_MS)
    }

    window.addEventListener('offline', onOffline)
    window.addEventListener('online', onOnline)
    window.addEventListener(NETWORK_ERROR_EVENT, onNetworkError)

    return () => {
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('online', onOnline)
      window.removeEventListener(NETWORK_ERROR_EVENT, onNetworkError)
      if (restoredTimerRef.current) {
        clearTimeout(restoredTimerRef.current)
        restoredTimerRef.current = null
      }
    }
  }, [])

  if (state === 'idle') return null

  if (state === 'offline') {
    return (
      <div
        data-testid="network-banner-offline"
        role="alert"
        aria-live="assertive"
        className="sticky top-0 z-50 flex items-center justify-center gap-3 bg-ink px-4 py-3 text-paper shadow-md"
        style={{ animation: 'dashgo-banner-slide-down 220ms ease-out' }}
      >
        <span
          aria-hidden="true"
          className="inline-block h-2 w-2 rounded-full bg-bad animate-pulse"
        />
        <span className="text-sm font-semibold tracking-wide">
          Sin conexión a internet. Revisá tu red.
        </span>
      </div>
    )
  }

  if (state === 'network-error') {
    return (
      <div
        data-testid="network-banner-error"
        role="alert"
        aria-live="assertive"
        className="sticky top-0 z-50 flex items-center justify-center gap-3 bg-ink px-4 py-3 text-paper shadow-md"
        style={{ animation: 'dashgo-banner-slide-down 220ms ease-out' }}
      >
        <span
          aria-hidden="true"
          className="inline-block h-2 w-2 rounded-full bg-bad animate-pulse"
        />
        <span className="text-sm font-semibold tracking-wide">Sin conexión</span>
      </div>
    )
  }

  // restored
  return (
    <div
      data-testid="network-banner-restored"
      role="status"
      aria-live="polite"
      className="sticky top-0 z-50 flex items-center justify-center px-4 py-2 text-paper shadow-md"
      style={{
        backgroundColor: '#1F8A4F',
        animation: 'dashgo-banner-slide-down 220ms ease-out',
      }}
    >
      <span className="text-sm font-semibold tracking-wide">
        Conexión restaurada
      </span>
    </div>
  )
}

export default NetworkBanner
