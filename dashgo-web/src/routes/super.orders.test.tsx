import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { renderWithProviders } from '../test/test-utils'
import { formatAddressLine } from '../lib/address'
import type { GeoAddress, Order } from '../lib/types'

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeAddress(overrides: Partial<GeoAddress> = {}): GeoAddress {
  return {
    text: 'Calle 1',
    lat: 18.47,
    lng: -69.9,
    houseNumber: '24',
    building: 'Edif. 4',
    unit: 'Apto 3B',
    ...overrides,
  }
}

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'order-001',
    customerId: 'cust-001',
    deliveryAddress: null,
    ...overrides,
  } as Order
}

// ── Test driver ──────────────────────────────────────────────────────────────
// Mirrors the "Dirección" cell logic of super.orders.tsx without going through
// TanStack Router's beforeLoad, following the super.rentals.test.tsx pattern.
// The combined address line is clickable (opens the details modal); the button
// stays available whether or not an address exists (opens the edit drawer).

function AddressCellDriver({ orders }: { orders: Order[] }) {
  const [locatingOrder, setLocatingOrder] = useState<Order | null>(null)
  const [detailOrder, setDetailOrder] = useState<Order | null>(null)
  return (
    <div>
      {orders.map((order) => {
        const addr = order.deliveryAddress
        return (
          <div key={order.id} data-testid={`addr-cell-${order.id}`}>
            <div className="flex flex-col items-start gap-1">
              {addr && (
                <button
                  type="button"
                  onClick={() => setDetailOrder(order)}
                  data-testid={`addr-line-${order.id}`}
                >
                  {formatAddressLine(addr)}
                </button>
              )}
              <button
                type="button"
                onClick={() => setLocatingOrder(order)}
                data-testid={`addr-btn-${order.id}`}
              >
                {addr ? '📍 Editar ubicación' : '📍 Fijar ubicación'}
              </button>
            </div>
          </div>
        )
      })}
      {detailOrder && (
        <div role="dialog" data-testid="address-modal">
          Detalles · {detailOrder.id}
        </div>
      )}
      {locatingOrder && (
        <div role="dialog" data-testid="location-drawer">
          Fijar ubicación · {locatingOrder.id}
        </div>
      )}
    </div>
  )
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('super.orders — Dirección cell', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('order WITHOUT an address shows the "📍 Fijar ubicación" button and no address line', () => {
    const order = makeOrder({ deliveryAddress: null })
    renderWithProviders(<AddressCellDriver orders={[order]} />)

    const cell = screen.getByTestId(`addr-cell-${order.id}`)
    expect(within(cell).getByTestId(`addr-btn-${order.id}`)).toHaveTextContent(
      'Fijar ubicación',
    )
    expect(
      within(cell).queryByTestId(`addr-line-${order.id}`),
    ).not.toBeInTheDocument()
  })

  it('order WITH an address shows the combined line (address · building · apto) and an "Editar" button', () => {
    const order = makeOrder({ deliveryAddress: makeAddress() })
    renderWithProviders(<AddressCellDriver orders={[order]} />)

    const cell = screen.getByTestId(`addr-cell-${order.id}`)
    expect(within(cell).getByTestId(`addr-line-${order.id}`)).toHaveTextContent(
      'Calle 1 · Edif. 4 · Apto 3B',
    )
    expect(within(cell).getByTestId(`addr-btn-${order.id}`)).toHaveTextContent(
      'Editar ubicación',
    )
  })

  it('clicking the address line opens the details modal', async () => {
    const order = makeOrder({ deliveryAddress: makeAddress() })
    renderWithProviders(<AddressCellDriver orders={[order]} />)

    expect(screen.queryByTestId('address-modal')).not.toBeInTheDocument()
    await userEvent.click(screen.getByTestId(`addr-line-${order.id}`))
    expect(screen.getByTestId('address-modal')).toBeInTheDocument()
    expect(screen.queryByTestId('location-drawer')).not.toBeInTheDocument()
  })

  it('clicking the button opens the location drawer even when an address exists', async () => {
    const order = makeOrder({ deliveryAddress: makeAddress() })
    renderWithProviders(<AddressCellDriver orders={[order]} />)

    expect(screen.queryByTestId('location-drawer')).not.toBeInTheDocument()
    await userEvent.click(screen.getByTestId(`addr-btn-${order.id}`))
    expect(screen.getByTestId('location-drawer')).toBeInTheDocument()
  })
})
