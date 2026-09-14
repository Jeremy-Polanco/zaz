/**
 * OrderDetailPage — customer order page.
 *
 * No route test existed for this page before scheduledDeliveryDate/
 * deliverySurcharge. `createFileRoute` is stubbed to hand back a fixed
 * `orderId` from `Route.useParams()` (the page reads it directly from the
 * module-scope `Route`, not a prop) — the real router machinery isn't
 * exercised, only the component's own rendering logic against a mocked
 * `api.get`. This is the "heavy mocking" tradeoff called out in the task:
 * kept minimal, covering only the two new behaviours (scheduled-delivery
 * banner, surcharge row), not the whole page's status matrix.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithRouter } from '../test/test-utils'
import type { Order } from '../lib/types'

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

vi.mock('../lib/queries', () => ({
  useAuthorizeOrder: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useConfirmCashOrder: vi.fn(() => ({
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
  })),
  useConfirmNonStripeOrder: vi.fn(() => ({
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
  })),
}))

import { api } from '../lib/api'
import { OrderDetailPage } from './orders.$orderId.index'

const mockGet = vi.mocked(api.get)

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'order-001',
    customerId: 'cust-1',
    status: 'confirmed_by_colmado',
    deliveryAddress: null,
    subtotal: '50.00',
    pointsRedeemed: '0.00',
    shipping: '5.00',
    tax: '4.87',
    taxRate: '0.08887',
    totalAmount: '59.87',
    paymentMethod: 'cash',
    items: [],
    createdAt: '2026-05-01T10:00:00.000Z',
    ...overrides,
  } as Order
}

/** The page fetches via useQuery — anchor on the always-present "Resumen" heading. */
async function renderOrderPage() {
  renderWithRouter(OrderDetailPage)
  await screen.findByText('Resumen')
}

describe('OrderDetailPage — entrega programada', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows a prominent "Entrega programada" block with the formatted day', async () => {
    mockGet.mockResolvedValue({
      data: makeOrder({ scheduledDeliveryDate: '2026-09-20' }),
    })
    await renderOrderPage()

    expect(screen.getByText('Entrega programada')).toBeInTheDocument()
    expect(screen.getByText(/domingo 20 de septiembre/i)).toBeInTheDocument()
  })

  it('does not show the block when no day is scheduled yet', async () => {
    mockGet.mockResolvedValue({
      data: makeOrder({ scheduledDeliveryDate: null }),
    })
    await renderOrderPage()

    expect(screen.queryByText('Entrega programada')).not.toBeInTheDocument()
  })
})

describe('OrderDetailPage — recargo por distancia', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows the "Recargo por distancia" row when deliverySurcharge > 0', async () => {
    mockGet.mockResolvedValue({
      data: makeOrder({ deliverySurcharge: '3.00' }),
    })
    await renderOrderPage()

    expect(screen.getByText('Recargo por distancia')).toBeInTheDocument()
    expect(screen.getByText('$3.00')).toBeInTheDocument()
  })

  it('hides the row when deliverySurcharge is "0.00"', async () => {
    mockGet.mockResolvedValue({
      data: makeOrder({ deliverySurcharge: '0.00' }),
    })
    await renderOrderPage()

    expect(screen.queryByText('Recargo por distancia')).not.toBeInTheDocument()
  })

  it('hides the row when deliverySurcharge is absent (older orders)', async () => {
    mockGet.mockResolvedValue({ data: makeOrder() })
    await renderOrderPage()

    expect(screen.queryByText('Recargo por distancia')).not.toBeInTheDocument()
  })
})
