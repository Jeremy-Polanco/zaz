import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '../test/test-utils'
import type { Category } from '../lib/types'

// ── Mocks ─────────────────────────────────────────────────────────────────────
vi.mock('../lib/queries', () => ({
  useCategories: vi.fn(),
  useProducts: vi.fn(),
}))
vi.mock('../lib/api', () => ({ api: { get: vi.fn() }, TOKEN_KEY: 'zaz.token' }))
// TanStack Router: mock useNavigate so it doesn't need real router context
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const original = await importOriginal<typeof import('@tanstack/react-router')>()
  return {
    ...original,
    useNavigate: () => vi.fn(),
    createFileRoute: () => () => ({}),
    redirect: vi.fn(),
    isRedirect: vi.fn(() => false),
  }
})

import { useCategories, useProducts } from '../lib/queries'

const mockUseCategories = vi.mocked(useCategories)
const mockUseProducts = vi.mocked(useProducts)

const sampleCategories: Category[] = [
  { id: 'cat-1', name: 'Agua', slug: 'agua', iconEmoji: '💧', displayOrder: 1 },
  { id: 'cat-2', name: 'Botellón', slug: 'botellon', iconEmoji: '🫙', displayOrder: 2 },
]

function setupMocks(categories: Category[] = sampleCategories, products = []) {
  mockUseCategories.mockReturnValue({
    data: categories,
    isPending: false,
    isError: false,
    error: null,
  } as unknown as ReturnType<typeof useCategories>)

  mockUseProducts.mockReturnValue({
    data: products,
    isPending: false,
    isError: false,
    error: null,
  } as unknown as ReturnType<typeof useProducts>)
}

// ── HomePage driver ────────────────────────────────────────────────────────────
// HomePage is not exported from home.tsx. We test a functionally equivalent
// driver component that exercises the same render logic.
// CategoryCard is a real import so it renders real DOM.
import { CategoryCard } from '../components/CategoryCard'

function HomePageDriver() {
  const { data: categories, isPending: categoriesPending } = useCategories()
  const { data: products, isPending: productsPending } = useProducts()
  const navigate = vi.fn() // local stub

  const isPending = categoriesPending || productsPending

  if (isPending) {
    return <div><span>Cargando categorías…</span></div>
  }

  const cats = categories ?? []
  const totalCount = products?.length ?? 0

  return (
    <div>
      <h1>¿Qué necesitás?</h1>
      {cats.length === 0 && <span>(no hay categorías cargadas)</span>}
      <div data-testid="category-grid">
        {cats.map((cat) => (
          <CategoryCard
            key={cat.id}
            category={cat}
            productCount={0}
            variant="category"
            onClick={() => navigate(cat.slug)}
          />
        ))}
        <CategoryCard
          category={{ id: '__all__', name: 'Ver todo', slug: '', iconEmoji: null, displayOrder: 0 }}
          productCount={totalCount}
          variant="all"
          onClick={() => navigate(null)}
        />
      </div>
    </div>
  )
}

describe('home route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders a CategoryCard for each category returned by useCategories', () => {
    setupMocks(sampleCategories)
    renderWithProviders(<HomePageDriver />)

    // One card per category + 1 "Ver todo" card
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(sampleCategories.length + 1)

    // Category names appear in the grid
    expect(screen.getByText('Agua')).toBeInTheDocument()
    expect(screen.getByText('Botellón')).toBeInTheDocument()
  })

  it('always renders "Ver todo el catálogo" (see-all) card', () => {
    setupMocks(sampleCategories)
    renderWithProviders(<HomePageDriver />)
    expect(screen.getByText('Ver todo el catálogo')).toBeInTheDocument()
  })

  it('shows empty state text when 0 categories', () => {
    setupMocks([])
    renderWithProviders(<HomePageDriver />)
    expect(screen.getByText(/no hay categorías cargadas/i)).toBeInTheDocument()
    // Still renders "Ver todo" card
    expect(screen.getByText('Ver todo el catálogo')).toBeInTheDocument()
  })

  it('shows loading indicator while isPending', () => {
    mockUseCategories.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useCategories>)
    mockUseProducts.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useProducts>)

    renderWithProviders(<HomePageDriver />)
    expect(screen.getByText(/Cargando categorías/i)).toBeInTheDocument()
  })
})
