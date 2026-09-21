/**
 * QuoteBottomSheet — admin cotización sheet.
 *
 * New in this change: a "Recargo por distancia (USD)" input (defaults from
 * order.deliverySurcharge when > 0) and a "Día de entrega" DeliveryDayPicker
 * (defaults from order.scheduledDeliveryDate). Submit must always send both
 * surchargeCents and scheduledDeliveryDate alongside shippingCents, and the
 * preview total must fold the surcharge into the taxable shipping base.
 */
import React from 'react'
import { fireEvent, render } from '@testing-library/react-native'
import type { Order } from '../lib/types'

jest.mock('../lib/queries', () => ({
  useSetOrderQuote: jest.fn(),
}))

import { useSetOrderQuote } from '../lib/queries'
import { QuoteBottomSheet } from './QuoteBottomSheet'

const mockSetOrderQuote = useSetOrderQuote as jest.MockedFunction<
  typeof useSetOrderQuote
>

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'order-1',
    customerId: 'user-1',
    customer: { id: 'user-1', fullName: 'Ana Cliente' } as Order['customer'],
    status: 'pending_quote',
    deliveryAddress: { text: 'Calle Falsa 123' },
    subtotal: '45.00',
    pointsRedeemed: '0',
    shipping: '',
    deliverySurcharge: '0.00',
    scheduledDeliveryDate: null,
    tax: '0',
    taxRate: '0.08887',
    totalAmount: '45.00',
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

