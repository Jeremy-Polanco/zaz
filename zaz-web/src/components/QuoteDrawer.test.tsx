/**
 * QuoteDrawer — "Direcciones guardadas del cliente" section
 *
 * Tests that when the drawer is opened with an order, the SavedAddressesList
 * section is rendered with the order's customerId.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '../test/test-utils'
import type { Order } from '../lib/types'
import type { UserAddress } from '../lib/types'

// ── Module mocks ───────────────────────────────────────────────────────────────
vi.mock('../lib/queries', () => ({
  useSetOrderQuote: vi.fn(),
  useSuperUserAddresses: vi.fn(),
}))

vi.mock('../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
  TOKEN_KEY: 'zaz.token',
}))

import { useSetOrderQuote, useSuperUserAddresses } from '../lib/queries'
import { QuoteDrawer } from './QuoteDrawer'

const mockUseSetOrderQuote = vi.mocked(useSetOrderQuote)
const mockUseSuperUserAddresses = vi.mocked(useSuperUserAddresses)

// ── Fixtures ───────────────────────────────────────────────────────────────────

const baseOrder: Order = {
  id: 'order-001',
  customerId: 'customer-uuid-123',
  customer: { id: 'customer-uuid-123', fullName: 'María García', email: 'maria@example.com', phone: null, role: 'client', addressDefault: null, referralCode: null, creditLocked: false },
  status: 'pending_quote',
  deliveryAddress: { text: 'Calle Duarte 45', lat: 18.47, lng: -69.9 },
  subtotal: '50.00',
  pointsRedeemed: '0.00',
  shipping: '0.00',
  tax: '4.44',
  taxRate: '0.08887',
  totalAmount: '54.44',
  paymentMethod: 'cash',
  items: [],
  createdAt: '2026-05-01T10:00:00.000Z',
}

const savedAddresses: UserAddress[] = [
  {
    id: 'addr-1',
    userId: 'customer-uuid-123',
    label: 'Casa',
    line1: 'Calle Duarte 45',
    line2: null,
    lat: 18.47,
    lng: -69.9,
    instructions: null,
    isDefault: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
]

function makeMutationMock() {
  return {
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    isSuccess: false,
    isError: false,
    isPaused: false,
    isIdle: true,
    error: null,
    data: undefined,
    reset: vi.fn(),
    variables: undefined,
    context: undefined,
    failureCount: 0,
    failureReason: null,
    status: 'idle' as const,
    submittedAt: 0,
  }
}

function makeQueryResult(data: UserAddress[] | undefined, pending = false) {
  return {
    data: pending ? undefined : data,
    isLoading: pending,
    isPending: pending,
    isError: false,
    error: null,
    isSuccess: !pending,
    isFetching: false,
    status: (pending ? 'pending' : 'success') as 'pending' | 'success',
    fetchStatus: 'idle' as const,
    refetch: vi.fn(),
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('QuoteDrawer — Direcciones guardadas del cliente section', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseSetOrderQuote.mockReturnValue(
      makeMutationMock() as unknown as ReturnType<typeof useSetOrderQuote>,
    )
  })

  it('renders the "Direcciones guardadas del cliente" section heading', () => {
    mockUseSuperUserAddresses.mockReturnValue(
      makeQueryResult(savedAddresses) as unknown as ReturnType<typeof useSuperUserAddresses>,
    )
    renderWithProviders(
      <QuoteDrawer order={baseOrder} onClose={vi.fn()} />,
    )
    expect(
      screen.getByText(/direcciones guardadas del cliente/i),
    ).toBeInTheDocument()
  })

  it('calls useSuperUserAddresses with the order customerId', () => {
    mockUseSuperUserAddresses.mockReturnValue(
      makeQueryResult(savedAddresses) as unknown as ReturnType<typeof useSuperUserAddresses>,
    )
    renderWithProviders(
      <QuoteDrawer order={baseOrder} onClose={vi.fn()} />,
    )
    expect(mockUseSuperUserAddresses).toHaveBeenCalledWith(baseOrder.customerId)
  })

  it('renders address label and line1 in the saved addresses section', () => {
    mockUseSuperUserAddresses.mockReturnValue(
      makeQueryResult(savedAddresses) as unknown as ReturnType<typeof useSuperUserAddresses>,
    )
    renderWithProviders(
      <QuoteDrawer order={baseOrder} onClose={vi.fn()} />,
    )
    // "Casa" is the address label — only appears in the saved-addresses list
    expect(screen.getByText('Casa')).toBeInTheDocument()
    // line1 may also appear in the delivery address header — use getAllByText
    expect(screen.getAllByText('Calle Duarte 45').length).toBeGreaterThanOrEqual(1)
  })

  it('shows "Sin direcciones guardadas" when customer has no addresses', () => {
    mockUseSuperUserAddresses.mockReturnValue(
      makeQueryResult([]) as unknown as ReturnType<typeof useSuperUserAddresses>,
    )
    renderWithProviders(
      <QuoteDrawer order={baseOrder} onClose={vi.fn()} />,
    )
    expect(screen.getByText(/sin direcciones guardadas/i)).toBeInTheDocument()
  })

  it('shows loading state while addresses are pending', () => {
    mockUseSuperUserAddresses.mockReturnValue(
      makeQueryResult(undefined, true) as unknown as ReturnType<typeof useSuperUserAddresses>,
    )
    renderWithProviders(
      <QuoteDrawer order={baseOrder} onClose={vi.fn()} />,
    )
    expect(screen.getByText(/cargando/i)).toBeInTheDocument()
  })
})
