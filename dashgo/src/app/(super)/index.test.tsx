/**
 * SuperOrdersScreen (mobile) — admin home order list.
 *
 * GET /orders (staff) now returns `distanceMiles: number | null` per order —
 * miles from the driver's active location to the delivery address, already
 * sorted by the API (active nearest-first, history newest-first). The screen
 * must show the distance next to the address when present and render
 * nothing extra when it's null — it must NOT re-sort visibleOrders.
 *
 * Regla del dueño (2026-09-29): un pedido programado a un día FUTURO sale de
 * la ruta de hoy ("Activos") y vive en el filtro "Programados" hasta que le
 * toca. La API decide (`dispatchBucket`); la pantalla sólo lo respeta.
 */
import React from 'react'
import { fireEvent, within } from '@testing-library/react-native'
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

// The device-GPS hook (lib/use-device-position.ts) has its own dedicated
// tests (mocking expo-location) — here it's mocked at the hook boundary so
// this screen's tests can drive `status`/`position` directly.
jest.mock('../../lib/use-device-position', () => ({
  useDevicePosition: jest.fn(),
}))

import { useOrders } from '../../lib/queries'
import { useDevicePosition } from '../../lib/use-device-position'
import SuperOrdersScreen from './index'

const mockUseOrders = useOrders as jest.MockedFunction<typeof useOrders>
const mockUseDevicePosition = useDevicePosition as jest.MockedFunction<
  typeof useDevicePosition
>

// Default: no position yet, nothing located — matches every pre-existing
// test in this file that doesn't care about GPS. Tests that DO care
// override with their own mockReturnValue.
beforeEach(() => {
  mockUseDevicePosition.mockReturnValue({
    position: null,
    status: 'idle',
    refresh: jest.fn(),
  })
})

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

const NO_LOCATION_NOTICE =
  'Sin tu ubicación, los pedidos salen por fecha. Activá la ubicación para verlos por cercanía.'

describe('SuperOrdersScreen — dispatch sorted from the driver device position', () => {
  function mockOrdersOnce() {
    mockUseOrders.mockReturnValue({
      data: [makeOrder()],
      isPending: false,
      refetch: jest.fn(),
      isRefetching: false,
    } as unknown as ReturnType<typeof useOrders>)
  }

  it('passes the device lat/lng to useOrders once GPS is granted', () => {
    mockOrdersOnce()
    mockUseDevicePosition.mockReturnValue({
      position: { lat: 40.7357, lng: -74.1724 },
      status: 'granted',
      refresh: jest.fn(),
    })

    renderWithProviders(<SuperOrdersScreen />)

    expect(mockUseOrders).toHaveBeenCalledWith({ lat: 40.7357, lng: -74.1724 })
  })

  it('calls useOrders with no coords and shows the notice when permission is denied', () => {
    mockOrdersOnce()
    mockUseDevicePosition.mockReturnValue({
      position: null,
      status: 'denied',
      refresh: jest.fn(),
    })

    const { getByText } = renderWithProviders(<SuperOrdersScreen />)

    expect(mockUseOrders).toHaveBeenCalledWith(undefined)
    expect(getByText(NO_LOCATION_NOTICE)).toBeTruthy()
  })

  it('calls useOrders with no coords and shows the notice when GPS is unavailable', () => {
    mockOrdersOnce()
    mockUseDevicePosition.mockReturnValue({
      position: null,
      status: 'unavailable',
      refresh: jest.fn(),
    })

    const { getByText } = renderWithProviders(<SuperOrdersScreen />)

    expect(mockUseOrders).toHaveBeenCalledWith(undefined)
    expect(getByText(NO_LOCATION_NOTICE)).toBeTruthy()
  })

  it('keeps showing the order list while locating, without the notice', () => {
    mockOrdersOnce()
    mockUseDevicePosition.mockReturnValue({
      position: null,
      status: 'locating',
      refresh: jest.fn(),
    })

    const { getByText, queryByText } = renderWithProviders(<SuperOrdersScreen />)

    expect(getByText('Ana Cliente')).toBeTruthy()
    expect(queryByText(NO_LOCATION_NOTICE)).toBeNull()
  })

  it('does not show the notice once granted', () => {
    mockOrdersOnce()
    mockUseDevicePosition.mockReturnValue({
      position: { lat: 1, lng: 2 },
      status: 'granted',
      refresh: jest.fn(),
    })

    const { queryByText } = renderWithProviders(<SuperOrdersScreen />)

    expect(queryByText(NO_LOCATION_NOTICE)).toBeNull()
  })

  it('pull-to-refresh refetches orders AND refreshes the device position', () => {
    mockOrdersOnce()
    const refetch = jest.fn()
    const refreshPosition = jest.fn()
    mockUseOrders.mockReturnValue({
      data: [makeOrder()],
      isPending: false,
      refetch,
      isRefetching: false,
    } as unknown as ReturnType<typeof useOrders>)
    mockUseDevicePosition.mockReturnValue({
      position: { lat: 1, lng: 2 },
      status: 'granted',
      refresh: refreshPosition,
    })

    const { UNSAFE_getByType } = renderWithProviders(<SuperOrdersScreen />)
    const { FlatList } = require('react-native')

    UNSAFE_getByType(FlatList).props.onRefresh()

    expect(refetch).toHaveBeenCalledTimes(1)
    expect(refreshPosition).toHaveBeenCalledTimes(1)
  })
})

