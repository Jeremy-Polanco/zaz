/**
 * InvoicePage — "Recargo por distancia" row.
 *
 * Contract: GET /orders/:id/invoice now returns `deliverySurcharge`, a
 * decimal string already included in `total` (same shape as `shipping`).
 * The breakdown must show a "Recargo por distancia" row right after "Envío"
 * only when the surcharge is a positive amount — most invoices have "0.00"
 * or omit the field entirely, and both must stay hidden.
 *
 * Same mocking technique as orders.$orderId.index.test.tsx: `createFileRoute`
 * is stubbed to hand back a fixed `orderId` from `Route.useParams()`, and
 * `api.get` is mocked so the real `useInvoice`/`useQuery` machinery runs
 * against a controlled response.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithRouter } from '../test/test-utils'
import type { Invoice } from '../lib/types'

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const original = await importOriginal<typeof import('@tanstack/react-router')>()
  return {
    ...original,
    createFileRoute: () => (opts: Record<string, unknown>) => ({
      ...opts,
      useParams: () => ({ orderId: 'order-001' }),
    }),
  }
})

vi.mock('../lib/api', () => ({
  api: { get: vi.fn() },
  TOKEN_KEY: 'dashgo.token',
}))

import { api } from '../lib/api'
import { InvoicePage } from './orders.$orderId.invoice'

const mockGet = vi.mocked(api.get)

function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: 'inv-001',
    invoiceNumber: 'F-0001',
    subtotal: '50.00',
    pointsRedeemed: '0.00',
    shipping: '5.00',
    tax: '4.87',
    taxRate: '0.08887',
    total: '59.87',
    createdAt: '2026-05-01T10:00:00.000Z',
    order: {
      id: 'order-001',
      status: 'delivered',
      deliveryAddress: null,
      paymentMethod: 'cash',
      createdAt: '2026-05-01T10:00:00.000Z',
    },
    customer: {
      id: 'cust-1',
      fullName: 'Jane Doe',
      phone: null,
    },
    items: [],
    ...overrides,
  } as Invoice
}

async function renderInvoicePage() {
  renderWithRouter(InvoicePage)
  await screen.findByText('Detalle')
}

describe('InvoicePage — recargo por distancia', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows the "Recargo por distancia" row when deliverySurcharge is > 0', async () => {
    mockGet.mockResolvedValue({ data: makeInvoice({ deliverySurcharge: '3.00' }) })
    await renderInvoicePage()

    expect(screen.getByText('Recargo por distancia')).toBeInTheDocument()
    expect(screen.getByText('$3.00')).toBeInTheDocument()
  })

  it('hides the row when deliverySurcharge is "0.00"', async () => {
    mockGet.mockResolvedValue({ data: makeInvoice({ deliverySurcharge: '0.00' }) })
    await renderInvoicePage()

    expect(screen.queryByText('Recargo por distancia')).not.toBeInTheDocument()
  })

  it('hides the row when deliverySurcharge is absent', async () => {
    mockGet.mockResolvedValue({ data: makeInvoice({ deliverySurcharge: undefined }) })
    await renderInvoicePage()

    expect(screen.queryByText('Recargo por distancia')).not.toBeInTheDocument()
  })
})
