import { useCallback, useSyncExternalStore } from 'react'

type SelectionState = { pendingSlug: string | null }

let state: SelectionState = { pendingSlug: null }
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

export const categorySelection = {
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  get() {
    return state
  },
  set(slug: string | null) {
    state = { pendingSlug: slug }
    emit()
  },
  consume(): string | null {
    const s = state.pendingSlug
    if (s !== null) {
      state = { pendingSlug: null }
      emit()
    }
    return s
  },
}

export function usePendingCategorySlug() {
  return useSyncExternalStore(
    useCallback((l) => categorySelection.subscribe(l), []),
    () => state,
    () => state,
  ).pendingSlug
}
