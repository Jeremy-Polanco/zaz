/**
 * Regression — a successful status change must land in the ['order', id] cache
 * right away. Mirrors the mobile spec of the same name.
 *
 * The order detail route reads ['order', orderId]; while useUpdateOrderStatus
 * only invalidated ['orders'], that route kept rendering the OLD status after a
 * successful advance, so a second click re-sent the same status and the API
 * answered "Transición inválida: X → X".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { Order } from './types'

const patch = vi.fn()
vi.mock('./api', () => ({
  api: { patch: (...args: unknown[]) => patch(...args) },
  TOKEN_KEY: 'dashgo.token',
}))

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
    patch.mockReset().mockResolvedValue({ data: freshOrder })
  })

  it('writes the server response into ["order", id] so the page flips at once', async () => {
    const client = makeClient()
    client.setQueryData(['order', 'order-1'], staleOrder)
    const wrapper = ({ children }: { children: ReactNode }) => (
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

  it('still invalidates the order list and the order detail query', async () => {
    const client = makeClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )

    const { result } = renderHook(() => useUpdateOrderStatus(), { wrapper })
    await result.current.mutateAsync({ id: 'order-1', status: 'delivered' })

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['order', 'order-1'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['orders'] })
  })
})
