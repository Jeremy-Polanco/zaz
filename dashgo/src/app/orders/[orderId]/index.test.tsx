/**
 * Order detail screen — shipping row.
 *
 * Contract: the API now creates EVERY order with a flat $5 shipping fee —
 * subscribers included, the subscription no longer implies free shipping —
 * at CREATION time — even pending_quote orders that still await the driver's
 * quote for the rest. Before this change, a pending_quote order showed
 * "A cotizar" for shipping; now `order.shipping` already carries the real
 * number, so the screen must show it like any other status. Taxes are a
 * different story — those genuinely depend on the quote, so "Al cotizar"
 * stays for pending_quote.
 */
import React from 'react'
import { waitFor } from '@testing-library/react-native'
import { renderWithProviders } from '../../../test/test-utils'
import type { Order } from '../../../lib/types'

jest.mock('../../../lib/queries', () => ({
  useAuthorizeOrder: jest.fn(() => ({ mutateAsync: jest.fn(), isPending: false })),
  useConfirmCashOrder: jest.fn(() => ({ mutateAsync: jest.fn(), isPending: false })),
  useConfirmNonStripeOrder: jest.fn(() => ({ mutateAsync: jest.fn(), isPending: false })),
}))

jest.mock('@stripe/stripe-react-native', () => ({
  useStripe: () => ({
    initPaymentSheet: jest.fn(),
    presentPaymentSheet: jest.fn(),
  }),
}))

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn(), back: jest.fn() },
  useLocalSearchParams: jest.fn(() => ({ orderId: 'order-1' })),
}))

const mockApiGet = jest.fn()
jest.mock('../../../lib/api', () => ({
  API_URL: 'http://localhost:3000',
  api: {
    get: (...args: unknown[]) => mockApiGet(...args),
  },
}))

import OrderDetailScreen from './index'

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'order-1',
    customerId: 'user-1',
    status: 'pending_quote',
    deliveryAddress: null,
    subtotal: '45.00',
    pointsRedeemed: '0',
    // Flat $5 shipping, set at creation even before the driver's quote.
    shipping: '5.00',
    tax: '0',
    taxRate: '0.08887',
    totalAmount: '50.00',
    paymentMethod: 'cash',
    stripePaymentIntentId: null,
    paidAt: null,
    items: [
      {
        id: 'item-1',
        orderId: 'order-1',
        productId: 'product-1',
        quantity: 1,
        priceAtOrder: '45.00',
        createdAt: '2026-01-01T00:00:00Z',
      },
    ],
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  } as Order
}

afterEach(() => {
  jest.clearAllMocks()
})

describe('Order detail — shipping row reflects the flat fee set at creation', () => {
  it(
    'shows the flat $5 shipping amount for a pending_quote order — "A cotizar" only remains on the still-unknown grand total',
    async () => {
      mockApiGet.mockResolvedValue({ data: makeOrder({ status: 'pending_quote' }) })

      const { getByText, getAllByText } = renderWithProviders(<OrderDetailScreen />)

      await waitFor(
        () => {
          expect(getByText('$5')).toBeTruthy()
        },
        { timeout: 10000 },
      )
      // Before this change there were TWO "A cotizar" placeholders (shipping
      // + grand total). The shipping row is now a real number, so only the
      // grand-total placeholder remains — it genuinely can't be known until
      // the driver quotes the tax.
      expect(getAllByText('A cotizar')).toHaveLength(1)
    },
    15000,
  )

  it('still shows "Al cotizar" for taxes on a pending_quote order', async () => {
    mockApiGet.mockResolvedValue({ data: makeOrder({ status: 'pending_quote' }) })

    const { getByText } = renderWithProviders(<OrderDetailScreen />)

    await waitFor(() => {
      expect(getByText('Al cotizar')).toBeTruthy()
    })
  })

  it('shows the same flat shipping amount once the order is quoted', async () => {
    mockApiGet.mockResolvedValue({
      data: makeOrder({
        status: 'quoted',
        paymentMethod: 'cash',
        tax: '4.00',
        totalAmount: '54.00',
      }),
    })

    const { getByText, queryByText } = renderWithProviders(<OrderDetailScreen />)

    await waitFor(() => {
      expect(getByText('$5')).toBeTruthy()
    })
    expect(queryByText('A cotizar')).toBeNull()
  })
})

describe('Order detail — subscriber badge no longer claims free shipping', () => {
  it('shows the SuscriptorBadge without the "envío gratis" caption for a quoted order placed by a subscriber', async () => {
    mockApiGet.mockResolvedValue({
      data: makeOrder({ status: 'quoted', wasSubscriberAtQuote: true, tax: '4.00', totalAmount: '54.00' }),
    })

    const { getByText, queryByText } = renderWithProviders(<OrderDetailScreen />)

    await waitFor(() => {
      expect(getByText('Suscriptor')).toBeTruthy()
    })
    expect(queryByText('Envío gratis aplicado')).toBeNull()
  })
})

describe('Order detail — scheduled delivery day', () => {
  it('shows a prominent "Entrega programada" block with the formatted day when scheduledDeliveryDate is set', async () => {
    mockApiGet.mockResolvedValue({
      data: makeOrder({ scheduledDeliveryDate: '2026-09-16' }),
    })

    const { findByText } = renderWithProviders(<OrderDetailScreen />)

    expect(await findByText('Entrega programada')).toBeTruthy()
    // 2026-09-16 es miércoles — sin corrimiento de día por timezone.
    expect(await findByText('miércoles 16 de septiembre')).toBeTruthy()
  })

  it('renders nothing extra when scheduledDeliveryDate is null', async () => {
    mockApiGet.mockResolvedValue({
      data: makeOrder({ scheduledDeliveryDate: null }),
    })

    const { queryByText, findByText } = renderWithProviders(<OrderDetailScreen />)

    await findByText('$5')
    expect(queryByText('Entrega programada')).toBeNull()
  })
})

describe('Order detail — distance surcharge breakdown row', () => {
  it('shows "Recargo por distancia" between shipping and taxes when deliverySurcharge > 0', async () => {
    mockApiGet.mockResolvedValue({
      data: makeOrder({ deliverySurcharge: '3.00' }),
    })

    const { findByText } = renderWithProviders(<OrderDetailScreen />)

    expect(await findByText('Recargo por distancia')).toBeTruthy()
  })

  it('hides the row when deliverySurcharge is 0 or absent', async () => {
    mockApiGet.mockResolvedValue({ data: makeOrder() })

    const { queryByText, findByText } = renderWithProviders(<OrderDetailScreen />)

    await findByText('$5')
    expect(queryByText('Recargo por distancia')).toBeNull()
  })
})

describe('Order detail — delivery address', () => {
  it('shows the delivery address (with ZIP) through formatAddressLine when present', async () => {
    mockApiGet.mockResolvedValue({
      data: makeOrder({
        deliveryAddress: {
          text: 'Calle Duarte 100',
          postalCode: '10451',
        },
      }),
    })

    const { findByText } = renderWithProviders(<OrderDetailScreen />)

    expect(await findByText('Calle Duarte 100 · ZIP 10451')).toBeTruthy()
    expect(await findByText('Dirección de entrega')).toBeTruthy()
  })

  it('hides the delivery address section when there is none', async () => {
    mockApiGet.mockResolvedValue({ data: makeOrder({ deliveryAddress: null }) })

    const { queryByText, findByText } = renderWithProviders(<OrderDetailScreen />)

    await findByText('$5')
    expect(queryByText('Dirección de entrega')).toBeNull()
  })
})
