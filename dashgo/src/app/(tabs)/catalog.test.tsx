/**
 * T85 — Catalog rental badge tests (RED → GREEN with T86 impl)
 *
 * Scenarios:
 *   1. Rental product shows "Alquiler" badge text
 *   2. Rental product shows monthly price "$20" in the badge
 *   3. Single-payment product does NOT show rental badge
 */
import React from 'react'
import { fireEvent } from '@testing-library/react-native'
import { renderWithProviders } from '../../test/test-utils'

// ── module mocks ──────────────────────────────────────────────────────────────

jest.mock('../../lib/queries', () => ({
  useProducts: jest.fn(),
  useCategories: jest.fn(),
  useCurrentUser: jest.fn(),
}))

jest.mock('../../lib/cart', () => ({
  useCart: jest.fn(() => ({ items: {} })),
  cart: { update: jest.fn(), clear: jest.fn() },
}))

jest.mock('expo-router', () => {
  const router = {
    push: jest.fn(),
    back: jest.fn(),
    replace: jest.fn(),
    navigate: jest.fn(),
    dismiss: jest.fn(),
  }
  return {
    router,
    useRouter: () => router,
    useLocalSearchParams: jest.fn(() => ({})),
    Link: 'Link',
    Stack: { Screen: 'Stack.Screen' },
  }
})

jest.mock('../../lib/api', () => ({
  API_URL: 'http://localhost:3000',
  productImageUrl: jest.fn(() => 'https://example.com/img.jpg'),
  api: {
    get: jest.fn(),
    post: jest.fn(),
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
  },
}))

jest.mock('../../lib/format', () => ({
  formatCents: (v: number) => `$${(v / 100).toFixed(0)}`,
}))

jest.mock('../../lib/category-selection', () => ({
  categorySelection: { consume: jest.fn(() => null) },
}))

jest.mock('expo-image', () => ({
  Image: 'Image',
}))

jest.mock('expo-symbols', () => ({
  SymbolView: 'SymbolView',
}))

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: jest.fn(() => ({ top: 0, bottom: 0, left: 0, right: 0 })),
}))

// ── imports after mocks ───────────────────────────────────────────────────────

import { useProducts, useCategories, useCurrentUser } from '../../lib/queries'
import type { Product } from '../../lib/types'
import CatalogTab from './catalog'

// ── typed mock helpers ────────────────────────────────────────────────────────

const mockUseProducts = useProducts as jest.MockedFunction<typeof useProducts>
const mockUseCategories = useCategories as jest.MockedFunction<typeof useCategories>
const mockUseCurrentUser = useCurrentUser as jest.MockedFunction<typeof useCurrentUser>

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'prod-1',
    name: 'Producto Test',
    description: null,
    priceToPublic: '10.00',
    isAvailable: true,
    stock: 10,
    imageContentType: null,
    imageUpdatedAt: null,
    createdAt: '2024-01-01T00:00:00Z',
    promoterCommissionPct: '0',
    pointsPct: '0',
    categoryId: 'cat-1',
    category: {
      id: 'cat-1',
      name: 'Bebederos',
      slug: 'bebederos',
      iconEmoji: null,
      displayOrder: 0,
    },
    displayOrder: 0,
    offerLabel: null,
    offerDiscountPct: null,
    offerStartsAt: null,
    offerEndsAt: null,
    effectivePriceCents: 1000,
    basePriceCents: 1000,
    offerActive: false,
    pricingMode: 'single_payment',
    ...overrides,
  }
}

function setupMocks(products: Product[]) {
  mockUseProducts.mockReturnValue({
    data: products,
    isPending: false,
    refetch: jest.fn(),
    isRefetching: false,
  } as unknown as ReturnType<typeof useProducts>)

  mockUseCategories.mockReturnValue({
    data: [
      {
        id: 'cat-1',
        name: 'Bebederos',
        slug: 'bebederos',
        iconEmoji: null,
        displayOrder: 0,
      },
    ],
    isPending: false,
  } as unknown as ReturnType<typeof useCategories>)

  mockUseCurrentUser.mockReturnValue({
    data: null,
    isPending: false,
  } as unknown as ReturnType<typeof useCurrentUser>)
}

afterEach(() => {
  jest.clearAllMocks()
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CatalogTab — rental badge', () => {
  // The catalog is category-first: products only render after a category is
  // picked. Each test enters the "Bebederos" category before asserting.
  it('shows "Alquiler" text for a rental product', () => {
    const rentalProduct = makeProduct({
      id: 'rental-1',
      name: 'Dispensador de Agua',
      pricingMode: 'rental',
      monthlyRentCents: 2000,
      effectivePriceCents: 2000,
    })
    setupMocks([rentalProduct])
    const { getByText } = renderWithProviders(<CatalogTab />)
    fireEvent.press(getByText('Bebederos'))
    expect(getByText(/Alquiler/)).toBeTruthy()
  })

  it('shows monthly price "$20" for a rental product with monthlyRentCents=2000', () => {
    const rentalProduct = makeProduct({
      id: 'rental-1',
      name: 'Dispensador de Agua',
      pricingMode: 'rental',
      monthlyRentCents: 2000,
      effectivePriceCents: 2000,
    })
    setupMocks([rentalProduct])
    const { getByText } = renderWithProviders(<CatalogTab />)
    fireEvent.press(getByText('Bebederos'))
    // Should show something like "Alquiler $20/mes"
    expect(getByText(/\$20/)).toBeTruthy()
  })

  it('does NOT show rental badge for a single_payment product', () => {
    const singleProduct = makeProduct({
      id: 'single-1',
      name: 'Agua Embotellada',
      pricingMode: 'single_payment',
    })
    setupMocks([singleProduct])
    const { getByText, queryByText } = renderWithProviders(<CatalogTab />)
    fireEvent.press(getByText('Bebederos'))
    expect(queryByText(/Alquiler/)).toBeNull()
  })

  it('does NOT show rental badge for a product without pricingMode', () => {
    const noModeProduct = makeProduct({
      id: 'notype-1',
      name: 'Agua',
    })
    // Remove pricingMode entirely
    delete (noModeProduct as Partial<Product>).pricingMode
    setupMocks([noModeProduct])
    const { getByText, queryByText } = renderWithProviders(<CatalogTab />)
    fireEvent.press(getByText('Bebederos'))
    expect(queryByText(/Alquiler/)).toBeNull()
  })
})
