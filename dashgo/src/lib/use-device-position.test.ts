/**
 * useDevicePosition — GPS position for the admin dispatch screen (where the
 * repartidor actually IS right now, not a saved address). It reuses
 * lib/geo's requestDeviceLocation, so we mock 'expo-location' (the module
 * geo.ts talks to) and let the real geo.ts run.
 */
import { renderHook, act, waitFor } from '@testing-library/react-native'

const mockRequestForegroundPermissionsAsync = jest.fn()
const mockGetCurrentPositionAsync = jest.fn()

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: (...args: unknown[]) =>
    mockRequestForegroundPermissionsAsync(...args),
  getCurrentPositionAsync: (...args: unknown[]) =>
    mockGetCurrentPositionAsync(...args),
  Accuracy: { Balanced: 3 },
}))

// setup.ts's default expo-router mock invokes useFocusEffect's callback
// synchronously during render, which is fine for effects with no setState —
// but this hook sets state inside it. Same fix as subscription.test.tsx:
// run it as a real post-render effect that fires once per mount, not on
// every render (avoids a "too many re-renders" loop).
jest.mock('expo-router', () => {
  const { useEffect } = require('react')
  return {
    useFocusEffect: jest.fn((cb: () => unknown) => {
      useEffect(() => {
        const cleanup = cb()
        if (typeof cleanup === 'function') return cleanup
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])
    }),
  }
})

import { useDevicePosition } from './use-device-position'

afterEach(() => {
  jest.clearAllMocks()
})

describe('useDevicePosition', () => {
  it('settles into granted with coords when permission + GPS succeed', async () => {
    mockRequestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' })
    mockGetCurrentPositionAsync.mockResolvedValue({
      coords: { latitude: 40.7357, longitude: -74.1724 },
    })

    const { result } = renderHook(() => useDevicePosition())

    await waitFor(() => expect(result.current.status).toBe('granted'))
    expect(result.current.position).toEqual({ lat: 40.7357, lng: -74.1724 })
  })

  it('settles into denied with no position when permission is refused', async () => {
    mockRequestForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' })

    const { result } = renderHook(() => useDevicePosition())

    await waitFor(() => expect(result.current.status).toBe('denied'))
    expect(result.current.position).toBeNull()
    expect(mockGetCurrentPositionAsync).not.toHaveBeenCalled()
  })

  it('settles into unavailable (not denied) when GPS itself throws', async () => {
    mockRequestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' })
    mockGetCurrentPositionAsync.mockRejectedValue(new Error('Location request failed'))

    const { result } = renderHook(() => useDevicePosition())

    await waitFor(() => expect(result.current.status).toBe('unavailable'))
    expect(result.current.position).toBeNull()
  })

  it('locates once on mount (focus) without an explicit refresh() call', async () => {
    mockRequestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' })
    mockGetCurrentPositionAsync.mockResolvedValue({
      coords: { latitude: 1, longitude: 2 },
    })

    renderHook(() => useDevicePosition())

    await waitFor(() =>
      expect(mockRequestForegroundPermissionsAsync).toHaveBeenCalledTimes(1),
    )
  })

  it('refresh() re-locates on demand (pull-to-refresh)', async () => {
    mockRequestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' })
    mockGetCurrentPositionAsync.mockResolvedValue({
      coords: { latitude: 1, longitude: 2 },
    })

    const { result } = renderHook(() => useDevicePosition())
    await waitFor(() => expect(result.current.status).toBe('granted'))

    await act(async () => {
      await result.current.refresh()
    })

    expect(mockRequestForegroundPermissionsAsync).toHaveBeenCalledTimes(2)
  })
})
