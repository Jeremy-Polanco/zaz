import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithRouter } from '../test/test-utils'
import type { GeoAddress, Order, OrderStatus } from '../lib/types'

// ── Module mocks ───────────────────────────────────────────────────────────────
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const original = await importOriginal<typeof import('@tanstack/react-router')>()
  return {
    ...original,
    createFileRoute: () => () => ({}),
    redirect: vi.fn(),
    isRedirect: vi.fn(() => false),
  }
})

vi.mock('../lib/queries', () => ({
  useOrders: vi.fn(),
  useUpdateOrderStatus: vi.fn(),
  useSetDeliveryDate: vi.fn(),
}))
vi.mock('../lib/api', () => ({
  api: { get: vi.fn(), patch: vi.fn() },
  TOKEN_KEY: 'dashgo.token',
}))

// The three drawers/modals are collaborators with their own suites
// (OrderAddressModal.test.tsx, QuoteDrawer.test.tsx …). Stub them to a marker
// so this file can assert WHICH one the page opened without pulling their
// internals in. The page under test stays real — that's the difference between
// stubbing a collaborator and faking the thing you are testing.
vi.mock('../components/OrderLocationDrawer', () => ({
  OrderLocationDrawer: ({ order }: { order: Order }) => (
    <div role="dialog" aria-label={`Fijar ubicación ${order.id}`} />
  ),
}))
vi.mock('../components/OrderAddressModal', () => ({
  OrderAddressModal: ({ order }: { order: Order }) => (
    <div role="dialog" aria-label={`Detalles de dirección ${order.id}`} />
  ),
}))
vi.mock('../components/QuoteDrawer', () => ({
  QuoteDrawer: ({ order }: { order: Order }) => (
    <div role="dialog" aria-label={`Cotizar ${order.id}`} />
  ),
}))

import { useOrders, useUpdateOrderStatus, useSetDeliveryDate } from '../lib/queries'
import { SuperOrdersPage } from './super.orders'

const mockUseOrders = vi.mocked(useOrders)
const mockUseUpdateOrderStatus = vi.mocked(useUpdateOrderStatus)
const mockUseSetDeliveryDate = vi.mocked(useSetDeliveryDate)

// ── Fixtures ───────────────────────────────────────────────────────────────────

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

/** Orders embed the full AuthUser; tests only ever read the name. */
function makeCustomer(fullName: string): Order['customer'] {
  return { fullName } as unknown as Order['customer']
}

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'order-001',
    customerId: 'cust-00000001',
    customer: makeCustomer('Ana Cliente'),
    status: 'pending_quote' as OrderStatus,
    deliveryAddress: null,
    items: [],
    totalAmount: '100.00',
    createdAt: new Date().toISOString(),
    ...overrides,
  } as Order
}

function setup(
  opts: {
    orders?: Order[]
    isPending?: boolean
    mutate?: ReturnType<typeof vi.fn>
    setDeliveryDateMutateAsync?: ReturnType<typeof vi.fn>
  } = {},
) {
  mockUseOrders.mockReturnValue({
    data: opts.isPending ? undefined : (opts.orders ?? []),
    isPending: opts.isPending ?? false,
    isError: false,
    error: null,
  } as unknown as ReturnType<typeof useOrders>)

  mockUseUpdateOrderStatus.mockReturnValue({
    mutate: opts.mutate ?? vi.fn(),
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
    reset: vi.fn(),
  } as unknown as ReturnType<typeof useUpdateOrderStatus>)

  mockUseSetDeliveryDate.mockReturnValue({
    mutate: vi.fn(),
    mutateAsync: opts.setDeliveryDateMutateAsync ?? vi.fn().mockResolvedValue({}),
    isPending: false,
    reset: vi.fn(),
  } as unknown as ReturnType<typeof useSetDeliveryDate>)
}

/**
 * A delivered row links to its invoice, so the page needs a real router.
 * RouterProvider mounts asynchronously — anchor on the section eyebrow.
 */
async function renderOrders() {
  renderWithRouter(SuperOrdersPage)
  await screen.findByText('Panel · Reparto')
}

