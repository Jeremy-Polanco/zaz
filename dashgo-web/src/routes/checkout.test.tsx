/**
 * CheckoutPage — tasa de impuesto por dirección/zona.
 *
 * Heavy mocking of lib/queries (same tradeoff as orders.$orderId.index.test.tsx):
 * only the new per-address tax-rate preview and the postalCode passthrough
 * into the order-create payload are covered here, not the whole checkout flow.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithRouter } from '../test/test-utils'
import type { Product, UserAddress } from '../lib/types'

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const original = await importOriginal<typeof import('@tanstack/react-router')>()
  return {
    ...original,
    // The real navigation isn't under test here and the memory router used by
    // renderWithRouter only registers the root route — stub navigate so
    // goToOrder() after a successful submit doesn't throw "route not found".
    useRouter: () => ({ navigate: vi.fn() }),
  }
})

vi.mock('../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn() },
  TOKEN_KEY: 'dashgo.token',
}))

vi.mock('../lib/auth', () => ({
  useCurrentUser: vi.fn(() => ({
    data: { id: 'cust-1', role: 'client', fullName: 'Cliente', email: null, phone: null, addressDefault: null, activeLocationId: null, referralCode: null, creditLocked: false },
  })),
}))

vi.mock('../lib/queries', () => ({
  useAuthorizeOrder: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useConfirmNonStripeOrder: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useCreateOrder: vi.fn(),
  useMyAddresses: vi.fn(),
  useMyCredit: vi.fn(() => ({ data: undefined })),
  useMySubscription: vi.fn(() => ({ data: null })),
  useOrders: vi.fn(() => ({ data: [] })),
  usePointsBalance: vi.fn(() => ({
    data: { pendingCents: 0, claimableCents: 0, redeemedCents: 0, expiredCents: 0 },
  })),
  useProducts: vi.fn(),
  useShippingRate: vi.fn(() => ({ data: { shippingCents: 500 }, isError: false })),
}))

import {
  useCreateOrder,
  useMyAddresses,
  useProducts,
} from '../lib/queries'
import { CheckoutPage } from './checkout'

const mockUseCreateOrder = vi.mocked(useCreateOrder)
const mockUseMyAddresses = vi.mocked(useMyAddresses)
const mockUseProducts = vi.mocked(useProducts)

// requiresQuote: false -> the cart is "skip-cotización", which is the only
// path that shows a real (non "Al cotizar") tax preview.
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
    requiresQuote: false,
    offerLabel: null,
    offerDiscountPct: null,
    offerStartsAt: null,
    offerEndsAt: null,
    taxCategory: 'standard',
    effectivePriceCents: 500,
    basePriceCents: 500,
    offerActive: false,
    ...overrides,
  } as Product
}

function makeAddress(overrides: Partial<UserAddress> = {}): UserAddress {
  return {
    id: 'addr-1',
    userId: 'cust-1',
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
    postalCode: '07208',
    taxRate: 0.06625,
    ...overrides,
  }
}

function makeCreatedOrder() {
  return {
    id: 'order-1',
    status: 'pending_quote',
    totalAmount: '5.33',
    paymentMethod: 'cash',
    creditApplied: '0',
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.setItem(
    'dashgo.pendingCart',
    JSON.stringify({ items: [{ productId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479', quantity: 1 }] }),
  )
  mockUseProducts.mockReturnValue({
    data: [makeProduct({ id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479' })],
  } as unknown as ReturnType<typeof useProducts>)
  mockUseCreateOrder.mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue(makeCreatedOrder()),
    isPending: false,
    isError: false,
    error: null,
  } as unknown as ReturnType<typeof useCreateOrder>)
})

afterEach(() => {
  sessionStorage.clear()
})

describe('CheckoutPage — tasa de impuesto por dirección', () => {
  it('previews tax at the selected address taxRate (Elizabeth NJ 6.625%), not the 8.887% fallback', async () => {
    mockUseMyAddresses.mockReturnValue({
      data: [makeAddress({ taxRate: 0.06625 })],
    } as unknown as ReturnType<typeof useMyAddresses>)

    renderWithRouter(CheckoutPage)
    await screen.findByText('Resumen')

    expect(screen.getByText('Impuestos (6.625%)')).toBeInTheDocument()
  })

  it('falls back to TAX_RATE (8.887%) when the selected address has no taxRate', async () => {
    mockUseMyAddresses.mockReturnValue({
      data: [makeAddress({ taxRate: undefined })],
    } as unknown as ReturnType<typeof useMyAddresses>)

    renderWithRouter(CheckoutPage)
    await screen.findByText('Resumen')

    expect(screen.getByText('Impuestos (8.887%)')).toBeInTheDocument()
  })

  it('includes postalCode and houseNumber in the order-create payload when the selected address has them', async () => {
    // houseNumber viaja en el snapshot congelado de la orden (deliveryAddress)
    // desde antes del merge en el servidor — ver DeliveryAddressDto.houseNumber.
    const user = userEvent.setup()
    mockUseMyAddresses.mockReturnValue({
      data: [makeAddress({ postalCode: '07208', houseNumber: '1101' })],
    } as unknown as ReturnType<typeof useMyAddresses>)
    const mutateAsync = vi.fn().mockResolvedValue(makeCreatedOrder())
    mockUseCreateOrder.mockReturnValue({
      mutateAsync,
      isPending: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useCreateOrder>)

    renderWithRouter(CheckoutPage)
    await screen.findByText('Resumen')
    await user.click(screen.getByRole('button', { name: /confirmar pedido/i }))

    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryAddress: expect.objectContaining({
          text: 'Calle Duarte 45',
          lat: 18.47,
          lng: -69.9,
          postalCode: '07208',
          houseNumber: '1101',
        }),
      }),
    )
  })

  it('sends houseNumber as null (not omitted) when the selected address has none', async () => {
    const user = userEvent.setup()
    mockUseMyAddresses.mockReturnValue({
      data: [makeAddress({ houseNumber: undefined })],
    } as unknown as ReturnType<typeof useMyAddresses>)
    const mutateAsync = vi.fn().mockResolvedValue(makeCreatedOrder())
    mockUseCreateOrder.mockReturnValue({
      mutateAsync,
      isPending: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useCreateOrder>)

    renderWithRouter(CheckoutPage)
    await screen.findByText('Resumen')
    await user.click(screen.getByRole('button', { name: /confirmar pedido/i }))

    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryAddress: expect.objectContaining({ houseNumber: null }),
      }),
    )
  })

  it('includes deliveryAddressId (the saved address id) alongside the snapshot when ordering from a saved address', async () => {
    // El server ahora resuelve la tasa de impuesto desde la dirección guardada
    // (ownership-checked) por deliveryAddressId, ignorando el ZIP del
    // snapshot para ese cálculo — pero el snapshot (deliveryAddress con
    // postalCode) se sigue mandando igual que hoy, para el registro histórico
    // de la orden.
    const user = userEvent.setup()
    mockUseMyAddresses.mockReturnValue({
      data: [makeAddress({ id: 'addr-99', postalCode: '07208' })],
    } as unknown as ReturnType<typeof useMyAddresses>)
    const mutateAsync = vi.fn().mockResolvedValue(makeCreatedOrder())
    mockUseCreateOrder.mockReturnValue({
      mutateAsync,
      isPending: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useCreateOrder>)

    renderWithRouter(CheckoutPage)
    await screen.findByText('Resumen')
    await user.click(screen.getByRole('button', { name: /confirmar pedido/i }))

    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryAddressId: 'addr-99',
        deliveryAddress: expect.objectContaining({
          text: 'Calle Duarte 45',
          lat: 18.47,
          lng: -69.9,
          postalCode: '07208',
        }),
      }),
    )
  })

  it('labels the tax line with the NJ jurisdiction when the selected address resolved to one', async () => {
    mockUseMyAddresses.mockReturnValue({
      data: [makeAddress({ taxRate: 0.06625, taxJurisdiction: 'NJ' })],
    } as unknown as ReturnType<typeof useMyAddresses>)

    renderWithRouter(CheckoutPage)
    await screen.findByText('Resumen')

    expect(screen.getByText('Impuestos NJ (6.625%)')).toBeInTheDocument()
  })

  it('labels the tax line with the NYC jurisdiction when the selected address resolved to one', async () => {
    mockUseMyAddresses.mockReturnValue({
      data: [makeAddress({ taxRate: 0.08875, taxJurisdiction: 'NYC' })],
    } as unknown as ReturnType<typeof useMyAddresses>)

    renderWithRouter(CheckoutPage)
    await screen.findByText('Resumen')

    expect(screen.getByText('Impuestos NYC (8.875%)')).toBeInTheDocument()
  })

  it('keeps the plain tax label when the address has no resolved jurisdiction', async () => {
    mockUseMyAddresses.mockReturnValue({
      data: [makeAddress({ taxRate: 0.06625, taxJurisdiction: undefined })],
    } as unknown as ReturnType<typeof useMyAddresses>)

    renderWithRouter(CheckoutPage)
    await screen.findByText('Resumen')

    expect(screen.getByText('Impuestos (6.625%)')).toBeInTheDocument()
  })

  it('shows the resolved city/state/ZIP line next to the selected address when available', async () => {
    mockUseMyAddresses.mockReturnValue({
      data: [
        makeAddress({ city: 'Elizabeth', state: 'NJ', postalCode: '07201' }),
      ],
    } as unknown as ReturnType<typeof useMyAddresses>)

    renderWithRouter(CheckoutPage)
    await screen.findByText('Resumen')

    expect(screen.getByText('Elizabeth, NJ 07201')).toBeInTheDocument()
  })

  it('does not show a resolved place line when the address has not been geocoded', async () => {
    mockUseMyAddresses.mockReturnValue({
      data: [makeAddress({ city: undefined, state: undefined })],
    } as unknown as ReturnType<typeof useMyAddresses>)

    renderWithRouter(CheckoutPage)
    await screen.findByText('Resumen')

    expect(screen.queryByText(/, NJ|, NY/)).not.toBeInTheDocument()
  })
})
