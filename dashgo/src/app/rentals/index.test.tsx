/**
 * T92 — Rentals list screen tests (RED → GREEN with T93 impl)
 *
 * Scenarios:
 *   1. Renders list with mocked useMyRentals returning 2 rentals
 *   2. Each card shows product name
 *   3. Each card shows "$X/mes" monthly rate
 *   4. Active rental shows status badge
 *   5. Card shows "Próximo cargo:" with next charge date
 *   6. Empty state when array is empty: "No tienes alquileres"
 *   7. Read-only — no "Cancelar" action buttons
 *   8. Read-only — no "Cobrar" action buttons
 */
import React from 'react'
import { renderWithProviders } from '../../test/test-utils'

// ── module mocks ──────────────────────────────────────────────────────────────

jest.mock('../../lib/queries', () => ({
  useMyRentals: jest.fn(),
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
  formatDate: (d: string) => d,
}))

jest.mock('expo-image', () => ({
  Image: 'Image',
}))

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: jest.fn(() => ({ top: 0, bottom: 0, left: 0, right: 0 })),
}))

// ── imports after mocks ───────────────────────────────────────────────────────

import { useMyRentals } from '../../lib/queries'
import type { Rental } from '../../lib/types'
import RentalsIndex from './index'

// ── typed mock helpers ────────────────────────────────────────────────────────

const mockUseMyRentals = useMyRentals as jest.MockedFunction<typeof useMyRentals>

function makeRental(overrides: Partial<Rental> = {}): Rental {
  return {
    id: 'rental-1',
    productId: 'prod-1',
    productName: 'Dispensador de Agua',
    productImageUrl: null,
    monthlyRentCents: 2000,
    status: 'active',
    nextChargeAt: '2025-06-11T00:00:00Z',
    activatedAt: '2025-05-11T00:00:00Z',
    nextMaintenanceAt: null,
    lastMaintenanceAt: null,
    ...overrides,
  }
}

function setupMocks(rentals: Rental[], isPending = false) {
  mockUseMyRentals.mockReturnValue({
    data: rentals,
    isPending,
    isLoading: isPending,
  } as unknown as ReturnType<typeof useMyRentals>)
}

afterEach(() => {
  jest.clearAllMocks()
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('RentalsIndex — list with 2 rentals', () => {
  const rental1 = makeRental({ id: 'rental-1', productName: 'Dispensador de Agua', monthlyRentCents: 2000 })
  const rental2 = makeRental({ id: 'rental-2', productName: 'Botellón 20L', monthlyRentCents: 1500, status: 'active' })

  beforeEach(() => setupMocks([rental1, rental2]))

  it('renders both product names', () => {
    const { getByText } = renderWithProviders(<RentalsIndex />)
    expect(getByText('Dispensador de Agua')).toBeTruthy()
    expect(getByText('Botellón 20L')).toBeTruthy()
  })

  it('shows monthly rate for the first rental ($20/mes)', () => {
    const { getAllByText } = renderWithProviders(<RentalsIndex />)
    const matches = getAllByText(/\$20\/mes/)
    expect(matches.length).toBeGreaterThan(0)
  })

  it('shows monthly rate for the second rental ($15/mes)', () => {
    const { getAllByText } = renderWithProviders(<RentalsIndex />)
    const matches = getAllByText(/\$15\/mes/)
    expect(matches.length).toBeGreaterThan(0)
  })

  it('shows status badge for active rental', () => {
    const { getAllByText } = renderWithProviders(<RentalsIndex />)
    const badges = getAllByText(/activo/i)
    expect(badges.length).toBeGreaterThan(0)
  })

  it('shows "Próximo cargo" with next charge date', () => {
    const { getAllByText } = renderWithProviders(<RentalsIndex />)
    const matches = getAllByText(/Próximo cargo/i)
    expect(matches.length).toBeGreaterThan(0)
  })

  it('does NOT show any "Cancelar" action button (read-only)', () => {
    const { queryByText } = renderWithProviders(<RentalsIndex />)
    expect(queryByText(/Cancelar/i)).toBeNull()
  })

  it('does NOT show any "Cobrar" action button (read-only)', () => {
    const { queryByText } = renderWithProviders(<RentalsIndex />)
    expect(queryByText(/Cobrar/i)).toBeNull()
  })
})

describe('RentalsIndex — empty state', () => {
  beforeEach(() => setupMocks([]))

  it('shows empty state message "No tienes alquileres"', () => {
    const { getByText } = renderWithProviders(<RentalsIndex />)
    expect(getByText(/No tienes alquileres/)).toBeTruthy()
  })
})

describe('RentalsIndex — status badges', () => {
  it('shows past_due badge for a past_due rental', () => {
    const pastDue = makeRental({ id: 'r-pd', status: 'past_due' })
    setupMocks([pastDue])
    const { getByText } = renderWithProviders(<RentalsIndex />)
    expect(getByText(/atrasado/i)).toBeTruthy()
  })

  it('shows canceled badge for a canceled rental', () => {
    const canceled = makeRental({ id: 'r-c', status: 'canceled' })
    setupMocks([canceled])
    const { getByText } = renderWithProviders(<RentalsIndex />)
    expect(getByText(/cancelado/i)).toBeTruthy()
  })
})

// ── T8.1 / T8.2 — PENDING_SETUP badge ─────────────────────────────────────────

describe('T8.1 — PENDING_SETUP badge with exact Spanish copy', () => {
  it('T8.1a: shows the exact setup-in-progress copy when rental.status is pending_setup', () => {
    const pending = makeRental({ id: 'r-ps', status: 'pending_setup' })
    setupMocks([pending])
    const { getByText } = renderWithProviders(<RentalsIndex />)
    expect(
      getByText('Estamos terminando de configurar tu alquiler. Te avisamos cuando esté activo.'),
    ).toBeTruthy()
  })

  // T8.1 triangulate — pending_setup badge label is visible
  it('T8.1b: shows "Pendiente" badge label for pending_setup rental', () => {
    const pending = makeRental({ id: 'r-ps2', status: 'pending_setup' })
    setupMocks([pending])
    const { getByText } = renderWithProviders(<RentalsIndex />)
    expect(getByText(/pendiente/i)).toBeTruthy()
  })
})

describe('T8.2 — PENDING_SETUP badge NOT shown for other statuses', () => {
  it('T8.2a: active rental does NOT show the setup-in-progress copy', () => {
    const active = makeRental({ id: 'r-a', status: 'active' })
    setupMocks([active])
    const { queryByText } = renderWithProviders(<RentalsIndex />)
    expect(
      queryByText('Estamos terminando de configurar tu alquiler. Te avisamos cuando esté activo.'),
    ).toBeNull()
  })

  // T8.2 triangulate — past_due also doesn't show setup copy
  it('T8.2b: past_due rental does NOT show the setup-in-progress copy', () => {
    const pastDue = makeRental({ id: 'r-pd2', status: 'past_due' })
    setupMocks([pastDue])
    const { queryByText } = renderWithProviders(<RentalsIndex />)
    expect(
      queryByText('Estamos terminando de configurar tu alquiler. Te avisamos cuando esté activo.'),
    ).toBeNull()
  })
})
