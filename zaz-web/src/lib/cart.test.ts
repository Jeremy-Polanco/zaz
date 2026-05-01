import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// ── Storage mock setup ────────────────────────────────────────────────────────
// The setup.ts mock redefines storage per test, but here we also need
// window.dispatchEvent to work so the useSyncExternalStore listener fires.
// We use a local store so each test starts fresh.

function makeStorageMock() {
  let store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value },
    removeItem: (key: string) => { delete store[key] },
    clear: () => { store = {} },
  }
}

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return React.createElement(QueryClientProvider, { client: qc }, children)
}

describe('cart (sessionStorage-backed signal)', () => {
  beforeEach(() => {
    // Replace sessionStorage with fresh mock before each test
    const mock = makeStorageMock()
    Object.defineProperty(window, 'sessionStorage', { value: mock, writable: true })
    // Also mock dispatchEvent so events "work" in JSDOM
    vi.spyOn(window, 'dispatchEvent').mockImplementation(() => true)
  })

  it('starts empty — totalItems is 0', async () => {
    const { useCart } = await import('./cart')
    const { result } = renderHook(() => useCart(), { wrapper })
    expect(result.current.totalItems).toBe(0)
    expect(Object.keys(result.current.items)).toHaveLength(0)
  })

  it('setQuantity adds an item to the cart', async () => {
    const { useCart } = await import('./cart')
    const { result } = renderHook(() => useCart(), { wrapper })

    act(() => {
      result.current.setQuantity('prod-1', 3)
    })

    // The hook reads from sessionStorage directly — verify storage was written
    expect(window.sessionStorage.getItem('zaz.pendingCart')).not.toBeNull()
  })

  it('setQuantity with quantity 0 removes the item', async () => {
    const { useCart } = await import('./cart')
    // First add item
    const { result } = renderHook(() => useCart(), { wrapper })

    act(() => {
      result.current.setQuantity('prod-1', 2)
    })
    act(() => {
      result.current.setQuantity('prod-1', 0)
    })

    // After removing the only item, sessionStorage entry should be gone
    expect(window.sessionStorage.getItem('zaz.pendingCart')).toBeNull()
  })

  it('clear empties the cart', async () => {
    const { useCart } = await import('./cart')
    const { result } = renderHook(() => useCart(), { wrapper })

    act(() => {
      result.current.setQuantity('prod-1', 5)
      result.current.setQuantity('prod-2', 2)
    })
    act(() => {
      result.current.clear()
    })

    expect(window.sessionStorage.getItem('zaz.pendingCart')).toBeNull()
  })

  it('totalItems sums all quantities correctly', async () => {
    // Set two items in sessionStorage before rendering
    window.sessionStorage.setItem(
      'zaz.pendingCart',
      JSON.stringify({ items: [{ productId: 'a', quantity: 3 }, { productId: 'b', quantity: 7 }] }),
    )
    const { useCart } = await import('./cart')
    const { result } = renderHook(() => useCart(), { wrapper })
    expect(result.current.totalItems).toBe(10)
  })

  it('clearCart (standalone export) removes sessionStorage entry', async () => {
    window.sessionStorage.setItem(
      'zaz.pendingCart',
      JSON.stringify({ items: [{ productId: 'x', quantity: 1 }] }),
    )
    const { clearCart } = await import('./cart')
    clearCart()
    expect(window.sessionStorage.getItem('zaz.pendingCart')).toBeNull()
  })
})
