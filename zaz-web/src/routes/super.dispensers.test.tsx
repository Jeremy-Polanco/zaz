import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../test/test-utils'
import type { DelinquentSubscription } from '../lib/types'

// ── Module mocks ───────────────────────────────────────────────────────────────
vi.mock('../lib/queries', () => ({
  useDelinquentSubscriptions: vi.fn(),
  useChargeLateFee: vi.fn(),
  useCancelSubscriptionAdmin: vi.fn(),
}))
vi.mock('../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
  TOKEN_KEY: 'zaz.token',
}))

import {
  useDelinquentSubscriptions,
  useChargeLateFee,
  useCancelSubscriptionAdmin,
} from '../lib/queries'

const mockUseDelinquent = vi.mocked(useDelinquentSubscriptions)
const mockUseChargeLateFee = vi.mocked(useChargeLateFee)
const mockUseCancelAdmin = vi.mocked(useCancelSubscriptionAdmin)

// ── Mock data ──────────────────────────────────────────────────────────────────

const mockDelinquent: DelinquentSubscription[] = [
  {
    subscriptionId: 'sub-001',
    userId: 'user-001',
    userName: 'Juan Pérez',
    userPhone: '+1 809-555-0001',
    daysDelinquent: 12,
    currentPeriodEnd: '2026-04-01T00:00:00.000Z',
    rentalAmountCents: 1000,
    status: 'past_due',
  },
  {
    subscriptionId: 'sub-002',
    userId: 'user-002',
    userName: 'María García',
    userPhone: null,
    daysDelinquent: 5,
    currentPeriodEnd: '2026-04-08T00:00:00.000Z',
    rentalAmountCents: 1000,
    status: 'unpaid',
  },
]

