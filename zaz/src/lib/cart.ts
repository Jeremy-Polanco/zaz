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