/** The row containing a given text, for scoped queries inside the table. */
function rowFor(text: string) {
  return screen.getByText(text).closest('tr')!
}

/**
 * The KPI card for a label. "Entregados hoy" is BOTH a metric label and a
 * filter button, so match the metric's <span class="eyebrow"> specifically.
 */
function metric(label: string) {
  return screen.getByText(label, { selector: 'span.eyebrow' }).parentElement!
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('SuperOrdersPage — Dirección cell', () => {
  beforeEach(() => vi.clearAllMocks())

  it('offers "Fijar ubicación" and no address line when the order has none', async () => {
    setup({ orders: [makeOrder({ deliveryAddress: null })] })
    await renderOrders()

    const row = rowFor('Ana Cliente')
    expect(within(row).getByText(/Fijar ubicación/)).toBeInTheDocument()
    expect(within(row).queryByText(/Editar ubicación/)).not.toBeInTheDocument()
  })

  it('shows the combined address line and switches the button to "Editar"', async () => {
    setup({ orders: [makeOrder({ deliveryAddress: makeAddress() })] })
    await renderOrders()

    const row = rowFor('Ana Cliente')
    expect(
      within(row).getByText('Calle 1 · Edif. 4 · Apto 3B'),
    ).toBeInTheDocument()
    expect(within(row).getByText(/Editar ubicación/)).toBeInTheDocument()
  })

  it('opens the read-only details modal from the address line', async () => {
    setup({ orders: [makeOrder({ deliveryAddress: makeAddress() })] })
    await renderOrders()

    await userEvent.click(screen.getByText('Calle 1 · Edif. 4 · Apto 3B'))

    expect(
      screen.getByRole('dialog', { name: 'Detalles de dirección order-001' }),
    ).toBeInTheDocument()
  })

  it('opens the location drawer from the button even when an address exists', async () => {
    setup({ orders: [makeOrder({ deliveryAddress: makeAddress() })] })
    await renderOrders()

    await userEvent.click(screen.getByText(/Editar ubicación/))

    expect(
      screen.getByRole('dialog', { name: 'Fijar ubicación order-001' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('dialog', { name: /Detalles/ }),
    ).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// The KPI strip and the list filter drive what the delivery operator sees
// first. Neither existed in the old address-cell driver.
// ---------------------------------------------------------------------------

describe('SuperOrdersPage — Distancia column', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders the distance in miles when the API computed it', async () => {
    setup({ orders: [makeOrder({ distanceMiles: 2.3 })] })
    await renderOrders()

    const row = rowFor('Ana Cliente')
    expect(within(row).getByText('2.3 mi')).toBeInTheDocument()
  })

  it('shows a muted dash when the API could not compute a distance', async () => {
    // "Ana Cliente" also has no items, so "Lista de compra" renders its own
    // "—" — scope to the distance cell specifically via its testid.
    setup({ orders: [makeOrder({ distanceMiles: null })] })
    await renderOrders()

    const row = rowFor('Ana Cliente')
    expect(within(row).getByTestId('distance-cell')).toHaveTextContent('—')
  })

  // The API already sorts active orders nearest-first from the driver's
  // active location — the table must render in that order, never re-sort.
  it('keeps the API order (nearest-first) instead of re-sorting', async () => {
    setup({
      orders: [
        makeOrder({
          id: 'near',
          status: 'in_delivery_route',
          customer: makeCustomer('Cliente Cercano'),
          distanceMiles: 1.2,
        }),
        makeOrder({
          id: 'far',
          status: 'in_delivery_route',
          customer: makeCustomer('Cliente Lejano'),
          distanceMiles: 8.5,
        }),
      ],
    })
    await renderOrders()

    const names = screen
      .getAllByText(/Cliente (Cercano|Lejano)/)
      .map((el) => el.textContent)
    expect(names).toEqual(['Cliente Cercano', 'Cliente Lejano'])
  })
})

describe('SuperOrdersPage — route metrics', () => {
  beforeEach(() => vi.clearAllMocks())

  it('counts each stage of the delivery pipeline', async () => {
    setup({
      orders: [
        makeOrder({ id: 'o1', status: 'pending_quote' }),
        makeOrder({ id: 'o2', status: 'pending_quote' }),
        makeOrder({ id: 'o3', status: 'pending_validation' }),
        makeOrder({ id: 'o4', status: 'confirmed_by_colmado' }),
        makeOrder({ id: 'o5', status: 'in_delivery_route' }),
        makeOrder({ id: 'o6', status: 'delivered' }),
      ],
    })
    await renderOrders()

    expect(within(metric('Por cotizar')).getByText('2')).toBeInTheDocument()
    expect(
      within(metric('Pendientes de confirmar')).getByText('1'),
    ).toBeInTheDocument()
    expect(within(metric('Listos para salir')).getByText('1')).toBeInTheDocument()
    expect(within(metric('En camino')).getByText('1')).toBeInTheDocument()
    expect(within(metric('Entregados hoy')).getByText('1')).toBeInTheDocument()
  })

  it('counts only TODAY for "Entregados hoy"', async () => {
    setup({
      orders: [
        makeOrder({
          id: 'old',
          status: 'delivered',
          createdAt: '2020-01-01T00:00:00.000Z',
        }),
      ],
    })
    await renderOrders()

    expect(
      within(metric('Entregados hoy')).getByText('0'),
    ).toBeInTheDocument()
  })
})

describe('SuperOrdersPage — list filter', () => {
  beforeEach(() => vi.clearAllMocks())

  it('defaults to the pending route and hides delivered orders', async () => {
    setup({
      orders: [
        makeOrder({ id: 'o1', status: 'in_delivery_route', customer: makeCustomer('En Ruta') }),
        makeOrder({ id: 'o2', status: 'delivered', customer: makeCustomer('Ya Entregado') }),
      ],
    })
    await renderOrders()

    expect(screen.getByText('En Ruta')).toBeInTheDocument()
    expect(screen.queryByText('Ya Entregado')).not.toBeInTheDocument()
  })

  it('switches to today\'s deliveries', async () => {
    setup({
      orders: [
        makeOrder({ id: 'o1', status: 'in_delivery_route', customer: makeCustomer('En Ruta') }),
        makeOrder({ id: 'o2', status: 'delivered', customer: makeCustomer('Ya Entregado') }),
      ],
    })
    await renderOrders()

    await userEvent.click(screen.getByRole('button', { name: 'Entregados hoy' }))

    expect(screen.getByText('Ya Entregado')).toBeInTheDocument()
    expect(screen.queryByText('En Ruta')).not.toBeInTheDocument()
  })

  // A cancelled order is dead weight on a delivery route — "Todos" still hides it.
  it('never shows cancelled orders, not even under "Todos"', async () => {
    setup({
      orders: [
        makeOrder({ id: 'o1', status: 'cancelled', customer: makeCustomer('Cancelado') }),
        makeOrder({ id: 'o2', status: 'delivered', customer: makeCustomer('Ya Entregado') }),
      ],
    })
    await renderOrders()

    await userEvent.click(screen.getByRole('button', { name: 'Todos' }))

    expect(screen.getByText('Ya Entregado')).toBeInTheDocument()
    expect(screen.queryByText('Cancelado')).not.toBeInTheDocument()
  })

  it('explains an empty list differently per filter', async () => {
    setup({ orders: [] })
    await renderOrders()

    expect(screen.getByText('No hay pedidos pendientes.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Entregados hoy' }))
    expect(screen.getByText('No se entregó ningún pedido hoy.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Todos' }))
    expect(screen.getByText('No hay pedidos.')).toBeInTheDocument()
  })
})

describe('SuperOrdersPage — loading', () => {
  beforeEach(() => vi.clearAllMocks())

  // The loading branch returns early, before the section heading — so it can't
  // use renderOrders(), which anchors on "Panel · Reparto".
  it('shows the loading state while orders are being fetched', async () => {
    setup({ isPending: true })
    renderWithRouter(SuperOrdersPage)

    expect(await screen.findByText('Cargando…')).toBeInTheDocument()
    expect(screen.queryByText('Panel · Reparto')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// scheduledDeliveryDate — the "Fecha" column surfaces it, the "Acciones"
// column is where staff assigns/clears it (DeliveryDayPicker).
// ---------------------------------------------------------------------------

describe('SuperOrdersPage — Fecha column, día de entrega', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows "Entrega: {día}" under the created date when a day is scheduled', async () => {
    setup({ orders: [makeOrder({ scheduledDeliveryDate: '2026-09-20' })] })
    await renderOrders()

    const row = rowFor('Ana Cliente')
    expect(
      within(row).getByText(/Entrega: domingo 20 de septiembre/),
    ).toBeInTheDocument()
  })

  it('shows nothing extra when no day is scheduled yet', async () => {
    setup({ orders: [makeOrder({ scheduledDeliveryDate: null })] })
    await renderOrders()

    const row = rowFor('Ana Cliente')
    expect(within(row).queryByText(/Entrega:/)).not.toBeInTheDocument()
  })
})

describe('SuperOrdersPage — Acciones column, asignar día de entrega', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows "📅 Asignar día" when the order has no scheduled day', async () => {
    setup({ orders: [makeOrder({ status: 'pending_validation' })] })
    await renderOrders()

    const row = rowFor('Ana Cliente')
    expect(
      within(row).getByRole('button', { name: '📅 Asignar día' }),
    ).toBeInTheDocument()
  })

  it('shows "📅 dd/mm" instead when a day is already scheduled', async () => {
    setup({
      orders: [
        makeOrder({
          status: 'pending_validation',
          scheduledDeliveryDate: '2026-09-20',
        }),
      ],
    })
    await renderOrders()

    const row = rowFor('Ana Cliente')
    expect(
      within(row).getByRole('button', { name: '📅 20/09' }),
    ).toBeInTheDocument()
  })

  it('opens an inline date input and "Quitar" is hidden until a day exists', async () => {
    setup({ orders: [makeOrder({ status: 'pending_validation' })] })
    await renderOrders()

    const row = rowFor('Ana Cliente')
    await userEvent.click(
      within(row).getByRole('button', { name: '📅 Asignar día' }),
    )

    expect(within(row).getByLabelText(/día de entrega/i)).toBeInTheDocument()
    expect(
      within(row).queryByRole('button', { name: 'Quitar' }),
    ).not.toBeInTheDocument()
  })

  it('calls useSetDeliveryDate with the chosen day when "Guardar" is clicked', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({})
    setup({
      orders: [makeOrder({ status: 'pending_validation' })],
      setDeliveryDateMutateAsync: mutateAsync,
    })
    await renderOrders()

    const row = rowFor('Ana Cliente')
    await userEvent.click(
      within(row).getByRole('button', { name: '📅 Asignar día' }),
    )
    fireEvent.change(within(row).getByLabelText(/día de entrega/i), {
      target: { value: '2026-09-25' },
    })
    await userEvent.click(within(row).getByRole('button', { name: 'Guardar' }))

    expect(mutateAsync).toHaveBeenCalledWith({
      id: 'order-001',
      scheduledDeliveryDate: '2026-09-25',
    })
  })

  it('"Quitar" sends scheduledDeliveryDate: null', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({})
    setup({
      orders: [
        makeOrder({
          status: 'pending_validation',
          scheduledDeliveryDate: '2026-09-20',
        }),
      ],
      setDeliveryDateMutateAsync: mutateAsync,
    })
    await renderOrders()

    const row = rowFor('Ana Cliente')
    await userEvent.click(within(row).getByRole('button', { name: '📅 20/09' }))
    await userEvent.click(within(row).getByRole('button', { name: 'Quitar' }))

    expect(mutateAsync).toHaveBeenCalledWith({
      id: 'order-001',
      scheduledDeliveryDate: null,
    })
  })

  it('hides the day-assignment control on delivered orders', async () => {
    setup({
      orders: [makeOrder({ status: 'delivered', customer: makeCustomer('Entregado') })],
    })
    await renderOrders()
    await userEvent.click(screen.getByRole('button', { name: 'Todos' }))

    const row = rowFor('Entregado')
    expect(
      within(row).queryByRole('button', { name: /Asignar día|^📅/ }),
    ).not.toBeInTheDocument()
  })
})
