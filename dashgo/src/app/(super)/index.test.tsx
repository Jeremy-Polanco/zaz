/**
 * SuperOrdersScreen (mobile) — admin home order list.
 *
 * GET /orders (staff) now returns `distanceMiles: number | null` per order —
 * miles from the driver's active location to the delivery address, already
 * sorted by the API (active nearest-first, history newest-first). The screen
 * must show the distance next to the address when present and render
 * nothing extra when it's null — it must NOT re-sort visibleOrders.
 */
import React from 'react'
import { renderWithProviders } from '../../test/test-utils'
import type { Order } from '../../lib/types'

jest.mock('../../lib/queries', () => ({
  useCustomerActivity: jest.fn(() => ({ data: undefined })),
  useOrders: jest.fn(),
  useUpdateOrderStatus: jest.fn(() => ({ mutate: jest.fn(), isPending: false })),
  useCurrentUser: jest.fn(() => ({ data: undefined })),
  useMyAddresses: jest.fn(() => ({ data: undefined })),
  useSetActiveLocation: jest.fn(() => ({ mutate: jest.fn() })),
  useSetOrderQuote: jest.fn(() => ({ mutate: jest.fn(), isPending: false })),
}))

jest.mock('expo-router', () => ({
  router: { navigate: jest.fn(), push: jest.fn(), back: jest.fn() },
}))

import { useOrders } from '../../lib/queries'
import SuperOrdersScreen from './index'

const mockUseOrders = useOrders as jest.MockedFunction<typeof useOrders>

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'order-1',
    customerId: 'user-1',
    customer: { id: 'user-1', fullName: 'Ana Cliente' } as Order['customer'],
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

describe('SuperOrdersScreen — order card shows the assigned delivery day', () => {
  it('shows "Entrega: mié 16 sep" when the order carries a scheduledDeliveryDate', () => {
    mockUseOrders.mockReturnValue({
      data: [makeOrder({ scheduledDeliveryDate: '2026-09-16' })],
      isPending: false,
      refetch: jest.fn(),
      isRefetching: false,
    } as unknown as ReturnType<typeof useOrders>)

    const { getByText } = renderWithProviders(<SuperOrdersScreen />)

    // 2026-09-16 es miércoles.
    expect(getByText('Entrega: mié 16 sep')).toBeTruthy()
  })

  it('renders nothing extra when scheduledDeliveryDate is null', () => {
    mockUseOrders.mockReturnValue({
      data: [makeOrder({ scheduledDeliveryDate: null })],
      isPending: false,
      refetch: jest.fn(),
      isRefetching: false,
    } as unknown as ReturnType<typeof useOrders>)

    const { queryByText } = renderWithProviders(<SuperOrdersScreen />)

    expect(queryByText(/^Entrega:/)).toBeNull()
  })
})

describe('SuperOrdersScreen — order card shows the driver-to-address distance', () => {
  it('shows "2.3 mi" when the order carries a distanceMiles number', () => {
    mockUseOrders.mockReturnValue({
      data: [makeOrder({ distanceMiles: 2.3 })],
      isPending: false,
      refetch: jest.fn(),
      isRefetching: false,
    } as unknown as ReturnType<typeof useOrders>)

    const { getByText } = renderWithProviders(<SuperOrdersScreen />)

    expect(getByText('2.3 mi')).toBeTruthy()
  })

  it('renders nothing extra when distanceMiles is null', () => {
    mockUseOrders.mockReturnValue({
      data: [makeOrder({ distanceMiles: null })],
      isPending: false,
      refetch: jest.fn(),
      isRefetching: false,
    } as unknown as ReturnType<typeof useOrders>)

    const { queryByText } = renderWithProviders(<SuperOrdersScreen />)

    expect(queryByText(/mi$/)).toBeNull()
  })

  it('does not re-sort — renders orders in the exact order the API returned them', () => {
    // The API already sorts nearest-first; a nearer order (0.5 mi) appearing
    // AFTER a farther one (5.0 mi) in the response must stay in that order.
    mockUseOrders.mockReturnValue({
      data: [
        makeOrder({ id: 'order-far', distanceMiles: 5.0, customer: { id: 'u1', fullName: 'Lejos' } as Order['customer'] }),
        makeOrder({ id: 'order-near', distanceMiles: 0.5, customer: { id: 'u2', fullName: 'Cerca' } as Order['customer'] }),
      ],
      isPending: false,
      refetch: jest.fn(),
      isRefetching: false,
    } as unknown as ReturnType<typeof useOrders>)

    const { getAllByText } = renderWithProviders(<SuperOrdersScreen />)

    const names = getAllByText(/^(Lejos|Cerca)$/).map((n) => n.props.children)
    expect(names).toEqual(['Lejos', 'Cerca'])
  })
})
