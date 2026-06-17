import { describe, it, expect, vi } from 'vitest'

// Mirror home.test.tsx: keep router + api side effects out of the way so we can
// import the real catalog module (which calls createFileRoute at load time).
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const original = await importOriginal<typeof import('@tanstack/react-router')>()
  return {
    ...original,
    useNavigate: () => vi.fn(),
    useSearch: () => ({}),
    createFileRoute: () => () => ({}),
    redirect: vi.fn(),
    isRedirect: vi.fn(() => false),
  }
})
vi.mock('../lib/api', () => ({ api: { get: vi.fn() }, TOKEN_KEY: 'dashgo.token' }))

import { shouldShowCategoryPicker } from './catalog'

describe('shouldShowCategoryPicker — catalog is category-first (web↔mobile parity)', () => {
  it('shows the picker on arrival: no category selected and no search', () => {
    expect(shouldShowCategoryPicker(undefined, '')).toBe(true)
    // whitespace-only query is not a real search
    expect(shouldShowCategoryPicker(undefined, '   ')).toBe(true)
  })

  it('hides the picker once a category is selected', () => {
    expect(shouldShowCategoryPicker('agua', '')).toBe(false)
  })

  it('hides the picker while searching, so a query spans the whole catalog', () => {
    expect(shouldShowCategoryPicker(undefined, 'galon')).toBe(false)
    expect(shouldShowCategoryPicker('agua', 'galon')).toBe(false)
  })
})
