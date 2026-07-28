/**
 * Regression — a successful status change must land in the ['order', id] cache
 * right away.
 *
 * The super order-detail screen reads ['order', orderId] behind a 10s poll and
 * a 30s staleTime. While useUpdateOrderStatus only invalidated ['orders'], that
 * screen kept rendering the OLD status for up to 10s after a successful
 * advance — the button still read "Salir a entregar" and had already
 * re-enabled itself. Drivers tapped again and the API answered
 * "Transición inválida: in_delivery_route → in_delivery_route".
 */
import React from 'react'
import { renderHook } from '@testing-library/react-native'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Order } from './types'

const mockPatch = jest.fn()

jest.mock('./api', () => ({
  API_URL: 'http://localhost:3000',
  api: { patch: (...args: unknown[]) => mockPatch(...args) },
  setSession: jest.fn(),
  clearSession: jest.fn(),
  productImageUrl: jest.fn(),
}))
jest.mock('./push', () => ({ unregisterPushToken: jest.fn() }))
jest.mock('./token-storage', () => ({ getAccessToken: jest.fn() }))

import { useUpdateOrderStatus } from './queries'

const staleOrder = {
  id: 'order-1',
  status: 'confirmed_by_colmado',
} as unknown as Order

const freshOrder = {
  id: 'order-1',
  status: 'in_delivery_route',
} as unknown as Order

// gcTime: Infinity — an order seeded with setQueryData has no observer here,
// and the default gcTime would evict it before we can assert on it.
function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: 0 },
      mutations: { retry: false },
    },
  })
}

describe('useUpdateOrderStatus keeps the order detail cache honest', () => {
  beforeEach(() => {
    mockPatch.mockReset().mockResolvedValue({ data: freshOrder })
  })

  it('writes the server response into ["order", id] so the screen flips at once', async () => {
    const client = makeClient()
    client.setQueryData(['order', 'order-1'], staleOrder)
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )

    const { result } = renderHook(() => useUpdateOrderStatus(), { wrapper })
    await result.current.mutateAsync({
      id: 'order-1',
      status: 'in_delivery_route',
    })

    expect(client.getQueryData(['order', 'order-1'])).toMatchObject({
      status: 'in_delivery_route',
    })
  })

  it('still invalidates the route list and the order detail query', async () => {
    const client = makeClient()
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )

    const { result } = renderHook(() => useUpdateOrderStatus(), { wrapper })
    await result.current.mutateAsync({ id: 'order-1', status: 'delivered' })

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['order', 'order-1'],
    })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['orders'] })
  })
})
