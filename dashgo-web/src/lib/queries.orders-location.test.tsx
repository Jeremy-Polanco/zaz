import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { createTestQueryClient } from '../test/test-utils'
import type { Order } from './types'

// GET /orders?lat&lng — staff dispatch list sorted nearest-first from the
// device's position; the API also answers X-Dispatch-Origin (device | saved |
// none) so the UI can tell the admin why it fell back to date order.
const get = vi.fn()
vi.mock('./api', () => ({
  api: { get: (...args: unknown[]) => get(...args) },
  TOKEN_KEY: 'dashgo.token',
}))

import { useOrders, useOrdersDispatchOrigin } from './queries'

function makeOrder(id: string): Order {
  return {
    id,
    customerId: 'cust-1',
    status: 'pending_quote',
    deliveryAddress: null,
    subtotal: '10.00',
    pointsRedeemed: '0.00',
    shipping: '0.00',
    tax: '0.00',
    taxRate: '0',
    totalAmount: '10.00',
    paymentMethod: 'cash',
    items: [],
    createdAt: new Date().toISOString(),
  }
}

function wrapperFor(client = createTestQueryClient()) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

describe('useOrders — lat/lng params', () => {
  beforeEach(() => get.mockReset())

  it('calls GET /orders with no params by default (customer screens unaffected)', async () => {
    const order = makeOrder('o1')
    get.mockResolvedValue({ data: [order], headers: {} })

    const { result } = renderHook(() => useOrders(), { wrapper: wrapperFor() })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(get).toHaveBeenCalledWith('/orders', { params: undefined })
    expect(result.current.data).toEqual([order])
  })

  it('sends lat/lng as query params when both are numbers', async () => {
    get.mockResolvedValue({ data: [], headers: {} })

    const { result } = renderHook(() => useOrders({ lat: 18.47, lng: -69.9 }), {
      wrapper: wrapperFor(),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(get).toHaveBeenCalledWith('/orders', {
      params: { lat: 18.47, lng: -69.9 },
    })
  })

  it('omits params when only one coordinate is present', async () => {
    get.mockResolvedValue({ data: [], headers: {} })

    const { result } = renderHook(() => useOrders({ lat: 18.47 }), {
      wrapper: wrapperFor(),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(get).toHaveBeenCalledWith('/orders', { params: undefined })
  })
})

describe('useOrdersDispatchOrigin', () => {
  beforeEach(() => get.mockReset())

  it('reads the X-Dispatch-Origin response header', async () => {
    get.mockResolvedValue({
      data: [makeOrder('o1')],
      headers: { 'x-dispatch-origin': 'device' },
    })

    const { result } = renderHook(() => useOrdersDispatchOrigin({ lat: 1, lng: 2 }), {
      wrapper: wrapperFor(),
    })

    await waitFor(() => expect(result.current.data).toBe('device'))
  })

  it('is null when the header is absent', async () => {
    get.mockResolvedValue({ data: [], headers: {} })

    const { result } = renderHook(() => useOrdersDispatchOrigin(), {
      wrapper: wrapperFor(),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toBeNull()
  })

  it('shares the same request as useOrders for the same params — no extra fetch', async () => {
    get.mockResolvedValue({
      data: [makeOrder('o1')],
      headers: { 'x-dispatch-origin': 'saved' },
    })
    const client = createTestQueryClient()
    const wrapper = wrapperFor(client)

    const orders = renderHook(() => useOrders({ lat: 1, lng: 2 }), { wrapper })
    const origin = renderHook(() => useOrdersDispatchOrigin({ lat: 1, lng: 2 }), {
      wrapper,
    })

    await waitFor(() => expect(orders.result.current.isSuccess).toBe(true))
    await waitFor(() => expect(origin.result.current.data).toBe('saved'))
    expect(get).toHaveBeenCalledTimes(1)
  })
})

describe('useOrders — no loading flash when coords resolve after mount', () => {
  beforeEach(() => get.mockReset())

  it('keeps showing the previous list while the coords-based query loads', async () => {
    const client = createTestQueryClient()
    const firstOrder = makeOrder('o1')
    const secondOrder = makeOrder('o2')
    get.mockResolvedValueOnce({ data: [firstOrder], headers: {} })

    const { result, rerender } = renderHook(
      ({ params }: { params?: { lat?: number; lng?: number } }) => useOrders(params),
      {
        wrapper: wrapperFor(client),
        initialProps: { params: undefined as { lat?: number; lng?: number } | undefined },
      },
    )
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    let resolveSecond!: (v: unknown) => void
    get.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSecond = resolve
      }),
    )
    rerender({ params: { lat: 18.47, lng: -69.9 } })

    // The new queryKey (with coords) hasn't resolved yet — the hook must not
    // fall back to isPending/undefined, or the page would flash a full-screen
    // "Cargando…" every time geolocation resolves.
    expect(result.current.isPending).toBe(false)
    expect(result.current.data).toEqual([firstOrder])

    resolveSecond({ data: [secondOrder], headers: {} })
    await waitFor(() => expect(result.current.data).toEqual([secondOrder]))
  })
})
