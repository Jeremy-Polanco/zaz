import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../test/test-utils'
import type { AdminRentalResponse, RentalStatus } from '../lib/types'

// ── Module mocks ───────────────────────────────────────────────────────────────

vi.mock('../lib/queries', () => ({
  useAdminRentals: vi.fn(),
  useChargeLateFee: vi.fn(),
  useCancelRental: vi.fn(),
  useRetryRentalSetup: vi.fn(),
}))

vi.mock('../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
  TOKEN_KEY: 'dashgo.token',
}))

import {
  useAdminRentals,
  useChargeLateFee,
  useCancelRental,
  useRetryRentalSetup,
} from '../lib/queries'

const mockUseAdminRentals = vi.mocked(useAdminRentals)
const mockUseChargeLateFee = vi.mocked(useChargeLateFee)
const mockUseCancelRental = vi.mocked(useCancelRental)
const mockUseRetryRentalSetup = vi.mocked(useRetryRentalSetup)

// ── Helpers ────────────────────────────────────────────────────────────────────

function createMutationMock(overrides: Partial<{
  mutate: ReturnType<typeof vi.fn>
  mutateAsync: ReturnType<typeof vi.fn>
  isPending: boolean
}> = {}) {
  return {
    mutate: vi.fn(),
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
    isSuccess: false,
    isError: false,
    isPaused: false,
    isIdle: true,
    error: null,
    data: undefined,
    reset: vi.fn(),
    variables: undefined,
    context: undefined,
    failureCount: 0,
    failureReason: null,
    status: 'idle' as const,
    submittedAt: 0,
    ...overrides,
  }
}

function makeRental(overrides: Partial<AdminRentalResponse> = {}): AdminRentalResponse {
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
    daysDelinquent: 0,
    createdAt: '2026-05-01T00:00:00Z',
    ...overrides,
  }
}

function setupMocks(opts: {
  rentals?: AdminRentalResponse[]
  isPending?: boolean
  chargeMutation?: ReturnType<typeof createMutationMock>
  cancelMutation?: ReturnType<typeof createMutationMock>
  retryMutation?: ReturnType<typeof createMutationMock>
} = {}) {
  mockUseAdminRentals.mockReturnValue({
    data: opts.isPending ? undefined : (opts.rentals ?? []),
    isPending: opts.isPending ?? false,
    isError: false,
    error: null,
  } as unknown as ReturnType<typeof useAdminRentals>)

  mockUseChargeLateFee.mockReturnValue(
    (opts.chargeMutation ?? createMutationMock()) as unknown as ReturnType<typeof useChargeLateFee>,
  )
  mockUseCancelRental.mockReturnValue(
    (opts.cancelMutation ?? createMutationMock()) as unknown as ReturnType<typeof useCancelRental>,
  )
  mockUseRetryRentalSetup.mockReturnValue(
    (opts.retryMutation ?? createMutationMock()) as unknown as ReturnType<typeof useRetryRentalSetup>,
  )
}

// ── Test driver component ──────────────────────────────────────────────────────
// This driver mirrors the logic of super.rentals.tsx without going through
// TanStack Router's beforeLoad, following the super.subscription.test.tsx pattern.

import { useState } from 'react'
import type { RentalFilter } from '../lib/types'
import {
  useAdminRentals as useAdminRentalsHook,
  useChargeLateFee as useChargeLateFeeHook,
  useCancelRental as useCancelRentalHook,
  useRetryRentalSetup as useRetryRentalSetupHook,
} from '../lib/queries'

const STATUS_OPTIONS: RentalStatus[] = ['pending_setup', 'active', 'past_due', 'unpaid', 'canceled']

function statusBadgeClass(status: RentalStatus): string {
  switch (status) {
    case 'active': return 'bg-ok/10 text-ok'
    case 'past_due': return 'bg-warn/10 text-warn'
    case 'unpaid': return 'bg-bad/10 text-bad'
    case 'pending_setup': return 'bg-ink/10 text-ink-muted'
    case 'canceled': return 'bg-ink/5 text-ink-muted'
  }
}