describe('SuperOrdersScreen — pedidos programados fuera de la ruta', () => {
  const NAMES = /^(De Hoy|Programado Uno|Programado Dos|Programado Tres|Entregado)$/

  function withOrders(orders: Order[]) {
    mockUseOrders.mockReturnValue({
      data: orders,
      isPending: false,
      refetch: jest.fn(),
      isRefetching: false,
    } as unknown as ReturnType<typeof useOrders>)
  }

  const named = (id: string, fullName: string, overrides: Partial<Order> = {}) =>
    makeOrder({
      id,
      customer: { id: `u-${id}`, fullName } as Order['customer'],
      ...overrides,
    })

  const dueOrder = () =>
    named('due', 'De Hoy', { status: 'pending_validation', dispatchBucket: 'due' })
  const scheduled = (id: string, fullName: string, day: string) =>
    named(id, fullName, {
      status: 'quoted',
      dispatchBucket: 'scheduled',
      scheduledDeliveryDate: day,
    })

  it('un pedido programado a futuro NO aparece en la lista por defecto (Activos)', () => {
    withOrders([dueOrder(), scheduled('s1', 'Programado Uno', '2099-01-05')])

    const { getByText, queryByText } = renderWithProviders(<SuperOrdersScreen />)

    expect(getByText('De Hoy')).toBeTruthy()
    expect(queryByText('Programado Uno')).toBeNull()
  })

  it('el filtro "Programados" lista sólo los programados', () => {
    withOrders([dueOrder(), scheduled('s1', 'Programado Uno', '2099-01-05')])

    const { getByText, queryByText, getByTestId } = renderWithProviders(
      <SuperOrdersScreen />,
    )
    fireEvent.press(getByTestId('route-filter-scheduled'))

    expect(getByText('Programado Uno')).toBeTruthy()
    expect(queryByText('De Hoy')).toBeNull()
  })

  it('"Programados" conserva el orden de la API (por día) sin reordenar', () => {
    withOrders([
      scheduled('s1', 'Programado Uno', '2099-01-05'),
      scheduled('s2', 'Programado Dos', '2099-01-09'),
      scheduled('s3', 'Programado Tres', '2099-02-01'),
    ])

    const { getAllByText, getByTestId } = renderWithProviders(<SuperOrdersScreen />)
    fireEvent.press(getByTestId('route-filter-scheduled'))

    expect(getAllByText(NAMES).map((n) => n.props.children)).toEqual([
      'Programado Uno',
      'Programado Dos',
      'Programado Tres',
    ])
  })

  it('el chip "Programados" va justo después del chip por defecto', () => {
    withOrders([])

    const { getAllByTestId } = renderWithProviders(<SuperOrdersScreen />)
    const ids = getAllByTestId(/^route-filter-/).map((c) => c.props.testID)

    expect(ids.slice(0, 2)).toEqual(['route-filter-all', 'route-filter-scheduled'])
  })

  it('el KPI "Programados" cuenta los programados', () => {
    withOrders([
      dueOrder(),
      scheduled('s1', 'Programado Uno', '2099-01-05'),
      scheduled('s2', 'Programado Dos', '2099-01-09'),
      scheduled('s3', 'Programado Tres', '2099-02-01'),
    ])

    const { getByTestId } = renderWithProviders(<SuperOrdersScreen />)
    const kpi = getByTestId('kpi-scheduled')

    expect(within(kpi).getByText('Programados')).toBeTruthy()
    expect(within(kpi).getByText('3')).toBeTruthy()
  })

  it('el KPI "Programados" queda en 0 cuando nada está programado', () => {
    withOrders([dueOrder()])

    const { getByTestId } = renderWithProviders(<SuperOrdersScreen />)

    expect(within(getByTestId('kpi-scheduled')).getByText('0')).toBeTruthy()
  })

  it('los KPI por etapa siguen contando por estado, programados incluidos', () => {
    // "Cotizar" es trabajo por ETAPA: un pedido por cotizar que además está
    // programado sigue faltando cotizar.
    withOrders([
      named('q1', 'Programado Uno', {
        status: 'pending_quote',
        dispatchBucket: 'scheduled',
        scheduledDeliveryDate: '2099-01-05',
      }),
    ])

    const { getByText } = renderWithProviders(<SuperOrdersScreen />)

    expect(getByText(/^1 por cotizar/)).toBeTruthy()
  })

  it('los sub-filtros por estado actúan sólo dentro de la ruta de hoy', () => {
    // "Por confirmar" no debe traer un pedido programado a futuro aunque su
    // estado sea pending_validation.
    withOrders([
      dueOrder(),
      named('s1', 'Programado Uno', {
        status: 'pending_validation',
        dispatchBucket: 'scheduled',
        scheduledDeliveryDate: '2099-01-05',
      }),
    ])

    const { getByText, queryByText, getByTestId } = renderWithProviders(
      <SuperOrdersScreen />,
    )
    fireEvent.press(getByTestId('route-filter-pending_validation'))

    expect(getByText('De Hoy')).toBeTruthy()
    expect(queryByText('Programado Uno')).toBeNull()
  })

  it('el Historial sigue mostrando el programado (sólo se excluyen los cancelados)', () => {
    withOrders([
      dueOrder(),
      scheduled('s1', 'Programado Uno', '2099-01-05'),
      named('c1', 'Cancelado', { status: 'cancelled', dispatchBucket: 'history' }),
    ])

    const { getByText, queryByText, getByTestId } = renderWithProviders(
      <SuperOrdersScreen />,
    )
    fireEvent.press(getByTestId('route-filter-history'))

    expect(getByText('De Hoy')).toBeTruthy()
    expect(getByText('Programado Uno')).toBeTruthy()
    expect(queryByText('Cancelado')).toBeNull()
  })

  it('el pedido que la API devuelve como "due" (le llegó su día) vuelve a Activos', () => {
    withOrders([
      named('back', 'De Hoy', {
        status: 'quoted',
        dispatchBucket: 'due',
        scheduledDeliveryDate: '2026-09-29',
      }),
    ])

    const { getByText } = renderWithProviders(<SuperOrdersScreen />)

    expect(getByText('De Hoy')).toBeTruthy()
  })

  describe('API anterior, sin dispatchBucket', () => {
    it('un pedido vivo sin bucket cuenta como de hoy y sale en Activos', () => {
      withOrders([named('o1', 'De Hoy', { status: 'in_delivery_route' })])

      const { getByText, getByTestId } = renderWithProviders(<SuperOrdersScreen />)

      expect(getByText('De Hoy')).toBeTruthy()
      expect(within(getByTestId('kpi-scheduled')).getByText('0')).toBeTruthy()
    })

    it('un pedido entregado sin bucket es histórico: ni en Activos ni en Programados', () => {
      withOrders([named('o1', 'Entregado', { status: 'delivered', createdAt: '2020-01-01T00:00:00Z' })])

      const { queryByText, getByTestId } = renderWithProviders(<SuperOrdersScreen />)
      expect(queryByText('Entregado')).toBeNull()

      fireEvent.press(getByTestId('route-filter-scheduled'))
      expect(queryByText('Entregado')).toBeNull()
    })
  })
})
