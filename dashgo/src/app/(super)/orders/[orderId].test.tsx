/**
 * Detalle de orden del ADMIN — fila de envío.
 *
 * El envío nace con la orden (fijo $5 para todos, suscriptores incluidos —
 * la suscripción ya no exime del envío) aun en pending_quote, así que la
 * pantalla del admin lo muestra siempre. El impuesto sí espera a la
 * cotización: "A calcular" se queda.
 */
import React from 'react'
import { fireEvent, waitFor } from '@testing-library/react-native'
import { renderWithProviders } from '../../../test/test-utils'
import type { Order } from '../../../lib/types'

jest.mock('../../../lib/queries', () => ({
  useDeleteOrder: jest.fn(() => ({ mutateAsync: jest.fn(), isPending: false })),
  useUpdateOrderStatus: jest.fn(() => ({ mutateAsync: jest.fn(), isPending: false })),
  useSetDeliveryDate: jest.fn(() => ({ mutate: jest.fn(), isPending: false })),
}))

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn(), back: jest.fn() },
  useLocalSearchParams: jest.fn(() => ({ orderId: 'order-1' })),
}))

jest.mock('../../../components/QuoteBottomSheet', () => ({
  QuoteBottomSheet: () => null,
}))
jest.mock('../../../components/LocationBottomSheet', () => ({
  LocationBottomSheet: () => null,
}))

const mockApiGet = jest.fn()
jest.mock('../../../lib/api', () => ({
  API_URL: 'http://localhost:3000',
  api: {
    get: (...args: unknown[]) => mockApiGet(...args),
  },
}))

import { useSetDeliveryDate } from '../../../lib/queries'
import SuperOrderDetailScreen from './[orderId]'

const mockUseSetDeliveryDate = useSetDeliveryDate as jest.MockedFunction<
  typeof useSetDeliveryDate
>

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'order-1',
    customerId: 'user-1',
    status: 'pending_quote',
    deliveryAddress: null,
    subtotal: '45.00',
    pointsRedeemed: '0',
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
        product: { id: 'product-1', name: 'Botellón', requiresQuote: true },
      },
    ],
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  } as unknown as Order
}

afterEach(() => {
  jest.clearAllMocks()
})

describe('Detalle de orden (admin) — el envío fijo se muestra desde la creación', () => {
  it('muestra el envío de $5 en una orden pending_quote y deja "A calcular" sólo para el impuesto', async () => {
    mockApiGet.mockResolvedValue({ data: makeOrder({ status: 'pending_quote' }) })

    const { getByText, queryByText } = renderWithProviders(<SuperOrderDetailScreen />)

    await waitFor(() => {
      expect(getByText('$5')).toBeTruthy()
    })
    expect(queryByText('A cotizar')).toBeNull()
    expect(getByText('A calcular')).toBeTruthy()
  })

  it('muestra el mismo envío una vez cotizada', async () => {
    mockApiGet.mockResolvedValue({
      data: makeOrder({ status: 'quoted', tax: '4.00', totalAmount: '54.00' }),
    })

    const { getByText, queryByText } = renderWithProviders(<SuperOrderDetailScreen />)

    await waitFor(() => {
      expect(getByText('$5')).toBeTruthy()
    })
    expect(queryByText('A calcular')).toBeNull()
  })
})

describe('Detalle de orden (admin) — badge de suscriptor sin la leyenda de envío gratis', () => {
  it('muestra el SuscriptorBadge sin "Envío gratis aplicado" en una orden cotizada de un suscriptor', async () => {
    mockApiGet.mockResolvedValue({
      data: makeOrder({
        status: 'quoted',
        wasSubscriberAtQuote: true,
        tax: '4.00',
        totalAmount: '54.00',
      }),
    })

    const { getByText, queryByText } = renderWithProviders(<SuperOrderDetailScreen />)

    await waitFor(() => {
      expect(getByText('Suscriptor')).toBeTruthy()
    })
    expect(queryByText('Envío gratis aplicado')).toBeNull()
  })
})

describe('Día de entrega (admin)', () => {
  it('muestra el selector de día en un pedido no terminal', async () => {
    mockApiGet.mockResolvedValue({
      data: makeOrder({ status: 'pending_validation' }),
    })

    const { getByText } = renderWithProviders(<SuperOrderDetailScreen />)

    await waitFor(() => {
      expect(getByText('Día de entrega')).toBeTruthy()
    })
    expect(getByText('Hoy')).toBeTruthy()
    expect(getByText('Mañana')).toBeTruthy()
  })

  it('oculta el selector de día en pedidos delivered', async () => {
    mockApiGet.mockResolvedValue({
      data: makeOrder({
        status: 'delivered',
        tax: '4.00',
        totalAmount: '54.00',
        paidAt: '2026-01-02T00:00:00Z',
      }),
    })

    const { queryByText, getByText } = renderWithProviders(<SuperOrderDetailScreen />)

    await waitFor(() => {
      expect(getByText('Lista de compra')).toBeTruthy()
    })
    expect(queryByText('Día de entrega')).toBeNull()
  })

  it('oculta el selector de día en pedidos cancelled', async () => {
    mockApiGet.mockResolvedValue({ data: makeOrder({ status: 'cancelled' }) })

    const { queryByText, getByText } = renderWithProviders(<SuperOrderDetailScreen />)

    await waitFor(() => {
      expect(getByText('Lista de compra')).toBeTruthy()
    })
    expect(queryByText('Día de entrega')).toBeNull()
  })

  it('guarda el día tocado vía useSetDeliveryDate y muestra "Guardado"', async () => {
    const mutate = jest.fn(
      (
        _vars: unknown,
        opts?: { onSuccess?: () => void },
      ) => {
        opts?.onSuccess?.()
      },
    )
    mockUseSetDeliveryDate.mockReturnValue({
      mutate,
      isPending: false,
    } as unknown as ReturnType<typeof useSetDeliveryDate>)
    mockApiGet.mockResolvedValue({
      data: makeOrder({ status: 'pending_validation' }),
    })

    const { getByText, findByText } = renderWithProviders(<SuperOrderDetailScreen />)

    await waitFor(() => {
      expect(getByText('Mañana')).toBeTruthy()
    })
    fireEvent.press(getByText('Mañana'))

    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'order-1',
        scheduledDeliveryDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      }),
      expect.anything(),
    )
    expect(await findByText('Guardado')).toBeTruthy()
  })
})

describe('Recargo por distancia (admin breakdown)', () => {
  it('muestra la fila "Recargo por distancia" cuando es > 0', async () => {
    mockApiGet.mockResolvedValue({
      data: makeOrder({
        status: 'quoted',
        deliverySurcharge: '3.00',
        tax: '4.00',
        totalAmount: '57.00',
      }),
    })

    const { findByText } = renderWithProviders(<SuperOrderDetailScreen />)

    expect(await findByText('Recargo por distancia')).toBeTruthy()
  })

  it('no muestra la fila cuando el recargo es 0 o no viene', async () => {
    mockApiGet.mockResolvedValue({ data: makeOrder({ status: 'pending_quote' }) })

    const { queryByText, findByText } = renderWithProviders(<SuperOrderDetailScreen />)

    await findByText('$5')
    expect(queryByText('Recargo por distancia')).toBeNull()
  })
})
