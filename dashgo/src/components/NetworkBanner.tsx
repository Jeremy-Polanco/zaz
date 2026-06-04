/**
 * NetworkBanner — global offline/online indicator (mobile).
 *
 * Subscribes to NetInfo and renders:
 *  - A sticky top banner while the device is offline.
 *  - A brief "Conexión restaurada" toast that auto-dismisses ~2s after the
 *    network comes back.
 *
 * Mounted globally from `src/app/_layout.tsx` so it sits above all routes.
 *
 * Testability:
 *  - Uses testID="network-banner-offline" / "network-banner-restored" for RNTL.
 *  - The NetInfo listener is the single source of truth — we treat any non-true
 *    `isConnected` value as offline (handles `null` during cold boot).
 */
import { useEffect, useRef, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import NetInfo, {
  type NetInfoState,
} from '@react-native-community/netinfo'

const RESTORED_TOAST_MS = 2000
const NETWORK_ERROR_TOAST_MS = 3000

/**
 * Module-level pub/sub so the global TanStack Query error handlers can
 * tell the banner that an axios `ERR_NETWORK` occurred even when NetInfo
 * still reports the device as online (e.g. captive portal, DNS-only outage).
 */
const networkErrorListeners = new Set<() => void>()

export function notifyNetworkError() {
  networkErrorListeners.forEach((fn) => {
    try {
      fn()
    } catch {
      // never let a buggy listener kill the dispatch loop
    }
  })
}

type BannerState =
  | { kind: 'idle' }
  | { kind: 'offline' }
  | { kind: 'restored' }
  | { kind: 'network-error' }

export function NetworkBanner() {
  const [state, setState] = useState<BannerState>({ kind: 'idle' })
  // Track previous connectivity so we only show "restored" after a real drop.
  const wasOfflineRef = useRef(false)
  const restoredTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const handle = (info: NetInfoState) => {
      // Treat `null` (unknown) as connected to avoid a false banner on boot.
      const offline = info.isConnected === false

      if (offline) {
        wasOfflineRef.current = true
        if (restoredTimerRef.current) {
          clearTimeout(restoredTimerRef.current)
          restoredTimerRef.current = null
        }
        setState({ kind: 'offline' })
        return
      }

      // online
      if (wasOfflineRef.current) {
        wasOfflineRef.current = false
        setState({ kind: 'restored' })
        if (restoredTimerRef.current) clearTimeout(restoredTimerRef.current)
        restoredTimerRef.current = setTimeout(() => {
          setState({ kind: 'idle' })
          restoredTimerRef.current = null
        }, RESTORED_TOAST_MS)
      } else {
        setState({ kind: 'idle' })
      }
    }

    const unsubscribe = NetInfo.addEventListener(handle)

    // Prime initial state — NetInfo doesn't always fire immediately on mount.
    NetInfo.fetch().then(handle).catch(() => {
      // If fetch fails we stay idle; the listener will catch the next change.
    })

    // Listen for axios-reported ERR_NETWORK so we still surface a hint when
    // NetInfo is wrong (captive portals, DNS hiccups, etc.).
    const onNetworkError = () => {
      // If we're already showing the persistent offline banner, ignore.
      if (wasOfflineRef.current) return
      if (restoredTimerRef.current) {
        clearTimeout(restoredTimerRef.current)
        restoredTimerRef.current = null
      }
      setState({ kind: 'network-error' })
      restoredTimerRef.current = setTimeout(() => {
        setState({ kind: 'idle' })
        restoredTimerRef.current = null
      }, NETWORK_ERROR_TOAST_MS)
    }
    networkErrorListeners.add(onNetworkError)

    return () => {
      unsubscribe()
      networkErrorListeners.delete(onNetworkError)
      if (restoredTimerRef.current) {
        clearTimeout(restoredTimerRef.current)
        restoredTimerRef.current = null
      }
    }
  }, [])

  if (state.kind === 'idle') return null

  if (state.kind === 'offline') {
    return (
      <View
        style={styles.offlineBanner}
        testID="network-banner-offline"
        accessibilityRole="alert"
        accessibilityLiveRegion="assertive"
        accessibilityLabel="Sin conexión a internet. Revisá tu red."
      >
        <View style={styles.dot} />
        <Text style={styles.offlineText}>
          Sin conexión a internet. Revisá tu red.
        </Text>
      </View>
    )
  }

  if (state.kind === 'network-error') {
    return (
      <View
        style={styles.offlineBanner}
        testID="network-banner-error"
        accessibilityRole="alert"
        accessibilityLiveRegion="assertive"
        accessibilityLabel="Sin conexión"
      >
        <View style={styles.dot} />
        <Text style={styles.offlineText}>Sin conexión</Text>
      </View>
    )
  }

  // restored
  return (
    <View
      style={styles.restoredBanner}
      testID="network-banner-restored"
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      accessibilityLabel="Conexión restaurada"
    >
      <Text style={styles.restoredText}>Conexión restaurada</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  offlineBanner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    backgroundColor: '#1A1530',
    paddingTop: 48, // clear the status bar; SafeArea-aware parents will adjust
    paddingBottom: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  offlineText: {
    color: '#FAFAFC',
    fontSize: 13,
    fontWeight: '600',
    flexShrink: 1,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FF4D6D',
  },
  restoredBanner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    backgroundColor: '#1F8A4F',
    paddingTop: 48,
    paddingBottom: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  restoredText: {
    color: '#FAFAFC',
    fontSize: 13,
    fontWeight: '600',
  },
})

export default NetworkBanner
