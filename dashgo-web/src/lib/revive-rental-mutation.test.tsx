/**
 * useReviveRental: POST /admin/rentals/:id/revive y, al terminar bien, refresca
 * TODO lo que cuelga de ['admin', 'rentals'] (la lista y el resumen de KPIs):
 * el alquiler pasa de "Cancelado" a "Activo" y los contadores cambian.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

const post = vi.fn()
vi.mock('./api', () => ({
  api: { post: (...args: unknown[]) => post(...args) },
  TOKEN_KEY: 'dashgo.token',
}))

import { useReviveRental } from './queries'

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { ...renderHook(() => useReviveRental(), { wrapper }), invalidate }
}

describe('useReviveRental', () => {
  beforeEach(() => {
    post.mockReset().mockResolvedValue({ data: { id: 'rental-1', status: 'active' } })
  })

  it('hace POST a /admin/rentals/:id/revive y devuelve el alquiler', async () => {
    const { result } = setup()
    const data = await result.current.mutateAsync('rental-1')

    expect(post).toHaveBeenCalledWith('/admin/rentals/rental-1/revive')
    expect(data).toMatchObject({ status: 'active' })
  })

  it('refresca las queries ["admin","rentals"] (lista + resumen) al terminar bien', async () => {
    const { result, invalidate } = setup()
    await result.current.mutateAsync('rental-1')

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin', 'rentals'] })
  })

  it('NO refresca si el servidor rechaza la reactivación', async () => {
    post.mockRejectedValueOnce({ response: { data: { message: 'x' } } })
    const { result, invalidate } = setup()

    await expect(result.current.mutateAsync('rental-1')).rejects.toBeDefined()
    expect(invalidate).not.toHaveBeenCalled()
  })
})