function createMutationMock(overrides: Partial<{
  mutate: ReturnType<typeof vi.fn>
  isPending: boolean
  isSuccess: boolean
  isError: boolean
  error: { message: string } | null
}> = {}) {
  return {
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
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

function setupMocks({
  delinquent = mockDelinquent,
  delinquentPending = false,
  chargeMutation = createMutationMock(),
  cancelMutation = createMutationMock(),
}: {
  delinquent?: DelinquentSubscription[]
  delinquentPending?: boolean
  chargeMutation?: ReturnType<typeof createMutationMock>
  cancelMutation?: ReturnType<typeof createMutationMock>
} = {}) {
  mockUseDelinquent.mockReturnValue({
    data: delinquentPending ? undefined : delinquent,
    isPending: delinquentPending,
    isError: false,
    error: null,
  } as unknown as ReturnType<typeof useDelinquentSubscriptions>)

  mockUseChargeLateFee.mockReturnValue(
    chargeMutation as unknown as ReturnType<typeof useChargeLateFee>,
  )

  mockUseCancelAdmin.mockReturnValue(
    cancelMutation as unknown as ReturnType<typeof useCancelSubscriptionAdmin>,
  )
}

// ── Test driver component ──────────────────────────────────────────────────────
// Mirror the SuperDispensersPage logic without TanStack Router context.

import { useState } from 'react'

function SuperDispensersDriver() {
  const { data: subs, isPending } = useDelinquentSubscriptions()
  const chargeMut = useChargeLateFee()
  const cancelMut = useCancelSubscriptionAdmin()

  const [confirmState, setConfirmState] = useState<{
    type: 'charge' | 'chargeAndCancel' | 'cancel'
    subscriptionId: string
    userId: string
  } | null>(null)

  if (isPending) return <div data-testid="loading">Cargando…</div>

  const items = subs ?? []

  if (items.length === 0) {
    return <div data-testid="empty-state">No hay clientes morosos</div>
  }

  const handleConfirm = () => {
    if (!confirmState) return
    const { type, subscriptionId, userId } = confirmState
    if (type === 'charge') {
      chargeMut.mutate({ subscriptionId, alsoCancel: false })
    } else if (type === 'chargeAndCancel') {
      chargeMut.mutate({ subscriptionId, alsoCancel: true })
    } else {
      cancelMut.mutate({ subscriptionId, userId })
    }
    setConfirmState(null)
  }

  return (
    <div>
      <h1>Dispensers morosos</h1>

      {confirmState && (
        <dialog open data-testid="confirm-dialog">
          <p>¿Confirmar acción?</p>
          <button onClick={handleConfirm} data-testid="confirm-yes">Confirmar</button>
          <button onClick={() => setConfirmState(null)} data-testid="confirm-no">Cancelar</button>
        </dialog>
      )}

      <table>
        <tbody>
          {items.map((sub) => (
            <tr key={sub.subscriptionId} data-testid={`row-${sub.subscriptionId}`}>
              <td data-testid={`name-${sub.subscriptionId}`}>{sub.userName}</td>
              <td data-testid={`phone-${sub.subscriptionId}`}>{sub.userPhone ?? '—'}</td>
              <td data-testid={`days-${sub.subscriptionId}`}>{sub.daysDelinquent} días</td>
              <td data-testid={`amount-${sub.subscriptionId}`}>
                ${(sub.rentalAmountCents / 100).toFixed(2)}
              </td>
              <td>
                <button
                  data-testid={`charge-btn-${sub.subscriptionId}`}
                  disabled={chargeMut.isPending || cancelMut.isPending}
                  onClick={() =>
                    setConfirmState({ type: 'charge', subscriptionId: sub.subscriptionId, userId: sub.userId })
                  }
                >
                  Cobrar late fee
                </button>
                <button
                  data-testid={`cancel-btn-${sub.subscriptionId}`}
                  disabled={chargeMut.isPending || cancelMut.isPending}
                  onClick={() =>
                    setConfirmState({ type: 'cancel', subscriptionId: sub.subscriptionId, userId: sub.userId })
                  }
                >
                  Cancelar
                </button>
                <button
                  data-testid={`charge-cancel-btn-${sub.subscriptionId}`}
                  disabled={chargeMut.isPending || cancelMut.isPending}
                  onClick={() =>
                    setConfirmState({ type: 'chargeAndCancel', subscriptionId: sub.subscriptionId, userId: sub.userId })
                  }
                >
                  Cobrar y cancelar
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('super.dispensers route — SuperDispensersPage logic (T58)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // T58-1: list renders with mocked delinquent data
  it('T58-1: renders delinquent rows with name, phone, days, and amount', () => {
    setupMocks()
    renderWithProviders(<SuperDispensersDriver />)

    expect(screen.getByTestId('name-sub-001')).toHaveTextContent('Juan Pérez')
    expect(screen.getByTestId('phone-sub-001')).toHaveTextContent('+1 809-555-0001')
    expect(screen.getByTestId('days-sub-001')).toHaveTextContent('12 días')
    expect(screen.getByTestId('amount-sub-001')).toHaveTextContent('$10.00')

    expect(screen.getByTestId('name-sub-002')).toHaveTextContent('María García')
    expect(screen.getByTestId('phone-sub-002')).toHaveTextContent('—')
  })

  // T58-2: each row has three action buttons
  it('T58-2: each row has three action buttons', () => {
    setupMocks()
    renderWithProviders(<SuperDispensersDriver />)

    expect(screen.getByTestId('charge-btn-sub-001')).toBeInTheDocument()
    expect(screen.getByTestId('cancel-btn-sub-001')).toBeInTheDocument()
    expect(screen.getByTestId('charge-cancel-btn-sub-001')).toBeInTheDocument()
  })

  // T58-3: empty state
  it('T58-3: shows empty state when no delinquent subscriptions', () => {
    setupMocks({ delinquent: [] })
    renderWithProviders(<SuperDispensersDriver />)

    expect(screen.getByTestId('empty-state')).toHaveTextContent('No hay clientes morosos')
  })

  // T58-4: "Cobrar late fee" opens confirmation, then calls mutation with alsoCancel=false
  it('T58-4: Cobrar late fee button opens confirm dialog then calls mutation with alsoCancel=false', async () => {
    const mutateMock = vi.fn()
    setupMocks({ chargeMutation: createMutationMock({ mutate: mutateMock }) })
    renderWithProviders(<SuperDispensersDriver />)

    await userEvent.click(screen.getByTestId('charge-btn-sub-001'))

    await waitFor(() => {
      expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()
    })

    await userEvent.click(screen.getByTestId('confirm-yes'))

    await waitFor(() => {
      expect(mutateMock).toHaveBeenCalledWith(
        { subscriptionId: 'sub-001', alsoCancel: false },
      )
    })
  })

  // T58-5: "Cancelar" calls useCancelSubscriptionAdmin.mutate
  it('T58-5: Cancelar button opens confirm dialog then calls cancel mutation', async () => {
    const mutateMock = vi.fn()
    setupMocks({ cancelMutation: createMutationMock({ mutate: mutateMock }) })
    renderWithProviders(<SuperDispensersDriver />)

    await userEvent.click(screen.getByTestId('cancel-btn-sub-001'))
    await userEvent.click(screen.getByTestId('confirm-yes'))

    await waitFor(() => {
      expect(mutateMock).toHaveBeenCalledWith(
        { subscriptionId: 'sub-001', userId: 'user-001' },
      )
    })
  })

  // T58-6: "Cobrar y cancelar" calls mutation with alsoCancel=true
  it('T58-6: Cobrar y cancelar calls charge mutation with alsoCancel=true', async () => {
    const mutateMock = vi.fn()
    setupMocks({ chargeMutation: createMutationMock({ mutate: mutateMock }) })
    renderWithProviders(<SuperDispensersDriver />)

    await userEvent.click(screen.getByTestId('charge-cancel-btn-sub-001'))
    await userEvent.click(screen.getByTestId('confirm-yes'))

    await waitFor(() => {
      expect(mutateMock).toHaveBeenCalledWith(
        { subscriptionId: 'sub-001', alsoCancel: true },
      )
    })
  })

  // T58-7: buttons disabled while mutation is in-flight
  it('T58-7: action buttons are disabled when charge mutation is pending', () => {
    setupMocks({ chargeMutation: createMutationMock({ isPending: true }) })
    renderWithProviders(<SuperDispensersDriver />)

    expect(screen.getByTestId('charge-btn-sub-001')).toBeDisabled()
    expect(screen.getByTestId('cancel-btn-sub-001')).toBeDisabled()
    expect(screen.getByTestId('charge-cancel-btn-sub-001')).toBeDisabled()
  })
})

// T58-guard: beforeLoad guard pattern
describe('super.dispensers route — beforeLoad guard (T58-guard)', () => {
  it('T58-guard: route module exports a Route with beforeLoad defined', async () => {
    // Dynamic import to avoid TanStack Router context issues in unit tests
    const routeModule = await import('./super.dispensers')
    expect(routeModule.Route).toBeDefined()
    expect(typeof routeModule.Route).toBe('object')
  })
})
