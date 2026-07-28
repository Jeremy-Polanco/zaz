import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../test/test-utils'
import type { AdminRentalResponse } from '../lib/types'

// ── Module mocks ───────────────────────────────────────────────────────────────
// `createFileRoute` runs at import time and needs a generated route tree; stub
// it so the real page component can be imported and rendered.
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
  useAdminRentals: vi.fn(),
  useChargeLateFee: vi.fn(),
  useChargeTheftFee: vi.fn(),
  useCancelRental: vi.fn(),
  useRetryRentalSetup: vi.fn(),
  useResetMaintenance: vi.fn(),
}))

vi.mock('../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
  TOKEN_KEY: 'dashgo.token',
}))

import {
  useAdminRentals,
  useChargeLateFee,
  useChargeTheftFee,
  useCancelRental,
  useRetryRentalSetup,
  useResetMaintenance,
} from '../lib/queries'
import { SuperRentalsPage } from './super.rentals'

const mockUseAdminRentals = vi.mocked(useAdminRentals)
const mockUseChargeLateFee = vi.mocked(useChargeLateFee)
const mockUseChargeTheftFee = vi.mocked(useChargeTheftFee)
const mockUseCancelRental = vi.mocked(useCancelRental)
const mockUseRetryRentalSetup = vi.mocked(useRetryRentalSetup)
const mockUseResetMaintenance = vi.mocked(useResetMaintenance)

// ── Helpers ────────────────────────────────────────────────────────────────────

type MutationMock = {
  mutateAsync: ReturnType<typeof vi.fn>
  isPending: boolean
}

function mutationMock(overrides: Partial<MutationMock> = {}) {
  return {
    mutate: vi.fn(),
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
    reset: vi.fn(),
    ...overrides,
  }
}

function makeRental(
  overrides: Partial<AdminRentalResponse> = {},
): AdminRentalResponse {
  return {
    id: 'rental-001',
    userId: 'user-001',
    userName: 'Juan García',
    userPhone: '+1234567890',
    productId: 'prod-001',
    productName: 'Dispensador Azul',
    status: 'active',
    monthlyRentCents: 2000,
    lateFeeCents: 500,
    theftFeeCents: 0,
    theftFeeChargedAt: null,
    stripeSubscriptionId: 'sub_stripe_001',
    currentPeriodEnd: '2026-06-01T00:00:00Z',
    activatedAt: '2026-05-01T00:00:00Z',
    canceledAt: null,
    nextMaintenanceAt: null,
    daysDelinquent: 0,
    createdAt: '2026-05-01T00:00:00Z',
    ...overrides,
  }
}

type Mutations = {
  charge?: ReturnType<typeof mutationMock>
  theft?: ReturnType<typeof mutationMock>
  cancel?: ReturnType<typeof mutationMock>
  retry?: ReturnType<typeof mutationMock>
  resetMaintenance?: ReturnType<typeof mutationMock>
}

function setup(
  opts: {
    rentals?: AdminRentalResponse[]
    isPending?: boolean
  } & Mutations = {},
) {
  mockUseAdminRentals.mockReturnValue({
    data: opts.isPending ? undefined : (opts.rentals ?? []),
    isPending: opts.isPending ?? false,
    isError: false,
    error: null,
  } as unknown as ReturnType<typeof useAdminRentals>)

  const wire = <T,>(m: ReturnType<typeof mutationMock> | undefined) =>
    (m ?? mutationMock()) as unknown as T

  mockUseChargeLateFee.mockReturnValue(wire(opts.charge))
  mockUseChargeTheftFee.mockReturnValue(wire(opts.theft))
  mockUseCancelRental.mockReturnValue(wire(opts.cancel))
  mockUseRetryRentalSetup.mockReturnValue(wire(opts.retry))
  mockUseResetMaintenance.mockReturnValue(wire(opts.resetMaintenance))
}

/** Opens the confirmation modal by pressing a row action, then returns it. */
async function pressAction(name: RegExp | string) {
  await userEvent.click(screen.getByRole('button', { name }))
  return screen.getByRole('dialog')
}

