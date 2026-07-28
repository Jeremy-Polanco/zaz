import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../test/test-utils'
import type { Category, Product } from '../lib/types'

// ── Module mocks ───────────────────────────────────────────────────────────────
// `mockNavigate` is shared with the tests so the routing calls can be asserted.
const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }))

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const original = await importOriginal<typeof import('@tanstack/react-router')>()
  return {
    ...original,
    useNavigate: () => mockNavigate,
    createFileRoute: () => () => ({}),
    redirect: vi.fn(),
    isRedirect: vi.fn(() => false),
  }
})

vi.mock('../lib/queries', () => ({
  useCategories: vi.fn(),
  useProducts: vi.fn(),
}))
vi.mock('../lib/api', () => ({
  api: { get: vi.fn() },
  TOKEN_KEY: 'dashgo.token',
  categoryImageUrl: vi.fn((p: string) => p),
  productImageUrl: vi.fn(() => 'http://fake-image'),
}))

import { useCategories, useProducts } from '../lib/queries'
import { HomePage } from './home'

const mockUseCategories = vi.mocked(useCategories)
const mockUseProducts = vi.mocked(useProducts)

// ── Fixtures ───────────────────────────────────────────────────────────────────

const sampleCategories: Category[] = [
  { id: 'cat-1', name: 'Agua', slug: 'agua', iconEmoji: '💧', displayOrder: 1 },
  {
    id: 'cat-2',
    name: 'Botellón',
    slug: 'botellon',
    iconEmoji: '🫙',
    displayOrder: 2,
  },
]

/** Only `category.slug` matters to the page's per-category tally. */
function productIn(slug: string, id: string): Product {
  return { id, category: { slug } } as unknown as Product
}

function setup({
  categories = sampleCategories,
  products = [] as Product[],
  categoriesPending = false,
  productsPending = false,
} = {}) {
  mockUseCategories.mockReturnValue({
    data: categoriesPending ? undefined : categories,
    isPending: categoriesPending,
    isError: false,
    error: null,
  } as unknown as ReturnType<typeof useCategories>)

  mockUseProducts.mockReturnValue({
    data: productsPending ? undefined : products,
    isPending: productsPending,
    isError: false,
    error: null,
  } as unknown as ReturnType<typeof useProducts>)
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('HomePage — category grid', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders one card per category plus the see-all card', () => {
    setup()
    renderWithProviders(<HomePage />)

    expect(screen.getAllByRole('button')).toHaveLength(
      sampleCategories.length + 1,
    )
    expect(screen.getByText('Agua')).toBeInTheDocument()
    expect(screen.getByText('Botellón')).toBeInTheDocument()
  })

  it('greets the customer', () => {
    setup()
    renderWithProviders(<HomePage />)

    expect(screen.getByText('¿Qué necesitas?')).toBeInTheDocument()
  })

  it('says so when no categories are loaded, and still offers the catalog', () => {
    setup({ categories: [] })
    renderWithProviders(<HomePage />)

    expect(
      screen.getByText(/no hay categorías cargadas/i),
    ).toBeInTheDocument()
    expect(screen.getByText('Ver todo el catálogo')).toBeInTheDocument()
  })

  it.each([
    ['categories', { categoriesPending: true }],
    ['products', { productsPending: true }],
  ] as const)('waits while %s are loading', (_label, pending) => {
    setup(pending)
    renderWithProviders(<HomePage />)

    expect(screen.getByText('Cargando categorías…')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// The per-category tally is a real `useMemo` over the product list. The old
// driver hardcoded `productCount={0}` on every card, so this never ran.
// ---------------------------------------------------------------------------

describe('HomePage — product counts', () => {
  beforeEach(() => vi.clearAllMocks())

  it('counts the products belonging to each category', () => {
    setup({
      products: [
        productIn('agua', 'p1'),
        productIn('agua', 'p2'),
        productIn('agua', 'p3'),
        productIn('botellon', 'p4'),
      ],
    })
    renderWithProviders(<HomePage />)

    expect(
      screen.getByRole('button', { name: 'Categoría Agua, 3 productos' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Categoría Botellón, 1 productos' }),
    ).toBeInTheDocument()
  })

  it('shows zero for a category with no products', () => {
    setup({ products: [productIn('agua', 'p1')] })
    renderWithProviders(<HomePage />)

    expect(
      screen.getByRole('button', { name: 'Categoría Botellón, 0 productos' }),
    ).toBeInTheDocument()
  })

  it('totals every product on the see-all card, including uncategorised ones', () => {
    setup({
      products: [
        productIn('agua', 'p1'),
        productIn('botellon', 'p2'),
        { id: 'p3', category: null } as unknown as Product,
      ],
    })
    renderWithProviders(<HomePage />)

    expect(
      screen.getByRole('button', { name: 'Ver todo el catálogo, 3 productos' }),
    ).toBeInTheDocument()
  })
})

describe('HomePage — navigation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('opens the catalog filtered by the chosen category', async () => {
    setup()
    renderWithProviders(<HomePage />)

    await userEvent.click(
      screen.getByRole('button', { name: /Categoría Agua/ }),
    )

    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/catalog',
      search: { cat: 'agua' },
    })
  })

  it('opens the unfiltered catalog from the see-all card', async () => {
    setup()
    renderWithProviders(<HomePage />)

    await userEvent.click(
      screen.getByRole('button', { name: /Ver todo el catálogo/ }),
    )

    expect(mockNavigate).toHaveBeenCalledWith({ to: '/catalog' })
  })
})
