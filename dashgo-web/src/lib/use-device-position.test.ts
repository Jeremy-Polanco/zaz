import { describe, it, expect, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { vi } from 'vitest'
import { useDevicePosition } from './use-device-position'

// jsdom has no Geolocation API by default (`'geolocation' in navigator` is
// false) — each test defines it as needed and afterEach removes it so tests
// don't leak state into each other.
function mockGeolocation(
  getCurrentPosition: (
    success: PositionCallback,
    error?: PositionErrorCallback,
  ) => void,
) {
  // vi.fn's mock.calls records every argument getCurrentPosition was called
  // with, including the 3rd (PositionOptions) — widen the spy's type to that
  // real signature so tests can assert on it, even though `impl` above only
  // needs the first two.
  const spy = vi.fn<
    (
      success: PositionCallback,
      error?: PositionErrorCallback,
      options?: PositionOptions,
    ) => void
  >(getCurrentPosition)
  Object.defineProperty(navigator, 'geolocation', {
    value: { getCurrentPosition: spy },
    configurable: true,
  })
  return spy
}

afterEach(() => {
  // @ts-expect-error test cleanup — restores jsdom's default (no geolocation)
  delete navigator.geolocation
})

describe('useDevicePosition', () => {
  it('starts locating, then resolves to granted with the device coords', async () => {
    mockGeolocation((success) => {
      success({
        coords: { latitude: 18.47, longitude: -69.9 },
      } as GeolocationPosition)
    })

    const { result } = renderHook(() => useDevicePosition())

    await waitFor(() => expect(result.current.status).toBe('granted'))
    expect(result.current.position).toEqual({ lat: 18.47, lng: -69.9 })
  })

  it('resolves to denied on PERMISSION_DENIED', async () => {
    mockGeolocation((_success, error) => {
      error?.({ code: 1, message: 'User denied Geolocation' } as GeolocationPositionError)
    })

    const { result } = renderHook(() => useDevicePosition())

    await waitFor(() => expect(result.current.status).toBe('denied'))
    expect(result.current.position).toBeNull()
  })

  it('resolves to unavailable on a non-permission geolocation error', async () => {
    mockGeolocation((_success, error) => {
      error?.({ code: 2, message: 'Position unavailable' } as GeolocationPositionError)
    })

    const { result } = renderHook(() => useDevicePosition())

    await waitFor(() => expect(result.current.status).toBe('unavailable'))
    expect(result.current.position).toBeNull()
  })

  it('resolves to unavailable when navigator.geolocation does not exist', async () => {
    // @ts-expect-error simulate a browser without the Geolocation API
    delete navigator.geolocation

    const { result } = renderHook(() => useDevicePosition())

    await waitFor(() => expect(result.current.status).toBe('unavailable'))
    expect(result.current.position).toBeNull()
  })

  it('never throws when geolocation is missing', async () => {
    // @ts-expect-error simulate a browser without the Geolocation API
    delete navigator.geolocation

    let result: ReturnType<typeof renderHook<ReturnType<typeof useDevicePosition>, unknown>>['result']
    expect(() => {
      ;({ result } = renderHook(() => useDevicePosition()))
    }).not.toThrow()
    await waitFor(() => expect(result.current.status).toBe('unavailable'))
  })

  it('refresh() re-requests the current position on demand', async () => {
    const spy = mockGeolocation((success) => {
      success({ coords: { latitude: 1, longitude: 2 } } as GeolocationPosition)
    })

    const { result } = renderHook(() => useDevicePosition())
    await waitFor(() => expect(result.current.status).toBe('granted'))
    expect(spy).toHaveBeenCalledTimes(1)

    act(() => result.current.refresh())
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2))
  })

  it('calls getCurrentPosition with low-accuracy, ~8s timeout, ~60s maximumAge', async () => {
    const spy = mockGeolocation((success) => {
      success({ coords: { latitude: 1, longitude: 2 } } as GeolocationPosition)
    })

    renderHook(() => useDevicePosition())
    await waitFor(() => expect(spy).toHaveBeenCalled())

    const [, , options] = spy.mock.calls[0]
    expect(options).toMatchObject({
      enableHighAccuracy: false,
      timeout: 8000,
      maximumAge: 60_000,
    })
  })
})