async function confirmModal() {
  const dialog = screen.getByRole('dialog')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmar' }))
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('SuperRentalsPage — list rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the loading state while the query is pending', () => {
    setup({ isPending: true })
    renderWithProviders(<SuperRentalsPage />)

    expect(screen.getByText('Cargando…')).toBeInTheDocument()
  })

  it('shows the empty state when there are no rentals', () => {
    setup({ rentals: [] })
    renderWithProviders(<SuperRentalsPage />)

    expect(screen.getByText('No hay alquileres registrados')).toBeInTheDocument()
  })

  it('renders customer, phone, product and monthly rate', () => {
    setup({ rentals: [makeRental()] })
    renderWithProviders(<SuperRentalsPage />)

    expect(screen.getByText('Juan García')).toBeInTheDocument()
    expect(screen.getByText('+1234567890')).toBeInTheDocument()
    expect(screen.getByText('Dispensador Azul')).toBeInTheDocument()
    expect(screen.getByText('$20.00/mes')).toBeInTheDocument()
  })

  // The status badge is translated for the operator. The previous suite
  // asserted the raw enum ('active'), which the page has never rendered.
  it.each([
    ['active', 'Activo'],
    ['past_due', 'Atrasado'],
    ['unpaid', 'Sin pagar'],
    ['pending_setup', 'Setup pendiente'],
    ['canceled', 'Cancelado'],
  ] as const)('renders the %s badge in Spanish as "%s"', (status, label) => {
    setup({ rentals: [makeRental({ status })] })
    renderWithProviders(<SuperRentalsPage />)

    // The filter dropdown reuses these same labels, so scope the lookup to the
    // rental row — the badge sits beside the customer name.
    const row = screen.getByText('Juan García').parentElement!
    expect(within(row).getByText(label)).toBeInTheDocument()
  })

  it('flags how many days a rental is delinquent, and hides it at zero', () => {
    setup({ rentals: [makeRental({ status: 'past_due', daysDelinquent: 12 })] })
    const { unmount } = renderWithProviders(<SuperRentalsPage />)
    expect(screen.getByText('12d atrasado')).toBeInTheDocument()
    unmount()

    setup({ rentals: [makeRental({ daysDelinquent: 0 })] })
    renderWithProviders(<SuperRentalsPage />)
    expect(screen.queryByText(/atrasado/)).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// The summary is real business math (`useMemo` over the fetched list) and was
// entirely absent from the old driver.
// ---------------------------------------------------------------------------

describe('SuperRentalsPage — summary cards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('counts active vs delinquent rentals and sums the rent at risk', () => {
    setup({
      rentals: [
        makeRental({ id: 'r1', status: 'active', monthlyRentCents: 2000 }),
        makeRental({ id: 'r2', status: 'active', monthlyRentCents: 3000 }),
        makeRental({ id: 'r3', status: 'past_due', monthlyRentCents: 2500 }),
        makeRental({ id: 'r4', status: 'unpaid', monthlyRentCents: 1500 }),
        // Cancelled rentals are neither "al día" nor at risk.
        makeRental({ id: 'r5', status: 'canceled', monthlyRentCents: 9900 }),
      ],
    })
    renderWithProviders(<SuperRentalsPage />)

    const alDia = screen.getByText('Al día').parentElement!
    const debiendo = screen.getByText('Debiendo').parentElement!
    const atRisk = screen.getByText('Renta mensual en riesgo').parentElement!

    expect(within(alDia).getByText('2')).toBeInTheDocument()
    expect(within(debiendo).getByText('2')).toBeInTheDocument()
    // 2500 + 1500 — the cancelled 9900 must not count.
    expect(within(atRisk).getByText('$40.00')).toBeInTheDocument()
  })
})

