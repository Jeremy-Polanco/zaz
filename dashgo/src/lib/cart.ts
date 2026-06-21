import { useCallback, useSyncExternalStore } from 'react'

type CartState = {
  items: Record<string, number>
}

let state: CartState = { items: {} }
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

export const cart = {
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  get() {
    return state
  },
  update(productId: string, delta: number) {
    const next = { ...state.items }
    next[productId] = Math.max(0, (next[productId] ?? 0) + delta)
    if (next[productId] === 0) delete next[productId]
    state = { items: next }
    emit()
  },
  set(productId: string, qty: number) {
    const q = Math.max(0, Math.floor(qty))
    const next = { ...state.items }
    if (q === 0) delete next[productId]
    else next[productId] = q
    state = { items: next }
    emit()
  },
  clear() {
    state = { items: {} }
    emit()
  },
}

export function useCart() {
  const snapshot = useSyncExternalStore(
    useCallback((l) => cart.subscribe(l), []),
    () => state,
    () => state,
  )
  return snapshot
}
