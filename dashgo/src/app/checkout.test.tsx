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

    // tax = round(4500 × 0.08887) = 400 → "$4"
    await waitFor(() => {
      expect(getByText('$4')).toBeTruthy()
    })
    expect(queryByText('Al cotizar')).toBeNull()
  })

  it('labels the total band "Total" and shows subtotal + tax', async () => {
    setupCheckoutMocks([WATER_PRODUCT as unknown as typeof MOCK_PRODUCT], { 'product-water': 1 })

    const { getByText } = renderWithProviders(<CheckoutScreen />)

    // total = 4500 + 400 = 4900 → "$49"
    await waitFor(() => {
      expect(getByText('Total')).toBeTruthy()
      expect(getByText('$49')).toBeTruthy()
    })
  })

  it('shows "Gratis" shipping for a skip-quote cart', async () => {
    setupCheckoutMocks([WATER_PRODUCT as unknown as typeof MOCK_PRODUCT], { 'product-water': 1 })

    const { getByText, queryByText } = renderWithProviders(<CheckoutScreen />)

    await waitFor(() => {
      expect(getByText('Gratis')).toBeTruthy()
    })
    expect(queryByText('A cotizar')).toBeNull()
  })

  it('swaps the "repartidor cotiza" copy for the final-total copy', async () => {
    setupCheckoutMocks([WATER_PRODUCT as unknown as typeof MOCK_PRODUCT], { 'product-water': 1 })

    const { getByText, queryByText } = renderWithProviders(<CheckoutScreen />)

    await waitFor(() => {
      expect(getByText(/Sin cotización — este es el total final/i)).toBeTruthy()
    })
    expect(queryByText(/El repartidor cotiza el envío/i)).toBeNull()
  })

  it('keeps the "a cotizar" placeholders when items require a quote (regression)', async () => {
    // SINGLE_PRODUCT has no requiresQuote flag → not skip-quote
    setupCheckoutMocks([SINGLE_PRODUCT as unknown as typeof MOCK_PRODUCT], { 'product-single': 1 })

    const { getByText, queryByText } = renderWithProviders(<CheckoutScreen />)

    await waitFor(() => {
      expect(getByText('Al cotizar')).toBeTruthy()
      expect(getByText('A cotizar')).toBeTruthy()
    })
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
