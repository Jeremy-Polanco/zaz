import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { createTestQueryClient } from '../test/test-utils'

// The API caps address lat/lng at 7 decimal places
// (CreateAddressDto: @IsNumber({ maxDecimalPlaces: 7 })). Browser geolocation
// and Leaflet hand us full-precision floats, so the mutation hooks must round
// before sending — otherwise the server 400s with "lat must be a number…".
const post = vi.fn()
const patch = vi.fn()
vi.mock('./api', () => ({
  api: {
    post: (...args: unknown[]) => post(...args),
    patch: (...args: unknown[]) => patch(...args),
  },
  TOKEN_KEY: 'dashgo.token',
}))

import { useCreateAddress, useUpdateAddress } from './queries'

function wrapper({ children }: { children: ReactNode }) {
  const client = createTestQueryClient()
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe('address mutations round coordinates to ≤7 decimal places', () => {
  beforeEach(() => {
    post.mockReset().mockResolvedValue({ data: {} })
    patch.mockReset().mockResolvedValue({ data: {} })
  })

  it('useCreateAddress rounds high-precision GPS coords before POST', async () => {
    const { result } = renderHook(() => useCreateAddress(), { wrapper })
    await result.current.mutateAsync({
      label: 'Casa',
      line1: 'Avenida Tiradentes 1',
      lat: 18.472241234567, // 12 dp from geolocation
      lng: -69.840841987654,
    })
    expect(post).toHaveBeenCalledWith(
      '/me/addresses',
      expect.objectContaining({ lat: 18.4722412, lng: -69.840842 }),
    )
  })

  it('useUpdateAddress rounds coords when they are provided', async () => {
    const { result } = renderHook(() => useUpdateAddress(), { wrapper })
    await result.current.mutateAsync({
      id: 'a-1',
      lat: 40.840412345,
      lng: -73.939712345,
    })
    expect(patch).toHaveBeenCalledWith(
      '/me/addresses/a-1',
      expect.objectContaining({ lat: 40.8404123, lng: -73.9397123 }),
    )
  })

  it('useUpdateAddress leaves a label-only patch untouched (no coords sent)', async () => {
    const { result } = renderHook(() => useUpdateAddress(), { wrapper })
    await result.current.mutateAsync({ id: 'a-1', label: 'Trabajo' })
    const [, body] = patch.mock.calls[0]
    expect(body).toEqual({ label: 'Trabajo' })
  })
})