function RentalsPageDriver() {
  const [filters, setFilters] = useState<RentalFilter>({ page: 1, pageSize: 25 })
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [customerSearch, setCustomerSearch] = useState('')
  const [confirmModal, setConfirmModal] = useState<{
    action: 'charge' | 'charge-cancel' | 'cancel' | 'retry'
    rentalId: string
  } | null>(null)

  const { data: rentals, isPending } = useAdminRentalsHook(filters)
  const chargeMutation = useChargeLateFeeHook()
  const cancelMutation = useCancelRentalHook()
  const retryMutation = useRetryRentalSetupHook()

  const handleStatusChange = (value: string) => {
    setStatusFilter(value)
    setFilters((f) => ({
      ...f,
      status: value ? [value] : undefined,
      page: 1,
    }))
  }

  const handleConfirm = async () => {
    if (!confirmModal) return
    const { action, rentalId } = confirmModal
    if (action === 'charge') {
      await chargeMutation.mutateAsync({ rentalId, alsoCancel: false })
    } else if (action === 'charge-cancel') {
      await chargeMutation.mutateAsync({ rentalId, alsoCancel: true })
    } else if (action === 'cancel') {
      await cancelMutation.mutateAsync(rentalId)
    } else if (action === 'retry') {
      await retryMutation.mutateAsync(rentalId)
    }
    setConfirmModal(null)
  }

  if (isPending) {
    return <div><span>Cargando…</span></div>
  }

  return (
    <div>
      <h1>Alquileres</h1>

      {/* Filter bar */}
      <div data-testid="filter-bar">
        <select
          value={statusFilter}
          onChange={(e) => handleStatusChange(e.target.value)}
          data-testid="status-filter"
          aria-label="Filtrar por estado"
        >
          <option value="">Todos los estados</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        <input
          type="text"
          value={customerSearch}
          onChange={(e) => {
            setCustomerSearch(e.target.value)
            setFilters((f) => ({ ...f, userId: e.target.value || undefined }))
          }}
          placeholder="Buscar cliente…"
          data-testid="customer-search"
        />
      </div>

      {/* Empty state */}
      {(!rentals || rentals.length === 0) ? (
        <div data-testid="empty-state">
          <p>No hay alquileres registrados</p>
        </div>
      ) : (
        <table data-testid="rentals-table">
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Producto</th>
              <th>Estado</th>
              <th>$/mes</th>
              <th>Periodo</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {rentals.map((r) => (
              <tr key={r.id} data-testid={`rental-row-${r.id}`}>
                <td data-testid={`customer-name-${r.id}`}>{r.userName}</td>
                <td data-testid={`product-name-${r.id}`}>{r.productName}</td>
                <td>
                  <span
                    className={statusBadgeClass(r.status)}
                    data-testid={`status-badge-${r.id}`}
                  >
                    {r.status}
                  </span>
                </td>
                <td data-testid={`monthly-rate-${r.id}`}>
                  ${(r.monthlyRentCents / 100).toFixed(2)}
                </td>
                <td data-testid={`period-end-${r.id}`}>
                  {r.currentPeriodEnd ? new Date(r.currentPeriodEnd).toLocaleDateString('es') : '—'}
                </td>
                <td data-testid={`actions-${r.id}`}>
                  {/* Cobrar late fee: active, past_due, unpaid with lateFeeCents > 0 */}
                  {(['active', 'past_due', 'unpaid'] as RentalStatus[]).includes(r.status) && r.lateFeeCents > 0 && (
                    <button
                      type="button"
                      onClick={() => setConfirmModal({ action: 'charge', rentalId: r.id })}
                      data-testid={`btn-charge-${r.id}`}
                    >
                      Cobrar late fee
                    </button>
                  )}
                  {/* Cobrar y cancelar: past_due, unpaid with lateFeeCents > 0 */}
                  {(['past_due', 'unpaid'] as RentalStatus[]).includes(r.status) && r.lateFeeCents > 0 && (
                    <button
                      type="button"
                      onClick={() => setConfirmModal({ action: 'charge-cancel', rentalId: r.id })}
                      data-testid={`btn-charge-cancel-${r.id}`}
                    >
                      Cobrar y cancelar
                    </button>
                  )}
                  {/* Cancelar: active, past_due, unpaid, pending_setup */}
                  {(['active', 'past_due', 'unpaid', 'pending_setup'] as RentalStatus[]).includes(r.status) && (
                    <button
                      type="button"
                      onClick={() => setConfirmModal({ action: 'cancel', rentalId: r.id })}
                      data-testid={`btn-cancel-${r.id}`}
                    >
                      Cancelar
                    </button>
                  )}
                  {/* Reintentar setup: pending_setup only */}
                  {r.status === 'pending_setup' && (
                    <button
                      type="button"
                      onClick={() => setConfirmModal({ action: 'retry', rentalId: r.id })}
                      data-testid={`btn-retry-${r.id}`}
                    >
                      Reintentar setup
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Confirmation modal */}
      {confirmModal ? (
        <div role="dialog" aria-modal="true" data-testid="confirm-modal">
          <p>¿Confirmar acción?</p>
          <button
            type="button"
            onClick={handleConfirm}
            data-testid="confirm-btn"
          >
            Confirmar
          </button>
          <button
            type="button"
            onClick={() => setConfirmModal(null)}
            data-testid="cancel-btn"
          >
            Cancelar
          </button>
        </div>
      ) : null}
    </div>
  )
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('super.rentals — admin rentals list', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // T79a: empty state
  it('T79a: empty state shows "No hay alquileres registrados"', () => {
    setupMocks({ rentals: [] })
    renderWithProviders(<RentalsPageDriver />)
    expect(screen.getByTestId('empty-state')).toBeInTheDocument()
    expect(screen.getByText('No hay alquileres registrados')).toBeInTheDocument()
  })

  // T79b: list renders with mocked data
  it('T79b: renders list with customer name, product name, status badge, monthly rate, period end', () => {
    const rental = makeRental()
    setupMocks({ rentals: [rental] })
    renderWithProviders(<RentalsPageDriver />)

    expect(screen.getByTestId(`customer-name-${rental.id}`)).toHaveTextContent('Juan García')
    expect(screen.getByTestId(`product-name-${rental.id}`)).toHaveTextContent('Dispensador Azul')
    expect(screen.getByTestId(`status-badge-${rental.id}`)).toHaveTextContent('active')
    expect(screen.getByTestId(`monthly-rate-${rental.id}`)).toHaveTextContent('$20.00')
    expect(screen.getByTestId(`period-end-${rental.id}`)).toBeInTheDocument()
  })

  // T79c: filter bar renders
  it('T79c: filter bar renders with status dropdown and customer search', () => {
    setupMocks({ rentals: [] })
    renderWithProviders(<RentalsPageDriver />)

    expect(screen.getByTestId('filter-bar')).toBeInTheDocument()
    expect(screen.getByTestId('status-filter')).toBeInTheDocument()
    expect(screen.getByTestId('customer-search')).toBeInTheDocument()
  })

  // T79d: active rental shows only "Cancelar" (no charge buttons when lateFeeCents=0)
  it('T79d: active rental with lateFeeCents=0 shows only "Cancelar" button', () => {
    const rental = makeRental({ status: 'active', lateFeeCents: 0 })
    setupMocks({ rentals: [rental] })
    renderWithProviders(<RentalsPageDriver />)

    expect(screen.getByTestId(`btn-cancel-${rental.id}`)).toBeInTheDocument()
    expect(screen.queryByTestId(`btn-charge-${rental.id}`)).not.toBeInTheDocument()
    expect(screen.queryByTestId(`btn-charge-cancel-${rental.id}`)).not.toBeInTheDocument()
  })

  // T79e: active rental with lateFeeCents > 0 shows "Cobrar late fee" + "Cancelar"
  it('T79e: active rental with lateFeeCents>0 shows "Cobrar late fee" and "Cancelar"', () => {
    const rental = makeRental({ status: 'active', lateFeeCents: 500 })
    setupMocks({ rentals: [rental] })
    renderWithProviders(<RentalsPageDriver />)

    expect(screen.getByTestId(`btn-charge-${rental.id}`)).toBeInTheDocument()
    expect(screen.getByTestId(`btn-cancel-${rental.id}`)).toBeInTheDocument()
    expect(screen.queryByTestId(`btn-charge-cancel-${rental.id}`)).not.toBeInTheDocument()
  })

  // T79f: past_due rental shows "Cobrar late fee", "Cobrar y cancelar", "Cancelar"
  it('T79f: past_due rental shows all three action buttons', () => {
    const rental = makeRental({ status: 'past_due', lateFeeCents: 500 })
    setupMocks({ rentals: [rental] })
    renderWithProviders(<RentalsPageDriver />)

    expect(screen.getByTestId(`btn-charge-${rental.id}`)).toBeInTheDocument()
    expect(screen.getByTestId(`btn-charge-cancel-${rental.id}`)).toBeInTheDocument()
    expect(screen.getByTestId(`btn-cancel-${rental.id}`)).toBeInTheDocument()
  })

  // T79g: pending_setup shows "Reintentar setup" + "Cancelar"
  it('T79g: pending_setup rental shows "Reintentar setup" and "Cancelar"', () => {
    const rental = makeRental({ status: 'pending_setup', lateFeeCents: 0 })
    setupMocks({ rentals: [rental] })
    renderWithProviders(<RentalsPageDriver />)

    expect(screen.getByTestId(`btn-retry-${rental.id}`)).toBeInTheDocument()
    expect(screen.getByTestId(`btn-cancel-${rental.id}`)).toBeInTheDocument()
    expect(screen.queryByTestId(`btn-charge-${rental.id}`)).not.toBeInTheDocument()
  })

  // T79h: clicking "Cobrar late fee" opens confirmation modal
  it('T79h: clicking "Cobrar late fee" opens confirmation modal', async () => {
    const rental = makeRental({ status: 'active', lateFeeCents: 500 })
    setupMocks({ rentals: [rental] })
    renderWithProviders(<RentalsPageDriver />)

    await userEvent.click(screen.getByTestId(`btn-charge-${rental.id}`))

    expect(screen.getByTestId('confirm-modal')).toBeInTheDocument()
    expect(screen.getByTestId('confirm-btn')).toBeInTheDocument()
  })

  // T79i: confirming "Cobrar late fee" calls useChargeLateFee with correct params
  it('T79i: confirming "Cobrar late fee" calls useChargeLateFee({ rentalId, alsoCancel: false })', async () => {
    const rental = makeRental({ status: 'active', lateFeeCents: 500 })
    const mutateAsync = vi.fn().mockResolvedValue({})
    setupMocks({
      rentals: [rental],
      chargeMutation: createMutationMock({ mutateAsync }),
    })
    renderWithProviders(<RentalsPageDriver />)

    await userEvent.click(screen.getByTestId(`btn-charge-${rental.id}`))
    await userEvent.click(screen.getByTestId('confirm-btn'))

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({ rentalId: rental.id, alsoCancel: false })
    })
  })

  // T79j: confirming "Cancelar" calls useCancelRental
  it('T79j: confirming "Cancelar" calls useCancelRental with rentalId', async () => {
    const rental = makeRental({ status: 'active', lateFeeCents: 0 })
    const mutateAsync = vi.fn().mockResolvedValue({})
    setupMocks({
      rentals: [rental],
      cancelMutation: createMutationMock({ mutateAsync }),
    })
    renderWithProviders(<RentalsPageDriver />)

    await userEvent.click(screen.getByTestId(`btn-cancel-${rental.id}`))
    await userEvent.click(screen.getByTestId('confirm-btn'))

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith(rental.id)
    })
  })

  // T79k: confirming "Reintentar setup" calls useRetryRentalSetup
  it('T79k: confirming "Reintentar setup" calls useRetryRentalSetup with rentalId', async () => {
    const rental = makeRental({ status: 'pending_setup', lateFeeCents: 0 })
    const mutateAsync = vi.fn().mockResolvedValue({})
    setupMocks({
      rentals: [rental],
      retryMutation: createMutationMock({ mutateAsync }),
    })
    renderWithProviders(<RentalsPageDriver />)

    await userEvent.click(screen.getByTestId(`btn-retry-${rental.id}`))
    await userEvent.click(screen.getByTestId('confirm-btn'))

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith(rental.id)
    })
  })

  // T79l: multiple rentals with different statuses — correct buttons per row
  it('T79l: multiple rentals render correct action buttons per status', () => {
    const activeRental = makeRental({ id: 'r1', status: 'active', lateFeeCents: 0 })
    const pastDueRental = makeRental({ id: 'r2', status: 'past_due', lateFeeCents: 500 })
    const pendingRental = makeRental({ id: 'r3', status: 'pending_setup', lateFeeCents: 0 })

    setupMocks({ rentals: [activeRental, pastDueRental, pendingRental] })
    renderWithProviders(<RentalsPageDriver />)

    // active row: only Cancel
    const actionsActive = screen.getByTestId('actions-r1')
    expect(within(actionsActive).getByTestId('btn-cancel-r1')).toBeInTheDocument()
    expect(screen.queryByTestId('btn-charge-r1')).not.toBeInTheDocument()

    // past_due row: charge + charge-cancel + cancel
    expect(screen.getByTestId('btn-charge-r2')).toBeInTheDocument()
    expect(screen.getByTestId('btn-charge-cancel-r2')).toBeInTheDocument()
    expect(screen.getByTestId('btn-cancel-r2')).toBeInTheDocument()

    // pending_setup row: retry + cancel
    expect(screen.getByTestId('btn-retry-r3')).toBeInTheDocument()
    expect(screen.getByTestId('btn-cancel-r3')).toBeInTheDocument()
  })

  // T79m: canceling confirmation modal dismisses it
  it('T79m: clicking cancel in modal dismisses it without calling mutations', async () => {
    const rental = makeRental({ status: 'active', lateFeeCents: 0 })
    const mutateAsync = vi.fn()
    setupMocks({
      rentals: [rental],
      cancelMutation: createMutationMock({ mutateAsync }),
    })
    renderWithProviders(<RentalsPageDriver />)

    await userEvent.click(screen.getByTestId(`btn-cancel-${rental.id}`))
    expect(screen.getByTestId('confirm-modal')).toBeInTheDocument()

    await userEvent.click(screen.getByTestId('cancel-btn'))

    expect(screen.queryByTestId('confirm-modal')).not.toBeInTheDocument()
    expect(mutateAsync).not.toHaveBeenCalled()
  })
})
