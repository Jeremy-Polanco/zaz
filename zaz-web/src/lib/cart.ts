import { useSyncExternalStore } from 'react'

const STORAGE_KEY = 'zaz.pendingCart'
const EVENT_NAME = 'zaz:cart-changed'

export type CartItems = Record<string, number>

type StoredCart = {
  items: { productId: string; quantity: number }[]
}

function readRaw(): StoredCart | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as StoredCart) : null
  } catch {
    return null
  }
}

function writeRaw(value: StoredCart | null) {
  if (!value || value.items.length === 0) {
    sessionStorage.removeItem(STORAGE_KEY)
  } else {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value))
  }
  window.dispatchEvent(new Event(EVENT_NAME))
}

function subscribe(callback: () => void) {
  window.addEventListener(EVENT_NAME, callback)
  window.addEventListener('storage', callback)
  return () => {
    window.removeEventListener(EVENT_NAME, callback)
    window.removeEventListener('storage', callback)
  }
}

function toItems(stored: StoredCart | null): CartItems {
  if (!stored) return EMPTY
  const out: CartItems = {}
  for (const it of stored.items) out[it.productId] = it.quantity
  return out
}

const EMPTY: CartItems = Object.freeze({}) as CartItems

let snapshotCache: { stored: StoredCart | null; items: CartItems } | null = null

function getSnapshot(): CartItems {
  const stored = readRaw()
  if (snapshotCache && snapshotCache.stored === stored) return snapshotCache.items
  const items = toItems(stored)
  const prev = snapshotCache?.items
  if (prev && shallowEqual(prev, items)) {
    snapshotCache = { stored, items: prev }
    return prev
  }
  snapshotCache = { stored, items }
  return items
}

function shallowEqual(a: CartItems, b: CartItems) {
  const ak = Object.keys(a)
  const bk = Object.keys(b)
  if (ak.length !== bk.length) return false
  for (const k of ak) if (a[k] !== b[k]) return false
  return true
}

export function useCart() {
  const items = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY)

  const setQuantity = (productId: string, quantity: number) => {
    const stored = readRaw()
    const base: StoredCart = stored ?? { items: [] }
    const next = base.items.filter((it) => it.productId !== productId)
    if (quantity > 0) next.push({ productId, quantity })
    writeRaw({ items: next })
  }

  const update = (productId: string, delta: number) => {
    const current = items[productId] ?? 0
    setQuantity(productId, Math.max(0, current + delta))
  }

  const clear = () => writeRaw(null)

  const totalItems = Object.values(items).reduce((a, b) => a + b, 0)

  return { items, totalItems, update, setQuantity, clear }
}

export function clearCart() {
  writeRaw(null)
}
