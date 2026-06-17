import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../test/test-utils'
import { OrderAddressModal } from './OrderAddressModal'
import type { GeoAddress, Order } from '../lib/types'

function makeOrder(addr: GeoAddress | null, overrides: Partial<Order> = {}): Order {
  return {
    id: 'order-001',
    customerId: 'cust-001',
    customer: { fullName: 'Juan García' },
    deliveryAddress: addr,
    ...overrides,
  } as Order
}

const fullAddress: GeoAddress = {
  text: 'Calle Duarte 100',
  lat: 18.47,
  lng: -69.9,
  houseNumber: '24',
  building: 'Edif. 4',
  unit: 'Apto 3B',
  reference: 'frente al colmado',
}

describe('OrderAddressModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the customer name and every structured detail', () => {
    renderWithProviders(
      <OrderAddressModal order={makeOrder(fullAddress)} onClose={vi.fn()} />,
    )

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Juan García')).toBeInTheDocument()
    expect(within(dialog).getByText('Calle Duarte 100')).toBeInTheDocument()
    expect(within(dialog).getByText('24')).toBeInTheDocument()
    expect(within(dialog).getByText('Edif. 4')).toBeInTheDocument()
    expect(within(dialog).getByText('Apto 3B')).toBeInTheDocument()
    expect(within(dialog).getByText('frente al colmado')).toBeInTheDocument()
  })

  it('shows a Maps link only when coordinates exist', () => {
    const { rerender } = renderWithProviders(
      <OrderAddressModal order={makeOrder(fullAddress)} onClose={vi.fn()} />,
    )
    const link = screen.getByRole('link', { name: /ver en maps/i })
    expect(link).toHaveAttribute(
      'href',
      'https://www.google.com/maps/search/?api=1&query=18.47,-69.9',
    )

    rerender(
      <OrderAddressModal
        order={makeOrder({ text: 'Calle Duarte 100' })}
        onClose={vi.fn()}
      />,
    )
    expect(screen.queryByRole('link', { name: /ver en maps/i })).not.toBeInTheDocument()
  })

  it('shows the empty-state copy when the order has no address', () => {
    renderWithProviders(
      <OrderAddressModal order={makeOrder(null)} onClose={vi.fn()} />,
    )
    expect(screen.getByText(/sin ubicación aún/i)).toBeInTheDocument()
  })

  it('calls onClose from the Cerrar button and Escape', async () => {
    const onClose = vi.fn()
    renderWithProviders(
      <OrderAddressModal order={makeOrder(fullAddress)} onClose={onClose} />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Cerrar' }))
    expect(onClose).toHaveBeenCalledTimes(1)

    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('renders the Editar button only when onEdit is provided and fires it', async () => {
    const onEdit = vi.fn()
    const { rerender } = renderWithProviders(
      <OrderAddressModal order={makeOrder(fullAddress)} onClose={vi.fn()} />,
    )
    expect(
      screen.queryByRole('button', { name: /editar ubicación/i }),
    ).not.toBeInTheDocument()

    rerender(
      <OrderAddressModal
        order={makeOrder(fullAddress)}
        onClose={vi.fn()}
        onEdit={onEdit}
      />,
    )
    await userEvent.click(
      screen.getByRole('button', { name: /editar ubicación/i }),
    )
    expect(onEdit).toHaveBeenCalledTimes(1)
  })
})