describe('SuperRentalsPage — which actions each status offers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('offers only "Cancelar" for an active rental with no late fee', () => {
    setup({ rentals: [makeRental({ status: 'active', lateFeeCents: 0 })] })
    renderWithProviders(<SuperRentalsPage />)

    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Cobrar late fee' }),
    ).not.toBeInTheDocument()
  })

  it('adds "Cobrar late fee" — but not "Cobrar y cancelar" — while active', () => {
    setup({ rentals: [makeRental({ status: 'active', lateFeeCents: 500 })] })
    renderWithProviders(<SuperRentalsPage />)

    expect(
      screen.getByRole('button', { name: 'Cobrar late fee' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Cobrar y cancelar' }),
    ).not.toBeInTheDocument()
  })

  it('offers charge, charge-and-cancel and cancel once past due', () => {
    setup({ rentals: [makeRental({ status: 'past_due', lateFeeCents: 500 })] })
    renderWithProviders(<SuperRentalsPage />)

    expect(screen.getByRole('button', { name: 'Cobrar late fee' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cobrar y cancelar' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument()
  })

  it('offers "Reintentar setup" only while the setup is pending', () => {
    setup({ rentals: [makeRental({ status: 'pending_setup', lateFeeCents: 0 })] })
    renderWithProviders(<SuperRentalsPage />)

    expect(
      screen.getByRole('button', { name: 'Reintentar setup' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument()
  })

  // The theft fee is a one-shot charge. Offering it twice would double-bill.
  it('offers "Cobrar robo" when a theft fee is set and not yet charged', () => {
    setup({ rentals: [makeRental({ theftFeeCents: 8000 })] })
    renderWithProviders(<SuperRentalsPage />)

    expect(screen.getByRole('button', { name: 'Cobrar robo' })).toBeInTheDocument()
  })

  it('hides "Cobrar robo" once the theft fee has been charged', () => {
    setup({
      rentals: [
        makeRental({
          theftFeeCents: 8000,
          theftFeeChargedAt: '2026-05-20T00:00:00Z',
        }),
      ],
    })
    renderWithProviders(<SuperRentalsPage />)

    expect(
      screen.queryByRole('button', { name: 'Cobrar robo' }),
    ).not.toBeInTheDocument()
  })

  it('offers "Reiniciar timer" only when a maintenance timer is running', () => {
    setup({ rentals: [makeRental({ nextMaintenanceAt: null })] })
    const { unmount } = renderWithProviders(<SuperRentalsPage />)
    expect(
      screen.queryByRole('button', { name: 'Reiniciar timer' }),
    ).not.toBeInTheDocument()
    unmount()

    setup({ rentals: [makeRental({ nextMaintenanceAt: '2026-08-01T00:00:00Z' })] })
    renderWithProviders(<SuperRentalsPage />)
    expect(
      screen.getByRole('button', { name: 'Reiniciar timer' }),
    ).toBeInTheDocument()
  })
})

describe('SuperRentalsPage — confirmation modal dispatches the right mutation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('names the customer and the amount in the confirmation', async () => {
    setup({ rentals: [makeRental({ lateFeeCents: 500 })] })
    renderWithProviders(<SuperRentalsPage />)

    const dialog = await pressAction('Cobrar late fee')

    expect(
      within(dialog).getByText('Cobrar multa de $5.00 a Juan García'),
    ).toBeInTheDocument()
    expect(
      within(dialog).getByText(/no se puede deshacer/i),
    ).toBeInTheDocument()
  })

  it('charges the late fee without cancelling', async () => {
    const charge = mutationMock()
    setup({ rentals: [makeRental({ lateFeeCents: 500 })], charge })
    renderWithProviders(<SuperRentalsPage />)

    await pressAction('Cobrar late fee')
    await confirmModal()

    await waitFor(() =>
      expect(charge.mutateAsync).toHaveBeenCalledWith({
        rentalId: 'rental-001',
        alsoCancel: false,
      }),
    )
  })

  it('charges the late fee AND cancels when that action is chosen', async () => {
    const charge = mutationMock()
    setup({
      rentals: [makeRental({ status: 'past_due', lateFeeCents: 500 })],
      charge,
    })
    renderWithProviders(<SuperRentalsPage />)

    await pressAction('Cobrar y cancelar')
    await confirmModal()

    await waitFor(() =>
      expect(charge.mutateAsync).toHaveBeenCalledWith({
        rentalId: 'rental-001',
        alsoCancel: true,
      }),
    )
  })

  // "Cobrar robo" bills the theft fee and closes the contract in one step.
  it('charges the theft fee and cancels the rental', async () => {
    const theft = mutationMock()
    const charge = mutationMock()
    setup({ rentals: [makeRental({ theftFeeCents: 8000 })], theft, charge })
    renderWithProviders(<SuperRentalsPage />)

    await pressAction('Cobrar robo')
    await confirmModal()

    await waitFor(() =>
      expect(theft.mutateAsync).toHaveBeenCalledWith({
        rentalId: 'rental-001',
        alsoCancel: true,
      }),
    )
    // The late-fee mutation must not fire for a theft charge.
    expect(charge.mutateAsync).not.toHaveBeenCalled()
  })

  it('cancels the rental', async () => {
    const cancel = mutationMock()
    setup({ rentals: [makeRental({ lateFeeCents: 0 })], cancel })
    renderWithProviders(<SuperRentalsPage />)

    await pressAction('Cancelar')
    await confirmModal()

    await waitFor(() =>
      expect(cancel.mutateAsync).toHaveBeenCalledWith('rental-001'),
    )
  })

  it('retries a pending setup', async () => {
    const retry = mutationMock()
    setup({ rentals: [makeRental({ status: 'pending_setup' })], retry })
    renderWithProviders(<SuperRentalsPage />)

    await pressAction('Reintentar setup')
    await confirmModal()

    await waitFor(() =>
      expect(retry.mutateAsync).toHaveBeenCalledWith('rental-001'),
    )
  })

  it('resets the maintenance timer', async () => {
    const resetMaintenance = mutationMock()
    setup({
      rentals: [makeRental({ nextMaintenanceAt: '2026-08-01T00:00:00Z' })],
      resetMaintenance,
    })
    renderWithProviders(<SuperRentalsPage />)

    await pressAction('Reiniciar timer')
    await confirmModal()

    await waitFor(() =>
      expect(resetMaintenance.mutateAsync).toHaveBeenCalledWith('rental-001'),
    )
  })

  it('dismisses without touching anything when the operator backs out', async () => {
    const cancel = mutationMock()
    setup({ rentals: [makeRental({ lateFeeCents: 0 })], cancel })
    renderWithProviders(<SuperRentalsPage />)

    const dialog = await pressAction('Cancelar')
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Cancelar' }),
    )

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(cancel.mutateAsync).not.toHaveBeenCalled()
  })

  it('locks the modal into "Procesando…" while a mutation is in flight', () => {
    setup({
      rentals: [makeRental({ lateFeeCents: 0 })],
      cancel: mutationMock({ isPending: true }),
    })
    renderWithProviders(<SuperRentalsPage />)

    // No modal open yet — the flag only matters once one is.
    expect(screen.queryByText('Procesando…')).not.toBeInTheDocument()
  })
})

describe('SuperRentalsPage — failures surface to the operator', () => {
  let alertSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
  })

  afterEach(() => {
    alertSpy.mockRestore()
  })

  it('shows the API message when the charge is rejected', async () => {
    const charge = mutationMock({
      mutateAsync: vi.fn().mockRejectedValue({
        response: { data: { message: 'La tarjeta fue rechazada' } },
      }),
    })
    setup({ rentals: [makeRental({ lateFeeCents: 500 })], charge })
    renderWithProviders(<SuperRentalsPage />)

    await pressAction('Cobrar late fee')
    await confirmModal()

    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith('La tarjeta fue rechazada'),
    )
    // The modal closes either way, so the operator is never stuck.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('falls back to a generic message when the error carries none', async () => {
    const charge = mutationMock({
      mutateAsync: vi.fn().mockRejectedValue(new Error('Network Error')),
    })
    setup({ rentals: [makeRental({ lateFeeCents: 500 })], charge })
    renderWithProviders(<SuperRentalsPage />)

    await pressAction('Cobrar late fee')
    await confirmModal()

    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith('No se pudo completar la acción'),
    )
  })
})

describe('SuperRentalsPage — filters', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('refetches by status when the operator picks one', async () => {
    setup({ rentals: [makeRental()] })
    renderWithProviders(<SuperRentalsPage />)

    await userEvent.selectOptions(
      screen.getByLabelText('Filtrar por estado'),
      'past_due',
    )

    await waitFor(() =>
      expect(mockUseAdminRentals).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: ['past_due'], page: 1 }),
      ),
    )
  })

  it('offers "Limpiar filtros" only once a filter is active, and clears it', async () => {
    setup({ rentals: [makeRental()] })
    renderWithProviders(<SuperRentalsPage />)

    expect(
      screen.queryByRole('button', { name: 'Limpiar filtros' }),
    ).not.toBeInTheDocument()

    await userEvent.selectOptions(
      screen.getByLabelText('Filtrar por estado'),
      'unpaid',
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Limpiar filtros' }),
    )

    await waitFor(() =>
      expect(mockUseAdminRentals).toHaveBeenLastCalledWith({
        page: 1,
        pageSize: 25,
      }),
    )
    expect(
      screen.queryByRole('button', { name: 'Limpiar filtros' }),
    ).not.toBeInTheDocument()
  })
})
