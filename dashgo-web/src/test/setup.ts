import '@testing-library/jest-dom'

// RTL v16+ handles cleanup automatically via afterEach.
// Explicit call kept here as a safety net for edge cases.
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'

afterEach(() => {
  cleanup()
})

// ── sessionStorage mock ────────────────────────────────────────────────────────
// jsdom provides sessionStorage/localStorage but events don't cross "windows".
// Provide simple stubs so cart tests work without DOM event complexities.
beforeEach(() => {
  const storageMock = (() => {
    let store: Record<string, string> = {}
    return {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => { store[key] = value },
      removeItem: (key: string) => { delete store[key] },
      clear: () => { store = {} },
    }
  })()

  Object.defineProperty(window, 'sessionStorage', {
    value: storageMock,
    writable: true,
  })

  Object.defineProperty(window, 'localStorage', {
    value: (() => {
      let store: Record<string, string> = {}
      return {
        getItem: (key: string) => store[key] ?? null,
        setItem: (key: string, value: string) => { store[key] = value },
        removeItem: (key: string) => { delete store[key] },
        clear: () => { store = {} },
      }
    })(),
    writable: true,
  })
})

// ── window.location mock ───────────────────────────────────────────────────────
// Some queries redirect via window.location.href. Prevent JSDOM errors.
Object.defineProperty(window, 'location', {
  value: { href: 'http://localhost/', assign: vi.fn(), replace: vi.fn() },
  writable: true,
})
