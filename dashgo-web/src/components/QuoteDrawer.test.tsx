/**
 * QuoteDrawer — "Direcciones guardadas del cliente" section
 *
 * Tests that when the drawer is opened with an order, the SavedAddressesList
 * section is rendered with the order's customerId.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../test/test-utils'
import type { Order, Product, OrderItem } from '../lib/types'
import type { UserAddress } from '../lib/types'

// ── Module mocks ───────────────────────────────────────────────────────────────
vi.mock('../lib/queries', () => ({
  useSetOrderQuote: vi.fn(),
  useSuperUserAddresses: vi.fn(),
}))

vi.mock('../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
  TOKEN_KEY: 'dashgo.token',
}))

import { useSetOrderQuote, useSuperUserAddresses } from '../lib/queries'
import { QuoteDrawer } from './QuoteDrawer'

const mockUseSetOrderQuote = vi.mocked(useSetOrderQuote)
const mockUseSuperUserAddresses = vi.mocked(useSuperUserAddresses)

// ── Fixtures ───────────────────────────────────────────────────────────────────

const baseOrder: Order = {
  id: 'order-001',
  customerId: 'customer-uuid-123',
  customer: { id: 'customer-uuid-123', fullName: 'María García', email: 'maria@example.com', phone: null, role: 'client', addressDefault: null, referralCode: null, creditLocked: false, activeLocationId: null },
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
    building: null,
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

// ── Recargo por distancia + Día de entrega ──────────────────────────────────
//
// deliverySurcharge ("delivery aparte del envío" para clientes lejanos) and
// scheduledDeliveryDate are new on Order — the admin sets both from this same
// drawer alongside shipping.

describe('QuoteDrawer — recargo por distancia y día de entrega', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseSetOrderQuote.mockReturnValue(
      makeMutationMock() as unknown as ReturnType<typeof useSetOrderQuote>,
    )
    mockUseSuperUserAddresses.mockReturnValue(
      makeQueryResult(savedAddresses) as unknown as ReturnType<typeof useSuperUserAddresses>,
    )
  })

  it('shows the helper text explaining the surcharge applies to subscribers too', () => {
    renderWithProviders(<QuoteDrawer order={baseOrder} onClose={vi.fn()} />)
    expect(
      screen.getByText(
        /se cobra también a suscriptores.*la suscripción cubre el envío, no la distancia/i,
      ),
    ).toBeInTheDocument()
  })

  it('defaults the surcharge field empty and the date field empty when the order has none', () => {
    renderWithProviders(<QuoteDrawer order={baseOrder} onClose={vi.fn()} />)
    expect(
      screen.getByLabelText(/recargo por distancia/i),
    ).toHaveValue(null)
    expect(screen.getByLabelText(/día de entrega/i)).toHaveValue('')
  })

  it('defaults the surcharge field from order.deliverySurcharge when it is > 0', () => {
    renderWithProviders(
      <QuoteDrawer
        order={{ ...baseOrder, deliverySurcharge: '3.00' }}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByLabelText(/recargo por distancia/i)).toHaveValue(3)
  })

  it('leaves the surcharge field empty when order.deliverySurcharge is "0.00"', () => {
    renderWithProviders(
      <QuoteDrawer
        order={{ ...baseOrder, deliverySurcharge: '0.00' }}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByLabelText(/recargo por distancia/i)).toHaveValue(null)
  })

  it('defaults the date field from order.scheduledDeliveryDate', () => {
    renderWithProviders(
      <QuoteDrawer
        order={{ ...baseOrder, scheduledDeliveryDate: '2026-09-20' }}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByLabelText(/día de entrega/i)).toHaveValue('2026-09-20')
  })

  it('sets min=today on the date field so staff cannot schedule in the past', () => {
    renderWithProviders(<QuoteDrawer order={baseOrder} onClose={vi.fn()} />)
    const input = screen.getByLabelText(/día de entrega/i)
    // Just assert a min is present and well-formed — asserting the exact date
    // would make the test flaky at midnight.
    expect(input.getAttribute('min')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('includes the surcharge in the tax preview (shipping + surcharge, both taxed)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<QuoteDrawer order={baseOrder} onClose={vi.fn()} />)

    await user.type(screen.getByLabelText(/envío \(usd\)/i), '5.00')
    await user.type(screen.getByLabelText(/recargo por distancia/i), '3.00')

    // subtotal 50.00 + shipping 5.00 + surcharge 3.00 = 58.00 taxable base
    // taxCents = round(5800 * 0.08887) = 515 → $5.15; total = $63.15
    expect(screen.getByText('$5.15')).toBeInTheDocument()
    expect(screen.getByText('$63.15')).toBeInTheDocument()
  })

  it('shows a "Recargo por distancia" preview line only when the surcharge is > 0', async () => {
    const user = userEvent.setup()
    renderWithProviders(<QuoteDrawer order={baseOrder} onClose={vi.fn()} />)

    expect(screen.queryByText('Recargo por distancia')).not.toBeInTheDocument()

    await user.type(screen.getByLabelText(/recargo por distancia/i), '3.00')

    expect(screen.getByText('Recargo por distancia')).toBeInTheDocument()
    expect(screen.getByText('$3.00')).toBeInTheDocument()
  })

  it('submits shippingCents, surchargeCents and scheduledDeliveryDate together', async () => {
    const user = userEvent.setup()
    const mutateAsync = vi.fn().mockResolvedValue({})
    mockUseSetOrderQuote.mockReturnValue({
      ...makeMutationMock(),
      mutateAsync,
    } as unknown as ReturnType<typeof useSetOrderQuote>)
    const onClose = vi.fn()

    renderWithProviders(<QuoteDrawer order={baseOrder} onClose={onClose} />)

    await user.type(screen.getByLabelText(/envío \(usd\)/i), '5.00')
    await user.type(screen.getByLabelText(/recargo por distancia/i), '3.00')
    fireEvent.change(screen.getByLabelText(/día de entrega/i), {
      target: { value: '2026-09-20' },
    })
    await user.click(screen.getByRole('button', { name: /enviar cotización/i }))

    expect(mutateAsync).toHaveBeenCalledWith({
      id: baseOrder.id,
      shippingCents: 500,
      surchargeCents: 300,
      scheduledDeliveryDate: '2026-09-20',
    })
    expect(onClose).toHaveBeenCalled()
  })

  it('sends surchargeCents: 0 when the surcharge field is cleared', async () => {
    const user = userEvent.setup()
    const mutateAsync = vi.fn().mockResolvedValue({})
    mockUseSetOrderQuote.mockReturnValue({
      ...makeMutationMock(),
      mutateAsync,
    } as unknown as ReturnType<typeof useSetOrderQuote>)

    renderWithProviders(
      <QuoteDrawer
        order={{ ...baseOrder, deliverySurcharge: '3.00' }}
        onClose={vi.fn()}
      />,
    )

    await user.clear(screen.getByLabelText(/recargo por distancia/i))
    await user.type(screen.getByLabelText(/envío \(usd\)/i), '5.00')
    await user.click(screen.getByRole('button', { name: /enviar cotización/i }))

    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ surchargeCents: 0 }),
    )
  })

  it('sends scheduledDeliveryDate: null when the date field is cleared', async () => {
    const user = userEvent.setup()
    const mutateAsync = vi.fn().mockResolvedValue({})
    mockUseSetOrderQuote.mockReturnValue({
      ...makeMutationMock(),
      mutateAsync,
    } as unknown as ReturnType<typeof useSetOrderQuote>)

    renderWithProviders(
      <QuoteDrawer
        order={{ ...baseOrder, scheduledDeliveryDate: '2026-09-20' }}
        onClose={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByLabelText(/día de entrega/i), {
      target: { value: '' },
    })
    await user.type(screen.getByLabelText(/envío \(usd\)/i), '5.00')
    await user.click(screen.getByRole('button', { name: /enviar cotización/i }))

    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ scheduledDeliveryDate: null }),
    )
  })
})

// ── Tasa de impuesto por dirección/zona ─────────────────────────────────────
//
// order.taxRate is frozen by the server at order creation (per-zone, e.g.
// 0.06625 in Elizabeth NJ) — the drawer must preview tax at THAT rate, not
// the hardcoded 8.887% it used to show for every order regardless of zone.

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'prod-1',
    name: 'Botellón 5gal',
    description: null,
    priceToPublic: '5.00',
    isAvailable: true,
    stock: 10,
    imageContentType: null,
    imageUpdatedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    promoterCommissionPct: '0',
    pointsPct: '0',
    categoryId: null,
    offerLabel: null,
    offerDiscountPct: null,
    offerStartsAt: null,
    offerEndsAt: null,
    effectivePriceCents: 500,
    basePriceCents: 500,
    offerActive: false,
    ...overrides,
  } as Product
}

function makeOrderItem(overrides: Partial<OrderItem> = {}): OrderItem {
  return {
    id: 'item-1',
    orderId: 'order-001',
    productId: 'prod-1',
    quantity: 1,
    priceAtOrder: '30.00',
    createdAt: '2026-05-01T10:00:00.000Z',
    ...overrides,
  }
}

describe('QuoteDrawer — tasa de impuesto por dirección/zona', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseSetOrderQuote.mockReturnValue(
      makeMutationMock() as unknown as ReturnType<typeof useSetOrderQuote>,
    )
    mockUseSuperUserAddresses.mockReturnValue(
      makeQueryResult(savedAddresses) as unknown as ReturnType<typeof useSuperUserAddresses>,
    )
  })

  it('previews tax at the order taxRate (Elizabeth NJ 6.625%), not the 8.887% fallback', () => {
    renderWithProviders(
      <QuoteDrawer
        order={{ ...baseOrder, taxRate: '0.06625' }}
        onClose={vi.fn()}
      />,
    )
    // subtotal 50.00, no shipping/surcharge -> taxable 5000c @ 6.625% = 331.25 -> 331
    expect(screen.getByText('Impuestos (6.625%)')).toBeInTheDocument()
    expect(screen.getByText('$3.31')).toBeInTheDocument()
  })

  it('falls back to TAX_RATE (8.887%) when order.taxRate is not a valid number', () => {
    renderWithProviders(
      <QuoteDrawer
        order={{ ...baseOrder, taxRate: 'not-a-number' }}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByText('Impuestos (8.887%)')).toBeInTheDocument()
  })

  it('taxes only the standard-category items when order.items expose product.taxCategory', () => {
    renderWithProviders(
      <QuoteDrawer
        order={{
          ...baseOrder,
          taxRate: '0.08887',
          items: [
            makeOrderItem({
              id: 'item-standard',
              priceAtOrder: '30.00',
              quantity: 1,
              product: makeProduct({ taxCategory: 'standard' }),
            }),
            makeOrderItem({
              id: 'item-exempt',
              priceAtOrder: '20.00',
              quantity: 1,
              product: makeProduct({ taxCategory: 'exempt' }),
            }),
          ],
        }}
        onClose={vi.fn()}
      />,
    )
    // Only the $30.00 standard line is taxable: round(3000 * 0.08887) = 267 -> $2.67
    expect(screen.getByText('$2.67')).toBeInTheDocument()
  })

  it('taxes the full subtotal when items have no populated product (historical behaviour)', () => {
    renderWithProviders(
      <QuoteDrawer
        order={{ ...baseOrder, taxRate: '0.08887', items: [] }}
        onClose={vi.fn()}
      />,
    )
    // subtotal 5000c @ 8.887% = 444.35 -> 444
    expect(screen.getByText('$4.44')).toBeInTheDocument()
  })
})
