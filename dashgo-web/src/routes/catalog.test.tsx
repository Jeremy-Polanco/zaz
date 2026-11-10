import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithRouter } from '../test/test-utils'
import type { AuthUser, Category } from '../lib/types'

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
vi.mock('../lib/queries', () => ({
  useProducts: vi.fn(),
  useCategories: vi.fn(),
  useCurrentUser: vi.fn(),
  useMySubscription: vi.fn(() => ({ data: null })),
}))

import { useCategories, useCurrentUser, useProducts } from '../lib/queries'
import { CatalogPage, shouldShowCategoryPicker } from './catalog'

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

describe('CatalogPage — catálogo vacío', () => {
  const categories = [
    { id: 'c1', slug: 'agua', name: 'Agua', iconEmoji: null },
  ] as unknown as Category[]

  function setup(role: AuthUser['role']) {
    vi.mocked(useProducts).mockReturnValue({
      data: [],
      isPending: false,
    } as unknown as ReturnType<typeof useProducts>)
    vi.mocked(useCategories).mockReturnValue({
      data: categories,
    } as unknown as ReturnType<typeof useCategories>)
    vi.mocked(useCurrentUser).mockReturnValue({
      data: { id: 'u-1', role, fullName: 'Ana Pérez' },
    } as unknown as ReturnType<typeof useCurrentUser>)
    renderWithRouter(CatalogPage)
  }

  beforeEach(() => vi.clearAllMocks())

  it('el asociado con su lista vacía ve el mensaje de asociados', async () => {
    setup('associate')
    expect(
      await screen.findByText('Todavía no hay productos disponibles para asociados.'),
    ).toBeInTheDocument()
    expect(
      screen.queryByText('No hay productos disponibles ahora mismo.'),
    ).not.toBeInTheDocument()
  })

  it('el cliente con el catálogo vacío sigue viendo el mensaje de siempre', async () => {
    setup('client')
    expect(
      await screen.findByText('No hay productos disponibles ahora mismo.'),
    ).toBeInTheDocument()
    expect(
      screen.queryByText('Todavía no hay productos disponibles para asociados.'),
    ).not.toBeInTheDocument()
  })
})
