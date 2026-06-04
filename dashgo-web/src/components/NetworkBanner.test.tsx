/**
 * NetworkBanner (web) tests.
 *
 * Drives the banner by stubbing `navigator.onLine` and dispatching real
 * `online`/`offline` events on `window`. Uses fake timers to flush the
 * auto-dismiss for the restored toast.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { NetworkBanner, notifyNetworkError } from './NetworkBanner'

function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', {
    value,
    writable: true,
    configurable: true,
  })
}

beforeEach(() => {
  setOnline(true)
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('NetworkBanner (web)', () => {
  it('renders nothing when online from the start', () => {
    setOnline(true)
    render(<NetworkBanner />)
    expect(screen.queryByTestId('network-banner-offline')).toBeNull()
    expect(screen.queryByTestId('network-banner-restored')).toBeNull()
    expect(screen.queryByTestId('network-banner-error')).toBeNull()
  })

  it('renders the offline banner immediately when navigator.onLine is false on mount', () => {
    setOnline(false)
    render(<NetworkBanner />)
    expect(screen.getByTestId('network-banner-offline')).toBeInTheDocument()
    expect(
      screen.getByText('Sin conexión a internet. Revisá tu red.'),
    ).toBeInTheDocument()
  })

  it('reacts to window offline / online events with a transient restored toast', () => {
    setOnline(true)
    render(<NetworkBanner />)
    expect(screen.queryByTestId('network-banner-offline')).toBeNull()

    // simulate going offline
    act(() => {
      setOnline(false)
      window.dispatchEvent(new Event('offline'))
    })
    expect(screen.getByTestId('network-banner-offline')).toBeInTheDocument()

    // simulate going back online
    act(() => {
      setOnline(true)
      window.dispatchEvent(new Event('online'))
    })
    expect(screen.queryByTestId('network-banner-offline')).toBeNull()
    expect(screen.getByTestId('network-banner-restored')).toBeInTheDocument()

    // auto-dismiss after 2s
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(screen.queryByTestId('network-banner-restored')).toBeNull()
  })

  it('does not show the restored toast on a spurious online event when never offline', () => {
    setOnline(true)
    render(<NetworkBanner />)

    act(() => {
      window.dispatchEvent(new Event('online'))
    })

    expect(screen.queryByTestId('network-banner-restored')).toBeNull()
    expect(screen.queryByTestId('network-banner-offline')).toBeNull()
  })

  it('shows a transient "Sin conexión" toast when notifyNetworkError() fires', () => {
    setOnline(true)
    render(<NetworkBanner />)

    act(() => {
      notifyNetworkError()
    })

    expect(screen.getByTestId('network-banner-error')).toBeInTheDocument()
    expect(screen.getByText('Sin conexión')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(screen.queryByTestId('network-banner-error')).toBeNull()
  })

  it('does not overlay the network-error toast on top of the persistent offline banner', () => {
    setOnline(true)
    render(<NetworkBanner />)

    act(() => {
      setOnline(false)
      window.dispatchEvent(new Event('offline'))
    })
    expect(screen.getByTestId('network-banner-offline')).toBeInTheDocument()

    act(() => {
      notifyNetworkError()
    })

    // offline banner remains; no separate error banner appears
    expect(screen.getByTestId('network-banner-offline')).toBeInTheDocument()
    expect(screen.queryByTestId('network-banner-error')).toBeNull()
  })
})
