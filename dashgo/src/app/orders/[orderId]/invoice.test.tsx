/**
 * Invoice screen — "Recargo por distancia" row.
 *
 * Contract: GET /orders/:id/invoice now returns `deliverySurcharge`, a
 * decimal string already included in `total` (same shape as `shipping`).
 * The breakdown must show a row (i18n key `summary.surcharge`, reused from
 * the order detail screen — same 'orders' namespace, no duplicate key) right
 * after "Envío" only when the surcharge is a positive amount.
 *
 * Same mocking technique as index.test.tsx: `expo-router` is re-mocked
 * locally to hand back a fixed orderId, and `../../../lib/api` is mocked so
 * the real `useInvoice`/`useQuery` machinery runs against a controlled
 * response.
 */
import React from 'react'
import { waitFor } from '@testing-library/react-native'
import { renderWithProviders } from '../../../test/test-utils'
import type { Invoice } from '../../../lib/types'

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

import InvoiceScreen from './invoice'

function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: 'inv-1',
    invoiceNumber: 'F-0001',
    orderId: 'order-1',
    subtotal: '45.00',
    pointsRedeemed: '0',
    shipping: '5.00',
    tax: '4.00',
    taxRate: '0.08887',
    total: '54.00',
    createdAt: '2026-01-01T00:00:00Z',
    customer: {
      id: 'user-1',
      fullName: 'Jane Doe',
      phone: null,
    },
    order: {
      id: 'order-1',
      status: 'delivered',
      paymentMethod: 'cash',
      deliveryAddress: null,
      createdAt: '2026-01-01T00:00:00Z',
    },
    items: [],
    ...overrides,
  } as Invoice
}

afterEach(() => {
  jest.clearAllMocks()
})

describe('Invoice screen — recargo por distancia', () => {
  it('shows the "Recargo por distancia" row when deliverySurcharge is > 0', async () => {
    mockApiGet.mockResolvedValue({ data: makeInvoice({ deliverySurcharge: '3.00' }) })

    const { getByText } = renderWithProviders(<InvoiceScreen />)

    await waitFor(() => {
      expect(getByText('Recargo por distancia')).toBeTruthy()
    })
    // Whole-dollar amounts render without cents (formatMoney convention).
    expect(getByText('$3')).toBeTruthy()
  })

  it('hides the row when deliverySurcharge is "0.00"', async () => {
    mockApiGet.mockResolvedValue({ data: makeInvoice({ deliverySurcharge: '0.00' }) })

    const { queryByText, getByText } = renderWithProviders(<InvoiceScreen />)

    await waitFor(() => {
      expect(getByText('Detalle')).toBeTruthy()
    })
    expect(queryByText('Recargo por distancia')).toBeNull()
  })

  it('hides the row when deliverySurcharge is absent', async () => {
    mockApiGet.mockResolvedValue({ data: makeInvoice({ deliverySurcharge: undefined }) })

    const { queryByText, getByText } = renderWithProviders(<InvoiceScreen />)

    await waitFor(() => {
      expect(getByText('Detalle')).toBeTruthy()
    })
    expect(queryByText('Recargo por distancia')).toBeNull()
  })
})
