/**
 * El catálogo público del asociado (solo su lista, a precio mayorista) difiere
 * del del cliente: si compartieran la clave ['products'], un asociado que
 * inicia sesión en un dispositivo que ya cargó el catálogo vería el del cliente.
 *
 * Invitado (Apple 5.1.1): useCurrentUser nunca se deshabilita — sin token
 * resuelve `null` — así que esperar al usuario no deja al invitado sin catálogo.
 */
import React from 'react'
import { renderHook, waitFor } from '@testing-library/react-native'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { AuthUser } from './types'

const mockGet = jest.fn()

jest.mock('./api', () => ({
  API_URL: 'http://localhost:3000',
  api: { get: (...args: unknown[]) => mockGet(...args) },
  setSession: jest.fn(),
  clearSession: jest.fn(),
  productImageUrl: jest.fn(),
}))
jest.mock('./push', () => ({ unregisterPushToken: jest.fn() }))
const mockGetAccessToken = jest.fn()
jest.mock('./token-storage', () => ({
  getAccessToken: (...args: unknown[]) => mockGetAccessToken(...args),
}))

import { useProducts } from './queries'
import { productsQueryKey } from './associate'

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: 0 },
      mutations: { retry: false },
    },
  })
}

function setup() {
  const client = makeClient()
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, wrapper }
}

function loginAs(role: AuthUser['role']) {
  mockGetAccessToken.mockResolvedValue('token')
  mockGet.mockImplementation(async (url: string) =>
    url === '/auth/me' ? { data: { id: 'u-1', role } } : { data: [] },
  )
}

describe('useProducts — clave por rol', () => {
  beforeEach(() => {
    mockGet.mockReset()
    mockGetAccessToken.mockReset()
  })

  it('usa la clave del asociado cuando el usuario es asociado', async () => {
    loginAs('associate')
    const { client, wrapper } = setup()

    const { result } = renderHook(() => useProducts(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(
      client.getQueryCache().find({ queryKey: productsQueryKey('associate') }),
    ).toBeDefined()
    expect(
      client.getQueryCache().find({ queryKey: productsQueryKey('client') }),
    ).toBeUndefined()
    expect(mockGet).toHaveBeenCalledWith('/products')
  })

  it('el cliente usa su propia clave', async () => {
    loginAs('client')
    const { client, wrapper } = setup()

    const { result } = renderHook(() => useProducts(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(
      client.getQueryCache().find({ queryKey: ['products', 'public', 'client'] }),
    ).toBeDefined()
  })

  it('el invitado (sin token) sigue pidiendo el catálogo con la clave de invitado', async () => {
    mockGetAccessToken.mockResolvedValue(null)
    mockGet.mockResolvedValue({ data: [] })
    const { client, wrapper } = setup()

    const { result } = renderHook(() => useProducts(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(
      client.getQueryCache().find({ queryKey: ['products', 'public', 'guest'] }),
    ).toBeDefined()
    expect(mockGet).toHaveBeenCalledWith('/products')
    expect(mockGet).not.toHaveBeenCalledWith('/auth/me')
  })

  it('las mutaciones que invalidan ["products"] siguen alcanzándola por prefijo', async () => {
    loginAs('associate')
    const { client, wrapper } = setup()

    const { result } = renderHook(() => useProducts(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    await client.invalidateQueries({ queryKey: ['products'], refetchType: 'none' })

    expect(
      client.getQueryState(productsQueryKey('associate'))?.isInvalidated,
    ).toBe(true)
  })
})
