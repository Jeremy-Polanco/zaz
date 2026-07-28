import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithRouter } from '../test/test-utils'
import type { CreditMovement, MyCreditResponse } from '../lib/types'

// ── Module mocks ───────────────────────────────────────────────────────────────
// `createFileRoute` runs at import time and needs a generated route tree, so it
// is stubbed out. Everything else from the router stays real — CreditPage
// renders a <Link> and `renderWithRouter` mounts a real memory router around it.
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const original = await importOriginal<typeof import('@tanstack/react-router')>()
  return {
    ...original,
    createFileRoute: () => () => ({}),
    redirect: vi.fn(),
  }
})
vi.mock('../lib/queries', () => ({ useMyCredit: vi.fn() }))
vi.mock('../lib/api', () => ({ api: { get: vi.fn() }, TOKEN_KEY: 'dashgo.token' }))

import { useMyCredit } from '../lib/queries'
import { CreditPage } from './credit'

const mockUseMyCredit = vi.mocked(useMyCredit)

// ── Fixtures ───────────────────────────────────────────────────────────────────

function makeMovement(overrides: Partial<CreditMovement> = {}): CreditMovement {
  return {
    id: 'mv-1',
    creditAccountId: 'acc-1',
    type: 'charge',
    amountCents: 2500,
    orderId: null,
    performedByUserId: null,
    note: null,
    createdAt: '2026-05-01T12:00:00.000Z',
    ...overrides,
  }
}

function setCredit(
  overrides: Partial<MyCreditResponse & { isPending?: boolean }> = {},
) {
  const { isPending = false, ...dataOverrides } = overrides
  const defaults: MyCreditResponse = {
    balanceCents: 5000,
    creditLimitCents: 10000,
    dueDate: '2026-06-01T00:00:00.000Z',
    status: 'active',
    amountOwedCents: 0,
    locked: false,
    movements: [],
  }
  mockUseMyCredit.mockReturnValue({
    data: isPending ? undefined : { ...defaults, ...dataOverrides },
    isPending,
    isError: false,
    error: null,
  } as unknown as ReturnType<typeof useMyCredit>)
}

/**
 * RouterProvider mounts asynchronously, so every render must wait for the route
 * to paint before asserting. "Mi cuenta" is the section eyebrow — present in
 * every non-loading state.
 */
async function renderCredit() {
  renderWithRouter(CreditPage)
  await screen.findByText('Mi cuenta')
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('CreditPage — account states', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // The loading branch returns early, before the section heading — so it can't
  // use renderCredit(), which anchors on "Mi cuenta".
  it('shows the loading indicator while the query is pending', async () => {
    setCredit({ isPending: true })
    renderWithRouter(CreditPage)

    expect(await screen.findByText(/Cargando crédito/i)).toBeInTheDocument()
    expect(screen.queryByText('Mi cuenta')).not.toBeInTheDocument()
  })

  it('tells a user without an account to contact the admin', async () => {
    setCredit({ status: 'none', balanceCents: null, creditLimitCents: null })
    await renderCredit()

    expect(screen.getByText('Sin cuenta de crédito')).toBeInTheDocument()
    expect(
      screen.getByText(/No tienes una cuenta de crédito activa/i),
    ).toBeInTheDocument()
  })

  it('treats a null balance as "no account" even when the status says active', async () => {
    setCredit({ status: 'active', balanceCents: null, creditLimitCents: null })
    await renderCredit()

    expect(screen.getByText('Sin cuenta de crédito')).toBeInTheDocument()
  })

  it('renders balance and limit for an account holder', async () => {
    setCredit({ balanceCents: 5000, creditLimitCents: 10000 })
    await renderCredit()

    expect(screen.getByText('$50.00')).toBeInTheDocument()
    expect(screen.getByText('$100.00')).toBeInTheDocument()
  })

  it.each([
    ['overdue', 'Vencido'],
    ['active', 'Al día'],
    ['none', 'Sin deuda'],
  ] as const)('shows the %s badge as "%s"', async (status, label) => {
    setCredit({ status })
    await renderCredit()

    expect(screen.getByText(label)).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// The amount-owed banner is the money path: it carries the only route to the
// payment screen and the "your account is blocked" warning. It was previously
// untested — the old fixture pinned amountOwedCents to 0 forever.
// ---------------------------------------------------------------------------

describe('CreditPage — amount owed banner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('offers the payment link with the total owed when money is due', async () => {
    setCredit({ amountOwedCents: 3500, locked: false })
    await renderCredit()

    expect(screen.getByText('Tienes saldo pendiente.')).toBeInTheDocument()
    expect(screen.getByText('$35.00')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /Pagar ahora/i }),
    ).toHaveAttribute('href', '/credit/pay')
  })

  it('warns that the account is blocked when the credit is locked', async () => {
    setCredit({ amountOwedCents: 3500, locked: true })
    await renderCredit()

    expect(
      screen.getByText('Tu cuenta está bloqueada por crédito vencido.'),
    ).toBeInTheDocument()
  })

  it('hides the banner entirely when nothing is owed', async () => {
    setCredit({ amountOwedCents: 0 })
    await renderCredit()

    expect(screen.queryByText(/saldo pendiente/i)).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: /Pagar ahora/i }),
    ).not.toBeInTheDocument()
  })
})

describe('CreditPage — movements', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the empty state when there are no movements', async () => {
    setCredit({ movements: [] })
    await renderCredit()

    expect(screen.getByText('Sin movimientos todavía')).toBeInTheDocument()
    expect(screen.getByText('0 movimientos')).toBeInTheDocument()
  })

  it('pluralizes the movement count', async () => {
    setCredit({ movements: [makeMovement()] })
    await renderCredit()

    expect(screen.getByText('1 movimiento')).toBeInTheDocument()
  })

  it('labels each movement type in Spanish', async () => {
    setCredit({
      movements: [
        makeMovement({ id: 'mv-1', type: 'grant' }),
        makeMovement({ id: 'mv-2', type: 'payment' }),
        makeMovement({ id: 'mv-3', type: 'reversal' }),
      ],
    })
    await renderCredit()

    expect(screen.getByText('Crédito otorgado')).toBeInTheDocument()
    expect(screen.getByText('Pago recibido')).toBeInTheDocument()
    expect(screen.getByText('Reversión')).toBeInTheDocument()
  })

  // A charge that reads "+$25.00" would tell the customer their debt shrank
  // when it grew. The sign is the whole point of the row.
  it('signs a charge as negative and a payment as positive', async () => {
    setCredit({
      movements: [
        makeMovement({ id: 'mv-1', type: 'charge', amountCents: 2500 }),
        makeMovement({ id: 'mv-2', type: 'payment', amountCents: 1000 }),
      ],
    })
    await renderCredit()

    expect(screen.getByText('−$25.00')).toBeInTheDocument()
    expect(screen.getByText('+$10.00')).toBeInTheDocument()
  })

  it('signs a plain adjustment as ambiguous (±) since it can go either way', async () => {
    setCredit({
      movements: [makeMovement({ type: 'adjustment', amountCents: 500 })],
    })
    await renderCredit()

    expect(screen.getByText('±$5.00')).toBeInTheDocument()
  })

  it('renders the note when a movement carries one', async () => {
    setCredit({
      movements: [makeMovement({ note: 'Ajuste por pedido cancelado' })],
    })
    await renderCredit()

    expect(
      screen.getByText('Ajuste por pedido cancelado'),
    ).toBeInTheDocument()
  })
})
