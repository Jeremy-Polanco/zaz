/**
 * Checkout tests — address-free flow.
 *
 * The customer-facing checkout no longer collects or sends any delivery
 * address; the colmado pins the location at delivery time. These tests cover
 * what remains: the create-order payload, the mixed-cart guard, the monthly
 * recurring disclosure, and rental line-item copy.
 */
import React from 'react'
import { fireEvent, act, waitFor } from '@testing-library/react-native'
import { Alert } from 'react-native'
import { renderWithProviders } from '../test/test-utils'

// ── module mocks ──────────────────────────────────────────────────────────────

jest.mock('../lib/queries', () => ({
  useCreateOrder: jest.fn(),
  useConfirmNonStripeOrder: jest.fn(),
  useAuthorizeOrder: jest.fn(),
  useUpdateOrderStatus: jest.fn(),
  useOrders: jest.fn(),
  useCurrentUser: jest.fn(),
  useMyCredit: jest.fn(),
  useMySubscription: jest.fn(),
  usePointsBalance: jest.fn(),
  useProducts: jest.fn(),
  useMyAddresses: jest.fn(),
  useShippingRate: jest.fn(),
}))

jest.mock('@stripe/stripe-react-native', () => ({
  useStripe: () => ({
    initPaymentSheet: jest.fn(),
    presentPaymentSheet: jest.fn(),
  }),
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

jest.mock('../lib/api', () => ({
  API_URL: 'http://localhost:3000',
  api: {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
  },
}))

// Cart
jest.mock('../lib/cart', () => ({
  useCart: jest.fn(() => ({ items: { 'product-1': 2 } })),
  cart: { clear: jest.fn() },
}))

// ── imports after mocks ───────────────────────────────────────────────────────

import {
  useCreateOrder,
  useConfirmNonStripeOrder,
  useOrders,
  useCurrentUser,
  useMyCredit,
  useMySubscription,
  usePointsBalance,
  useProducts,
  useMyAddresses,
  useShippingRate,
} from '../lib/queries'
import { router } from 'expo-router'
import CheckoutScreen from './checkout'

// ── typed mock helpers ────────────────────────────────────────────────────────

const mockUseCreateOrder = useCreateOrder as jest.MockedFunction<typeof useCreateOrder>
const mockUseConfirmNonStripeOrder =
  useConfirmNonStripeOrder as jest.MockedFunction<typeof useConfirmNonStripeOrder>
const mockUseOrders = useOrders as jest.MockedFunction<typeof useOrders>
const mockUseCurrentUser = useCurrentUser as jest.MockedFunction<typeof useCurrentUser>
const mockUseMyCredit = useMyCredit as jest.MockedFunction<typeof useMyCredit>
const mockUseMySubscription = useMySubscription as jest.MockedFunction<typeof useMySubscription>
const mockUsePointsBalance = usePointsBalance as jest.MockedFunction<typeof usePointsBalance>
const mockUseProducts = useProducts as jest.MockedFunction<typeof useProducts>
const mockUseMyAddresses = useMyAddresses as jest.MockedFunction<typeof useMyAddresses>
const mockUseShippingRate = useShippingRate as jest.MockedFunction<typeof useShippingRate>

const mockRouter = router as jest.Mocked<typeof router>

// ── fixtures ──────────────────────────────────────────────────────────────────

// A product so the checkout screen doesn't render the empty-cart state
const MOCK_PRODUCT = {
  id: 'product-1',
  name: 'Producto Test',
  effectivePriceCents: 1000,
  basePriceCents: 1000,
  offerActive: false,
  offerLabel: null,
  stock: 10,
  categoryId: 'cat-1',
  description: null,
  imageUrl: null,
  active: true,
}

const RENTAL_PRODUCT = {
  id: 'product-rental',
  name: 'Dispensador de Agua',
  effectivePriceCents: 2000,
  basePriceCents: 2000,
  offerActive: false,
  offerLabel: null,
  stock: 10,
  categoryId: null,
  description: null,
  imageUrl: null,
  active: true,
  pricingMode: 'rental' as const,
  monthlyRentCents: 2000,
}

const SINGLE_PRODUCT = {
  id: 'product-single',
  name: 'Agua Embotellada',
  effectivePriceCents: 500,
  basePriceCents: 500,
  offerActive: false,
  offerLabel: null,
  stock: 10,
  categoryId: null,
  description: null,
  imageUrl: null,
  active: true,
  pricingMode: 'single_payment' as const,
}

// requiresQuote=false → the order is auto-quoted at creation (skip-cotización)
const WATER_PRODUCT = {
  id: 'product-water',
  name: 'Botellón de Agua',
  effectivePriceCents: 4500,
  basePriceCents: 4500,
  offerActive: false,
  offerLabel: null,
  stock: 10,
  categoryId: null,
  description: null,
  imageUrl: null,
  active: true,
  pricingMode: 'single_payment' as const,
  requiresQuote: false,
}

const mockCreateOrderMutateAsync = jest.fn()

function setupCheckoutMocks(
  products: typeof MOCK_PRODUCT[],
  cartItems: Record<string, number>,
) {
  const { useCart } = require('../lib/cart')
  const mockUseCartFn = useCart as jest.MockedFunction<typeof useCart>
  mockUseCartFn.mockReturnValue({ items: cartItems })

  mockUseProducts.mockReturnValue({
    data: products,
  } as unknown as ReturnType<typeof useProducts>)

  mockUseCreateOrder.mockReturnValue({
    mutateAsync: mockCreateOrderMutateAsync,
    isPending: false,
  } as unknown as ReturnType<typeof useCreateOrder>)

  mockUseConfirmNonStripeOrder.mockReturnValue({
    mutateAsync: jest.fn().mockResolvedValue({}),
    isPending: false,
  } as unknown as ReturnType<typeof useConfirmNonStripeOrder>)

  // No prior orders → no active-order block in tests.
  mockUseOrders.mockReturnValue({ data: [] } as unknown as ReturnType<typeof useOrders>)

  mockUseCurrentUser.mockReturnValue({
    data: { id: 'user-1', role: 'client', addressDefault: null },
  } as unknown as ReturnType<typeof useCurrentUser>)

  mockUseMyCredit.mockReturnValue({ data: null } as unknown as ReturnType<typeof useMyCredit>)
  mockUseMySubscription.mockReturnValue({ data: null } as unknown as ReturnType<typeof useMySubscription>)
  mockUsePointsBalance.mockReturnValue({ data: null } as unknown as ReturnType<typeof usePointsBalance>)
  mockUseMyAddresses.mockReturnValue({ data: [] } as unknown as ReturnType<typeof useMyAddresses>)

  // Default: rate resolved at the $5 default — most tests don't care about
  // the shipping-rate loading/error states, covered separately below.
  mockUseShippingRate.mockReturnValue({
    data: { shippingCents: 500 },
    isError: false,
  } as unknown as ReturnType<typeof useShippingRate>)
}

let alertSpy: jest.SpyInstance

beforeEach(() => {
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined)
  mockCreateOrderMutateAsync.mockResolvedValue({ id: 'order-1' })
})

afterEach(() => {
  jest.clearAllMocks()
})

// ── Create-order payload — no deliveryAddress ─────────────────────────────────

// ── Selected address summary — ZIP display ────────────────────────────────────

const ADDRESS_WITH_ZIP = {
  id: 'addr-1',
  userId: 'user-1',
  label: 'Casa',
  line1: 'Calle Duarte 100',
  line2: null,
  building: null,
  lat: 18.47,
  lng: -69.9,
  instructions: null,
  isDefault: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  postalCode: '10451',
}

describe('Checkout — selected address summary', () => {
  it('shows the ZIP next to the address line when the saved address has one', () => {
    setupCheckoutMocks([MOCK_PRODUCT], { 'product-1': 2 })
    mockUseMyAddresses.mockReturnValue({
      data: [ADDRESS_WITH_ZIP],
    } as unknown as ReturnType<typeof useMyAddresses>)

    const { getByText } = renderWithProviders(<CheckoutScreen />)

    expect(getByText('Calle Duarte 100 · ZIP 10451')).toBeTruthy()
  })

  it('does not show a ZIP suffix when the saved address has none', () => {
    setupCheckoutMocks([MOCK_PRODUCT], { 'product-1': 2 })
    mockUseMyAddresses.mockReturnValue({
      data: [{ ...ADDRESS_WITH_ZIP, postalCode: null }],
    } as unknown as ReturnType<typeof useMyAddresses>)

    const { getByText } = renderWithProviders(<CheckoutScreen />)

    expect(getByText('Calle Duarte 100')).toBeTruthy()
  })

  it('shows the resolved city/state/ZIP line under the address list when present', () => {
    setupCheckoutMocks([MOCK_PRODUCT], { 'product-1': 2 })
    mockUseMyAddresses.mockReturnValue({
      data: [{ ...ADDRESS_WITH_ZIP, city: 'Elizabeth', state: 'NJ' }],
    } as unknown as ReturnType<typeof useMyAddresses>)

    const { getByText } = renderWithProviders(<CheckoutScreen />)

    expect(getByText('Elizabeth, NJ 10451')).toBeTruthy()
  })

  it('does not show a resolved place line when the address has no city/state', () => {
    setupCheckoutMocks([MOCK_PRODUCT], { 'product-1': 2 })
    mockUseMyAddresses.mockReturnValue({
      data: [ADDRESS_WITH_ZIP],
    } as unknown as ReturnType<typeof useMyAddresses>)

    const { queryByText } = renderWithProviders(<CheckoutScreen />)

    expect(queryByText('Elizabeth, NJ 10451')).toBeNull()
  })
})

// ── Jurisdiction-specific tax label ────────────────────────────────────────────

describe('Checkout — jurisdiction-specific tax label', () => {
  it('shows "Impuestos NJ (6.625%)" when the selected address has taxJurisdiction NJ', () => {
    setupCheckoutMocks([WATER_PRODUCT as unknown as typeof MOCK_PRODUCT], { 'product-water': 1 })
    mockUseMyAddresses.mockReturnValue({
      data: [{ ...ADDRESS_WITH_ZIP, taxRate: 0.06625, taxJurisdiction: 'NJ' }],
    } as unknown as ReturnType<typeof useMyAddresses>)

    const { getByText } = renderWithProviders(<CheckoutScreen />)

    expect(getByText('Impuestos NJ (6.625%)')).toBeTruthy()
  })

  it('shows "Impuestos NYC (8.875%)" when the selected address has taxJurisdiction NYC', () => {
    setupCheckoutMocks([WATER_PRODUCT as unknown as typeof MOCK_PRODUCT], { 'product-water': 1 })
    mockUseMyAddresses.mockReturnValue({
      data: [{ ...ADDRESS_WITH_ZIP, taxRate: 0.08875, taxJurisdiction: 'NYC' }],
    } as unknown as ReturnType<typeof useMyAddresses>)

    const { getByText } = renderWithProviders(<CheckoutScreen />)

    expect(getByText('Impuestos NYC (8.875%)')).toBeTruthy()
  })

  it('falls back to the plain rate label when the address has no taxJurisdiction', () => {
    setupCheckoutMocks([WATER_PRODUCT as unknown as typeof MOCK_PRODUCT], { 'product-water': 1 })
    mockUseMyAddresses.mockReturnValue({
      data: [{ ...ADDRESS_WITH_ZIP, taxRate: 0.08887, taxJurisdiction: null }],
    } as unknown as ReturnType<typeof useMyAddresses>)

    const { getByText } = renderWithProviders(<CheckoutScreen />)

    expect(getByText('Impuestos (8.887%)')).toBeTruthy()
  })

  it('falls back to the plain rate label when there are no saved addresses at all', () => {
    setupCheckoutMocks([WATER_PRODUCT as unknown as typeof MOCK_PRODUCT], { 'product-water': 1 })
    mockUseMyAddresses.mockReturnValue({
      data: [],
    } as unknown as ReturnType<typeof useMyAddresses>)

    const { getByText } = renderWithProviders(<CheckoutScreen />)

    expect(getByText('Impuestos (8.887%)')).toBeTruthy()
  })
})

describe('Checkout — create-order payload', () => {
  it('submits an order with no deliveryAddress field', async () => {
    setupCheckoutMocks([SINGLE_PRODUCT as unknown as typeof MOCK_PRODUCT], { 'product-single': 1 })

    alertSpy.mockImplementation(
      (_title, _msg, buttons: Array<{ text: string; onPress?: () => void }>) => {
        const confirmBtn = buttons?.find((b) => b.text === 'Sí, confirmar')
        confirmBtn?.onPress?.()
      },
    )

    const { getByText } = renderWithProviders(<CheckoutScreen />)

    await act(async () => {
      fireEvent.press(getByText(/Confirmar pedido/i))
    })

    await waitFor(() => {
      expect(mockCreateOrderMutateAsync).toHaveBeenCalled()
    })

    const payload = mockCreateOrderMutateAsync.mock.calls[0][0]
    expect(payload).toEqual({
      items: [{ productId: 'product-single', quantity: 1 }],
      paymentMethod: 'cash',
      usePoints: false,
      useCredit: false,
    })
    expect(payload).not.toHaveProperty('deliveryAddress')
  })

  it('navigates to the order screen after a successful order', async () => {
    setupCheckoutMocks([SINGLE_PRODUCT as unknown as typeof MOCK_PRODUCT], { 'product-single': 1 })
    mockCreateOrderMutateAsync.mockResolvedValue({ id: 'order-7' })

    alertSpy.mockImplementation(
      (_title, _msg, buttons: Array<{ text: string; onPress?: () => void }>) => {
        const confirmBtn = buttons?.find((b) => b.text === 'Sí, confirmar')
        confirmBtn?.onPress?.()
      },
    )

    const { getByText } = renderWithProviders(<CheckoutScreen />)

    await act(async () => {
      fireEvent.press(getByText(/Confirmar pedido/i))
    })

    await waitFor(() => {
      expect(mockRouter.replace).toHaveBeenCalledWith(
        expect.objectContaining({
          pathname: '/orders/[orderId]',
          params: { orderId: 'order-7' },
        }),
      )
    })
  })
})

// ── T9.1 — Mixed-cart guard blocks submission ─────────────────────────────────

describe('T9.1 — Mixed-cart guard: blocks submit when cart has rental + non-rental items', () => {
  it('T9.1a: shows mixed-cart error copy when cart has both rental and single_payment products', async () => {
    setupCheckoutMocks(
      [SINGLE_PRODUCT as unknown as typeof MOCK_PRODUCT, RENTAL_PRODUCT as unknown as typeof MOCK_PRODUCT],
      { 'product-single': 1, 'product-rental': 1 },
    )

    const { getByText } = renderWithProviders(<CheckoutScreen />)

    await waitFor(() => {
      expect(getByText(/Confirmar pedido/i)).toBeTruthy()
    })

    await waitFor(() => {
      expect(
        getByText(/No podés combinar productos de alquiler con productos de compra única/i),
      ).toBeTruthy()
    })
  })

  // T9.1 triangulate — mixed cart button is disabled
  it('T9.1b: submit button is disabled for a mixed rental + non-rental cart', async () => {
    setupCheckoutMocks(
      [SINGLE_PRODUCT as unknown as typeof MOCK_PRODUCT, RENTAL_PRODUCT as unknown as typeof MOCK_PRODUCT],
      { 'product-single': 1, 'product-rental': 1 },
    )

    const { getByText } = renderWithProviders(<CheckoutScreen />)

    await waitFor(() => {
      expect(getByText(/Confirmar pedido/i)).toBeTruthy()
    })

    // Press the button — should NOT trigger createOrder (blocked by mixed-cart guard)
    fireEvent.press(getByText(/Confirmar pedido/i))

    expect(mockCreateOrderMutateAsync).not.toHaveBeenCalled()
    expect(
      getByText(/No podés combinar productos de alquiler con productos de compra única/i),
    ).toBeTruthy()
  })
})

// ── T9.2 — Monthly disclosure for all-rental cart ────────────────────────────

describe('T9.2 — Monthly disclosure block shows for all-rental cart', () => {
  it('T9.2a: shows "Cargo recurrente mensual" copy with amount when all items are rental', async () => {
    setupCheckoutMocks([RENTAL_PRODUCT as unknown as typeof MOCK_PRODUCT], { 'product-rental': 1 })

    const { getByText } = renderWithProviders(<CheckoutScreen />)

    await waitFor(() => {
      expect(getByText(/Cargo recurrente mensual/i)).toBeTruthy()
    })
  })

  // T9.2 triangulate — monthly amount shows in disclosure
  it('T9.2b: monthly disclosure shows correct total cents formatted as dollars', async () => {
    setupCheckoutMocks([RENTAL_PRODUCT as unknown as typeof MOCK_PRODUCT], { 'product-rental': 1 })

    const { getAllByText } = renderWithProviders(<CheckoutScreen />)

    // RENTAL_PRODUCT has monthlyRentCents=2000 → $20/mes (appears in line item AND disclosure)
    await waitFor(() => {
      const matches = getAllByText(/\$20\/mes/i)
      expect(matches.length).toBeGreaterThan(0)
    })
  })
})

// ── T9.3 — No monthly disclosure for all-single_payment cart ─────────────────

describe('T9.3 — No monthly disclosure for single-payment-only cart (regression guard)', () => {
  it('T9.3a: does NOT show "Cargo recurrente mensual" for all single-payment cart', async () => {
    setupCheckoutMocks([SINGLE_PRODUCT as unknown as typeof MOCK_PRODUCT], { 'product-single': 1 })

    const { queryByText } = renderWithProviders(<CheckoutScreen />)

    await waitFor(() => {
      expect(queryByText(/Cargo recurrente mensual/i)).toBeNull()
    })
  })

  // T9.3 triangulate — no mixed-cart error shown for pure single-payment cart
  it('T9.3b: does NOT show mixed-cart error for single-payment-only cart', async () => {
    setupCheckoutMocks([SINGLE_PRODUCT as unknown as typeof MOCK_PRODUCT], { 'product-single': 1 })

    const { queryByText } = renderWithProviders(<CheckoutScreen />)

    await waitFor(() => {
      expect(
        queryByText(/No podés combinar productos de alquiler con productos de compra única/i),
      ).toBeNull()
    })
  })
})

// ── T87 — Rental line item copy + breakdown ────────────────────────────────────

describe('T87 — Rental: mixed cart shows "(primer mes)" copy under rental item', () => {
  it('shows "(primer mes)" text under the rental line item', async () => {
    setupCheckoutMocks(
      [SINGLE_PRODUCT as unknown as typeof MOCK_PRODUCT, RENTAL_PRODUCT as unknown as typeof MOCK_PRODUCT],
      { 'product-single': 1, 'product-rental': 1 },
    )

    const { getAllByText } = renderWithProviders(<CheckoutScreen />)

    await waitFor(() => {
      const matches = getAllByText(/primer mes/i)
      expect(matches.length).toBeGreaterThan(0)
    })
  })

  it('shows "Primer mes alquiler" line in the breakdown section for mixed cart', async () => {
    setupCheckoutMocks(
      [SINGLE_PRODUCT as unknown as typeof MOCK_PRODUCT, RENTAL_PRODUCT as unknown as typeof MOCK_PRODUCT],
      { 'product-single': 1, 'product-rental': 1 },
    )

    const { getByText } = renderWithProviders(<CheckoutScreen />)

    await waitFor(() => {
      expect(getByText(/Primer mes alquiler/i)).toBeTruthy()
    })
  })

  it('does NOT show rental copy for a single-payment-only cart', async () => {
    setupCheckoutMocks([SINGLE_PRODUCT as unknown as typeof MOCK_PRODUCT], { 'product-single': 1 })

    const { queryByText } = renderWithProviders(<CheckoutScreen />)

    await waitFor(() => {
      expect(queryByText(/primer mes/i)).toBeNull()
      expect(queryByText(/Primer mes alquiler/i)).toBeNull()
    })
  })
})

// ── Skip-cotización — checkout shows the real tax + final total (web parity) ──

describe('Skip-cotización — checkout preview shows real tax and final total', () => {
  it('shows the computed tax amount instead of "Al cotizar" when every item skips the quote', async () => {
    setupCheckoutMocks([WATER_PRODUCT as unknown as typeof MOCK_PRODUCT], { 'product-water': 1 })

    const { getByText, queryByText } = renderWithProviders(<CheckoutScreen />)

    // taxable = 4500 (subtotal) + 500 (flat shipping) = 5000
    // tax = round(5000 × 0.08887) = 444 → "$4.44"
    await waitFor(() => {
      expect(getByText('$4.44')).toBeTruthy()
    })
    expect(queryByText('Al cotizar')).toBeNull()
  })

  it('labels the total band "Total" and shows subtotal + shipping + tax', async () => {
    setupCheckoutMocks([WATER_PRODUCT as unknown as typeof MOCK_PRODUCT], { 'product-water': 1 })

    const { getByText } = renderWithProviders(<CheckoutScreen />)

    // total = 4500 (subtotal) + 500 (flat shipping) + 444 (tax) = 5444 → "$54.44"
    await waitFor(() => {
      expect(getByText('Total')).toBeTruthy()
      expect(getByText('$54.44')).toBeTruthy()
    })
  })

  it('shows the flat $5 shipping fee (not "Gratis") for a non-subscriber, even on a skip-quote cart', async () => {
    setupCheckoutMocks([WATER_PRODUCT as unknown as typeof MOCK_PRODUCT], { 'product-water': 1 })

    const { getByText, queryByText } = renderWithProviders(<CheckoutScreen />)

    // Envío line: mocked useShippingRate rate is 500¢ → "$5" (whole dollar amount)
    await waitFor(() => {
      expect(getByText('$5')).toBeTruthy()
    })
    expect(queryByText('Gratis')).toBeNull()
    expect(queryByText('A cotizar')).toBeNull()
  })

  it('charges the flat $5 shipping to an active subscriber too (subscription no longer includes free shipping)', async () => {
    setupCheckoutMocks([WATER_PRODUCT as unknown as typeof MOCK_PRODUCT], { 'product-water': 1 })
    mockUseMySubscription.mockReturnValue({
      data: { status: 'active' },
    } as unknown as ReturnType<typeof useMySubscription>)

    const { getByText, queryByText } = renderWithProviders(<CheckoutScreen />)

    // Same numbers as a non-subscriber: shipping $5, tax $4.44, total $54.44.
    await waitFor(() => {
      expect(getByText('$4.44')).toBeTruthy()
    })
    expect(getByText('Total')).toBeTruthy()
    expect(getByText('$54.44')).toBeTruthy()
    expect(queryByText('Gratis con tu suscripción')).toBeNull()
    expect(queryByText('Gratis')).toBeNull()
  })

  it('swaps the "repartidor cotiza" copy for the final-total copy', async () => {
    setupCheckoutMocks([WATER_PRODUCT as unknown as typeof MOCK_PRODUCT], { 'product-water': 1 })

    const { getByText, queryByText } = renderWithProviders(<CheckoutScreen />)

    await waitFor(() => {
      expect(getByText(/Sin cotización — este es el total final/i)).toBeTruthy()
    })
    expect(queryByText(/El repartidor cotiza el envío/i)).toBeNull()
  })

  it('keeps the "al cotizar" tax placeholder when items require a quote, but still charges flat shipping (regression)', async () => {
    // SINGLE_PRODUCT has no requiresQuote flag → not skip-quote
    setupCheckoutMocks([SINGLE_PRODUCT as unknown as typeof MOCK_PRODUCT], { 'product-single': 1 })

    const { getByText, getAllByText, queryByText } = renderWithProviders(<CheckoutScreen />)

    await waitFor(() => {
      expect(getByText('Al cotizar')).toBeTruthy()
    })
    // SINGLE_PRODUCT subtotal (500¢) and the flat shipping fee (500¢) both
    // render as "$5" — two separate rows, not a single "A cotizar" placeholder.
    expect(getAllByText('$5').length).toBeGreaterThanOrEqual(2)
    expect(queryByText('A cotizar')).toBeNull()
    expect(queryByText('Total')).toBeNull()
  })

  it('keeps placeholders for a mixed cart where only some items skip the quote', async () => {
    setupCheckoutMocks(
      [WATER_PRODUCT as unknown as typeof MOCK_PRODUCT, SINGLE_PRODUCT as unknown as typeof MOCK_PRODUCT],
      { 'product-water': 1, 'product-single': 1 },
    )

    const { getByText, queryByText } = renderWithProviders(<CheckoutScreen />)

    await waitFor(() => {
      expect(getByText('Al cotizar')).toBeTruthy()
    })
    expect(queryByText('Total')).toBeNull()
  })
})

// ── Propina — solo pago digital ───────────────────────────────────────────────

describe('Propina — solo pago digital', () => {
  it('oculta la sección Propina con pago en efectivo (default)', async () => {
    setupCheckoutMocks([SINGLE_PRODUCT as unknown as typeof MOCK_PRODUCT], { 'product-single': 1 })

    const { getByText, queryByText } = renderWithProviders(<CheckoutScreen />)

    await waitFor(() => {
      expect(getByText('Pago digital')).toBeTruthy()
    })
    expect(queryByText('Propina')).toBeNull()
  })

  it('muestra la sección al elegir Pago digital y manda tipPercent en el payload', async () => {
    setupCheckoutMocks([SINGLE_PRODUCT as unknown as typeof MOCK_PRODUCT], { 'product-single': 1 })

    const { getByText } = renderWithProviders(<CheckoutScreen />)

    await waitFor(() => {
      expect(getByText('Pago digital')).toBeTruthy()
    })

    fireEvent.press(getByText('Pago digital'))
    await waitFor(() => {
      expect(getByText('Propina')).toBeTruthy()
    })
    fireEvent.press(getByText('18%'))

    await act(async () => {
      fireEvent.press(getByText(/Confirmar pedido/i))
    })

    await waitFor(() => {
      expect(mockCreateOrderMutateAsync).toHaveBeenCalled()
    })
    expect(mockCreateOrderMutateAsync.mock.calls[0][0]).toMatchObject({
      paymentMethod: 'digital',
      tipPercent: 18,
    })
  })

  it('no manda tipPercent cuando queda "Sin propina"', async () => {
    setupCheckoutMocks([SINGLE_PRODUCT as unknown as typeof MOCK_PRODUCT], { 'product-single': 1 })

    const { getByText } = renderWithProviders(<CheckoutScreen />)

    await waitFor(() => {
      expect(getByText('Pago digital')).toBeTruthy()
    })
    fireEvent.press(getByText('Pago digital'))

    await act(async () => {
      fireEvent.press(getByText(/Confirmar pedido/i))
    })

    await waitFor(() => {
      expect(mockCreateOrderMutateAsync).toHaveBeenCalled()
    })
    expect(mockCreateOrderMutateAsync.mock.calls[0][0]).not.toHaveProperty(
      'tipPercent',
    )
  })
})

// ── Tarifa de envío — GET /shipping/rate ──────────────────────────────────────

describe('Tarifa de envío (admin-configurable, GET /shipping/rate)', () => {
  it('shows "…" for Envío and the total, and disables the submit button, while the rate is loading', async () => {
    setupCheckoutMocks([SINGLE_PRODUCT as unknown as typeof MOCK_PRODUCT], { 'product-single': 1 })
    // Loading: neither data nor error yet.
    mockUseShippingRate.mockReturnValue({
      data: undefined,
      isError: false,
    } as unknown as ReturnType<typeof useShippingRate>)

    const { getAllByText, getByText } = renderWithProviders(<CheckoutScreen />)

    await waitFor(() => {
      expect(getAllByText('…').length).toBeGreaterThan(0)
    })

    // Submit is disabled — pressing it must not create an order.
    fireEvent.press(getByText(/Confirmar pedido/i))
    expect(mockCreateOrderMutateAsync).not.toHaveBeenCalled()
  })

  it('falls back to the $5 default when the rate fetch errors', async () => {
    setupCheckoutMocks([SINGLE_PRODUCT as unknown as typeof MOCK_PRODUCT], { 'product-single': 1 })
    mockUseShippingRate.mockReturnValue({
      data: undefined,
      isError: true,
    } as unknown as ReturnType<typeof useShippingRate>)

    const { getAllByText, queryAllByText } = renderWithProviders(<CheckoutScreen />)

    // subtotal 500 (SINGLE_PRODUCT) + default shipping 500 both render "$5".
    await waitFor(() => {
      expect(getAllByText('$5').length).toBeGreaterThanOrEqual(2)
    })
    expect(queryAllByText('…').length).toBe(0)
  })

  it('shows a non-default rate ($6.50) in the Envío line and adds it to the total', async () => {
    setupCheckoutMocks([SINGLE_PRODUCT as unknown as typeof MOCK_PRODUCT], { 'product-single': 1 })
    mockUseShippingRate.mockReturnValue({
      data: { shippingCents: 650 },
      isError: false,
    } as unknown as ReturnType<typeof useShippingRate>)

    const { getByText } = renderWithProviders(<CheckoutScreen />)

    await waitFor(() => {
      expect(getByText('$6.50')).toBeTruthy()
    })
    // subtotal 500 + shipping 650 = 1150 → "$11.50" (not skip-quote: "Al
    // cotizar" tax placeholder, but the shown total already adds shipping).
    expect(getByText('$11.50')).toBeTruthy()
  })
})

// ── Tasa de impuesto por zona (address.taxRate) ───────────────────────────────

describe('Checkout — per-zone tax rate (selected address.taxRate)', () => {
  it('previews tax at the selected address\'s rate (6.625%) instead of the TAX_RATE fallback', async () => {
    setupCheckoutMocks([WATER_PRODUCT as unknown as typeof MOCK_PRODUCT], { 'product-water': 1 })
    mockUseMyAddresses.mockReturnValue({
      data: [{ ...ADDRESS_WITH_ZIP, taxRate: 0.06625 }],
    } as unknown as ReturnType<typeof useMyAddresses>)

    const { getByText, queryByText } = renderWithProviders(<CheckoutScreen />)

    // taxable = 4500 (subtotal) + 500 (flat shipping) = 5000
    // tax = round(5000 × 0.06625) = 331 → "$3.31" (vs. the $4.44 fallback)
    await waitFor(() => {
      expect(getByText('$3.31')).toBeTruthy()
    })
    expect(queryByText('$4.44')).toBeNull()
    // Label shows the rate that was actually applied.
    expect(getByText(/6\.625%/)).toBeTruthy()

    // total = 4500 + 500 + 331 = 5331 → "$53.31"
    expect(getByText('$53.31')).toBeTruthy()
  })

  it('falls back to the TAX_RATE label/preview when the selected address has no taxRate', async () => {
    setupCheckoutMocks([WATER_PRODUCT as unknown as typeof MOCK_PRODUCT], { 'product-water': 1 })
    mockUseMyAddresses.mockReturnValue({
      data: [ADDRESS_WITH_ZIP],
    } as unknown as ReturnType<typeof useMyAddresses>)

    const { getByText } = renderWithProviders(<CheckoutScreen />)

    await waitFor(() => {
      expect(getByText('$4.44')).toBeTruthy()
    })
    expect(getByText(/8\.887%/)).toBeTruthy()
  })

  it('includes the selected address\'s postalCode in the create-order deliveryAddress payload', async () => {
    setupCheckoutMocks([SINGLE_PRODUCT as unknown as typeof MOCK_PRODUCT], { 'product-single': 1 })
    mockUseMyAddresses.mockReturnValue({
      data: [{ ...ADDRESS_WITH_ZIP, taxRate: 0.06625 }],
    } as unknown as ReturnType<typeof useMyAddresses>)

    const { getByText } = renderWithProviders(<CheckoutScreen />)

    await waitFor(() => {
      expect(getByText('Calle Duarte 100 · ZIP 10451')).toBeTruthy()
    })

    await act(async () => {
      fireEvent.press(getByText(/Confirmar pedido/i))
    })

    await waitFor(() => {
      expect(mockCreateOrderMutateAsync).toHaveBeenCalled()
    })
    const payload = mockCreateOrderMutateAsync.mock.calls[0][0]
    expect(payload.deliveryAddress).toMatchObject({ postalCode: '10451' })
  })

  it('includes the selected address\'s houseNumber in the create-order deliveryAddress payload', async () => {
    setupCheckoutMocks([SINGLE_PRODUCT as unknown as typeof MOCK_PRODUCT], { 'product-single': 1 })
    mockUseMyAddresses.mockReturnValue({
      data: [{ ...ADDRESS_WITH_ZIP, taxRate: 0.06625, houseNumber: '24' }],
    } as unknown as ReturnType<typeof useMyAddresses>)

    const { getByText } = renderWithProviders(<CheckoutScreen />)

    await waitFor(() => {
      expect(getByText('Calle Duarte 100 · ZIP 10451')).toBeTruthy()
    })

    await act(async () => {
      fireEvent.press(getByText(/Confirmar pedido/i))
    })

    await waitFor(() => {
      expect(mockCreateOrderMutateAsync).toHaveBeenCalled()
    })
    const payload = mockCreateOrderMutateAsync.mock.calls[0][0]
    expect(payload.deliveryAddress).toMatchObject({ houseNumber: '24' })
  })

  it('sends houseNumber as null when the selected address has none', async () => {
    setupCheckoutMocks([SINGLE_PRODUCT as unknown as typeof MOCK_PRODUCT], { 'product-single': 1 })
    mockUseMyAddresses.mockReturnValue({
      data: [{ ...ADDRESS_WITH_ZIP, taxRate: 0.06625 }],
    } as unknown as ReturnType<typeof useMyAddresses>)

    const { getByText } = renderWithProviders(<CheckoutScreen />)

    await waitFor(() => {
      expect(getByText('Calle Duarte 100 · ZIP 10451')).toBeTruthy()
    })

    await act(async () => {
      fireEvent.press(getByText(/Confirmar pedido/i))
    })

    await waitFor(() => {
      expect(mockCreateOrderMutateAsync).toHaveBeenCalled()
    })
    const payload = mockCreateOrderMutateAsync.mock.calls[0][0]
    expect(payload.deliveryAddress.houseNumber).toBeNull()
  })

  it('includes deliveryAddressId (the saved address id) alongside the deliveryAddress snapshot', async () => {
    setupCheckoutMocks([SINGLE_PRODUCT as unknown as typeof MOCK_PRODUCT], { 'product-single': 1 })
    mockUseMyAddresses.mockReturnValue({
      data: [{ ...ADDRESS_WITH_ZIP, taxRate: 0.06625 }],
    } as unknown as ReturnType<typeof useMyAddresses>)

    const { getByText } = renderWithProviders(<CheckoutScreen />)

    await waitFor(() => {
      expect(getByText('Calle Duarte 100 · ZIP 10451')).toBeTruthy()
    })

    await act(async () => {
      fireEvent.press(getByText(/Confirmar pedido/i))
    })

    await waitFor(() => {
      expect(mockCreateOrderMutateAsync).toHaveBeenCalled()
    })
    const payload = mockCreateOrderMutateAsync.mock.calls[0][0]
    // The server resolves the tax rate from this saved address row — the
    // snapshot ZIP alone is no longer trusted for money (see API contract).
    expect(payload.deliveryAddressId).toBe('addr-1')
    expect(payload.deliveryAddress).toMatchObject({ postalCode: '10451' })
  })
})
