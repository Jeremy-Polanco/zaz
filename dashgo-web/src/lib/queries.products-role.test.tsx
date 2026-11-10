import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { createTestQueryClient } from '../test/test-utils'
import type { AuthUser } from './types'

// El catálogo público del asociado (solo su lista, a precio mayorista) difiere
// del del cliente. Si ambos compartieran la clave ['products'], un asociado que
// inicia sesión en un navegador que ya cargó el catálogo vería el del cliente.
const get = vi.fn()
vi.mock('./api', () => ({
  api: { get: (...args: unknown[]) => get(...args) },
  TOKEN_KEY: 'dashgo.token',
}))

const currentUser = vi.fn()
vi.mock('./auth', () => ({
  useCurrentUser: () => currentUser(),
}))

import { useProducts } from './queries'
import { productsQueryKey } from './associate'

function me(role: AuthUser['role']): AuthUser {
  return { id: 'u-1', role } as AuthUser
}

function setup() {
  const client = createTestQueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, wrapper }
}

describe('useProducts — clave por rol', () => {
  beforeEach(() => {
    get.mockReset()
    currentUser.mockReset()
    get.mockResolvedValue({ data: [] })
  })

  it('usa la clave del asociado cuando el usuario es asociado', async () => {
    currentUser.mockReturnValue({ data: me('associate'), isPending: false })
    const { client, wrapper } = setup()

    const { result } = renderHook(() => useProducts(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(
      client.getQueryCache().find({ queryKey: productsQueryKey('associate') }),
    ).toBeDefined()
    expect(
      client.getQueryCache().find({ queryKey: productsQueryKey('client') }),
    ).toBeUndefined()
  })

  it('cliente y asociado no comparten caché: al cambiar el rol se vuelve a pedir', async () => {
    const { wrapper } = setup()

    currentUser.mockReturnValue({ data: me('client'), isPending: false })
    const { result, rerender } = renderHook(() => useProducts(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(get).toHaveBeenCalledTimes(1)

    currentUser.mockReturnValue({ data: me('associate'), isPending: false })
    rerender()
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2))
  })

  it('sin sesión usa la clave de invitado', async () => {
    currentUser.mockReturnValue({ data: null, isPending: false })
    const { client, wrapper } = setup()

    const { result } = renderHook(() => useProducts(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(
      client.getQueryCache().find({ queryKey: productsQueryKey(undefined) }),
    ).toBeDefined()
  })

  it('no pide el catálogo mientras no se sabe el rol (evita cargar el del cliente)', () => {
    currentUser.mockReturnValue({ data: undefined, isPending: true })
    const { wrapper } = setup()

    renderHook(() => useProducts(), { wrapper })

    expect(get).not.toHaveBeenCalled()
  })

  it('las mutaciones que invalidan ["products"] siguen alcanzándola por prefijo', async () => {
    currentUser.mockReturnValue({ data: me('associate'), isPending: false })
    const { client, wrapper } = setup()

    const { result } = renderHook(() => useProducts(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(
      client.getQueryState(productsQueryKey('associate'))?.isInvalidated,
    ).toBe(false)

    await client.invalidateQueries({ queryKey: ['products'], refetchType: 'none' })

    expect(
      client.getQueryState(productsQueryKey('associate'))?.isInvalidated,
    ).toBe(true)
  })
})
