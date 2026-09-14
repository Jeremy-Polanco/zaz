/**
 * Customer orders list (tabs) — order card shows the assigned delivery day.
 *
 * GET /orders now returns `scheduledDeliveryDate` per order; the list card
 * shows it when present (a natural place next to the delivery address) and
 * renders nothing extra when it's null.
 */
import React from 'react'
import { renderWithProviders } from '../../test/test-utils'
import type { Order } from '../../lib/types'

jest.mock('../../lib/queries', () => ({
  useCurrentUser: jest.fn(() => ({
    data: { id: 'user-1', fullName: 'Ana Cliente' },
    isPending: false,
  })),
  useOrders: jest.fn(),
}))

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
}))

import { useOrders } from '../../lib/queries'
import OrdersTab from './orders'

const mockUseOrders = useOrders as jest.MockedFunction<typeof useOrders>

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'order-1',
    customerId: 'user-1',
    status: 'pending_validation',
    deliveryAddress: { text: 'Calle Falsa 123' },
    subtotal: '45.00',
    pointsRedeemed: '0',
    shipping: '5.00',
    tax: '4.00',
    taxRate: '0.08887',
    totalAmount: '54.00',
    paymentMethod: 'cash',
    stripePaymentIntentId: null,
    paidAt: null,
    items: [],
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  } as Order
}

afterEach(() => {
  jest.clearAllMocks()
})

describe('OrdersTab — card shows the assigned delivery day', () => {
  it('shows "Entrega: miércoles 16 de septiembre" when scheduledDeliveryDate is set', () => {
    mockUseOrders.mockReturnValue({
      data: [makeOrder({ scheduledDeliveryDate: '2026-09-16' })],
      isPending: false,
      refetch: jest.fn(),
      isRefetching: false,
    } as unknown as ReturnType<typeof useOrders>)

    const { getByText } = renderWithProviders(<OrdersTab />)

    expect(getByText('Entrega: miércoles 16 de septiembre')).toBeTruthy()
  })

  it('renders nothing extra when scheduledDeliveryDate is null', () => {
    mockUseOrders.mockReturnValue({
      data: [makeOrder({ scheduledDeliveryDate: null })],
      isPending: false,
      refetch: jest.fn(),
      isRefetching: false,
    } as unknown as ReturnType<typeof useOrders>)

    const { queryByText } = renderWithProviders(<OrdersTab />)

    expect(queryByText(/^Entrega:/)).toBeNull()
  })
})
