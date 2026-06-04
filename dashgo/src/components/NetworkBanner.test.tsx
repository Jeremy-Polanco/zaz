/**
 * NetworkBanner (mobile) tests.
 *
 * NetInfo is mocked so we can drive `isConnected` transitions and assert that
 * the banner renders / hides correctly. The mock exposes the registered
 * listener so tests can invoke it synchronously.
 */
import React from 'react'
import { act, render } from '@testing-library/react-native'

// ── NetInfo mock ───────────────────────────────────────────────────────────────
type Listener = (info: { isConnected: boolean | null }) => void
const mockListeners: Listener[] = []
const mockFetchRef: { value: { isConnected: boolean | null } } = {
  value: { isConnected: true },
}

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: (cb: Listener) => {
      mockListeners.push(cb)
      return () => {
        const idx = mockListeners.indexOf(cb)
        if (idx >= 0) mockListeners.splice(idx, 1)
      }
    },
    fetch: () => Promise.resolve(mockFetchRef.value),
  },
}))

import { NetworkBanner } from './NetworkBanner'

function emit(isConnected: boolean | null) {
  act(() => {
    mockListeners.forEach((cb) => cb({ isConnected }))
  })
}

beforeEach(() => {
  mockListeners.length = 0
  mockFetchRef.value = { isConnected: true }
  jest.useFakeTimers()
})

afterEach(() => {
  jest.useRealTimers()
})

describe('NetworkBanner (mobile)', () => {
  it('renders nothing when online from the start', async () => {
    mockFetchRef.value = { isConnected: true }
    const { queryByTestId } = render(<NetworkBanner />)
    // flush the initial NetInfo.fetch().then(...)
    await act(async () => {
      await Promise.resolve()
    })
    expect(queryByTestId('network-banner-offline')).toBeNull()
    expect(queryByTestId('network-banner-restored')).toBeNull()
  })

  it('shows the offline banner when NetInfo reports disconnected', async () => {
    const { queryByTestId, getByTestId } = render(<NetworkBanner />)
    await act(async () => {
      await Promise.resolve()
    })

    emit(false)

    const banner = getByTestId('network-banner-offline')
    expect(banner).toBeTruthy()
    expect(queryByTestId('network-banner-restored')).toBeNull()
  })

  it('hides the offline banner and shows the restored toast when connection returns, then auto-dismisses', async () => {
    const { queryByTestId, getByTestId } = render(<NetworkBanner />)
    await act(async () => {
      await Promise.resolve()
    })

    // go offline
    emit(false)
    expect(getByTestId('network-banner-offline')).toBeTruthy()

    // go back online — offline banner replaced by restored toast
    emit(true)
    expect(queryByTestId('network-banner-offline')).toBeNull()
    expect(getByTestId('network-banner-restored')).toBeTruthy()

    // after 2s, restored toast auto-dismisses
    act(() => {
      jest.advanceTimersByTime(2000)
    })
    expect(queryByTestId('network-banner-restored')).toBeNull()
  })

  it('does not show the restored toast on cold boot when never offline', async () => {
    const { queryByTestId } = render(<NetworkBanner />)
    await act(async () => {
      await Promise.resolve()
    })

    // emit "online" multiple times without ever going offline first
    emit(true)
    emit(true)

    expect(queryByTestId('network-banner-restored')).toBeNull()
    expect(queryByTestId('network-banner-offline')).toBeNull()
  })
})