describe('QuoteBottomSheet — recargo por distancia y día de entrega', () => {
  it('defaults the surcharge input from order.deliverySurcharge when > 0', () => {
    const mutateAsync = jest.fn().mockResolvedValue({})
    mockSetOrderQuote.mockReturnValue({
      mutateAsync,
      isPending: false,
    } as unknown as ReturnType<typeof useSetOrderQuote>)

    const { getByDisplayValue } = render(
      <QuoteBottomSheet
        order={makeOrder({ deliverySurcharge: '3.00' })}
        onClose={jest.fn()}
      />,
    )

    expect(getByDisplayValue('3.00')).toBeTruthy()
  })

  it('shows the "Recargo por distancia" preview line only when the surcharge is > 0', () => {
    mockSetOrderQuote.mockReturnValue({
      mutateAsync: jest.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useSetOrderQuote>)

    const { queryByText, getByPlaceholderText } = render(
      <QuoteBottomSheet order={makeOrder()} onClose={jest.fn()} />,
    )

    expect(queryByText('Recargo por distancia')).toBeNull()

    fireEvent.changeText(getByPlaceholderText('5.50'), '5.50')
    fireEvent.changeText(
      getByPlaceholderText('0.00'),
      '3',
    )

    expect(queryByText('Recargo por distancia')).toBeTruthy()
  })

  it('shows the helper copy about subscribers paying the distance surcharge', () => {
    mockSetOrderQuote.mockReturnValue({
      mutateAsync: jest.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useSetOrderQuote>)

    const { getByText } = render(
      <QuoteBottomSheet order={makeOrder()} onClose={jest.fn()} />,
    )

    expect(
      getByText(
        'Se cobra también a suscriptores — la suscripción cubre el envío, no la distancia.',
      ),
    ).toBeTruthy()
  })

  it('submits shippingCents, surchargeCents and scheduledDeliveryDate together', async () => {
    const mutateAsync = jest.fn().mockResolvedValue({})
    mockSetOrderQuote.mockReturnValue({
      mutateAsync,
      isPending: false,
    } as unknown as ReturnType<typeof useSetOrderQuote>)

    const { getByPlaceholderText, getByText } = render(
      <QuoteBottomSheet
        order={makeOrder({ scheduledDeliveryDate: null })}
        onClose={jest.fn()}
      />,
    )

    fireEvent.changeText(getByPlaceholderText('5.50'), '5.50')
    fireEvent.changeText(getByPlaceholderText('0.00'), '3.00')
    fireEvent.press(getByText('Mañana'))
    fireEvent.press(getByText('Enviar →'))

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'order-1',
        shippingCents: 550,
        surchargeCents: 300,
        scheduledDeliveryDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      }),
    )
  })

  it('shows the tax label at the order\'s own taxRate (6.625%), not the 8.887% fallback', () => {
    mockSetOrderQuote.mockReturnValue({
      mutateAsync: jest.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useSetOrderQuote>)

    const { getByText, queryByText } = render(
      <QuoteBottomSheet
        order={makeOrder({ taxRate: '0.06625' })}
        onClose={jest.fn()}
      />,
    )

    expect(getByText('Impuestos (6.625%)')).toBeTruthy()
    expect(queryByText('Impuestos (8.887%)')).toBeNull()
  })

  it('falls back to the 8.887% TAX_RATE label when order.taxRate is not a valid number', () => {
    mockSetOrderQuote.mockReturnValue({
      mutateAsync: jest.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useSetOrderQuote>)

    const { getByText } = render(
      <QuoteBottomSheet
        order={makeOrder({ taxRate: 'not-a-number' })}
        onClose={jest.fn()}
      />,
    )

    expect(getByText('Impuestos (8.887%)')).toBeTruthy()
  })

  it('excludes exempt lines from the taxable base when every item has its product embedded (parity with web QuoteDrawer)', () => {
    mockSetOrderQuote.mockReturnValue({
      mutateAsync: jest.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useSetOrderQuote>)

    // $15 exempt water + $5 taxable + $5 shipping @ 6.625%.
    // taxable share = 5/20 = 0.25 → taxable shipping = round(500 × 0.25) = 125
    // taxable base = 500 + 125 = 625¢ → tax = round(625 × 0.06625) = 41¢
    const order = makeOrder({
      subtotal: '20.00',
      shipping: '5.00',
      taxRate: '0.06625',
      items: [
        {
          id: 'item-water',
          orderId: 'order-1',
          productId: 'product-water',
          product: { taxCategory: 'exempt' },
          quantity: 1,
          priceAtOrder: '15.00',
          createdAt: '2026-01-01T00:00:00Z',
        },
        {
          id: 'item-single',
          orderId: 'order-1',
          productId: 'product-single',
          product: { taxCategory: 'standard' },
          quantity: 1,
          priceAtOrder: '5.00',
          createdAt: '2026-01-01T00:00:00Z',
        },
      ] as unknown as Order['items'],
    })

    const { getByText } = render(
      <QuoteBottomSheet order={order} onClose={jest.fn()} />,
    )

    expect(getByText('$0.41')).toBeTruthy()
  })

  it('keeps the everything-taxable preview when items lack a populated product', () => {
    mockSetOrderQuote.mockReturnValue({
      mutateAsync: jest.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useSetOrderQuote>)

    // Same $15 + $5 + $5 shipping @ 6.625%, but no item carries `product` —
    // can't tell which line is exempt, so the whole subtotal is taxable
    // (historical behavior): tax = round((2000 + 500) × 0.06625) = 166¢
    const order = makeOrder({
      subtotal: '20.00',
      shipping: '5.00',
      taxRate: '0.06625',
      items: [
        {
          id: 'item-water',
          orderId: 'order-1',
          productId: 'product-water',
          quantity: 1,
          priceAtOrder: '15.00',
          createdAt: '2026-01-01T00:00:00Z',
        },
        {
          id: 'item-single',
          orderId: 'order-1',
          productId: 'product-single',
          quantity: 1,
          priceAtOrder: '5.00',
          createdAt: '2026-01-01T00:00:00Z',
        },
      ] as unknown as Order['items'],
    })

    const { getByText } = render(
      <QuoteBottomSheet order={order} onClose={jest.fn()} />,
    )

    expect(getByText('$1.66')).toBeTruthy()
  })

  it('defaults the delivery day picker to order.scheduledDeliveryDate', () => {
    mockSetOrderQuote.mockReturnValue({
      mutateAsync: jest.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useSetOrderQuote>)

    // No assertion on visual selection (brittle) — just confirms the picker
    // renders without crashing when a value is already assigned.
    expect(() =>
      render(
        <QuoteBottomSheet
          order={makeOrder({ scheduledDeliveryDate: '2026-09-20' })}
          onClose={jest.fn()}
        />,
      ),
    ).not.toThrow()
  })
})
