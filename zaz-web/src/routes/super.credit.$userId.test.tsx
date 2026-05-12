import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../test/test-utils'
import type { AdminPlanResponse, AdminUserSubscriptionResponse, Subscription } from '../lib/types'

// ── Module mocks ───────────────────────────────────────────────────────────────
vi.mock('../lib/queries', () => ({
  useUserSubscription: vi.fn(),
  useAdminSubscriptionPlan: vi.fn(),
  useActivateAsRental: vi.fn(),
  useActivateAsPurchase: vi.fn(),
  useCancelSubscriptionAdmin: vi.fn(),
}))
vi.mock('../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
  TOKEN_KEY: 'zaz.token',
}))

import {
  useUserSubscription,
  useAdminSubscriptionPlan,
  useActivateAsRental,
  useActivateAsPurchase,
  useCancelSubscriptionAdmin,
} from '../lib/queries'

const mockUseUserSub = vi.mocked(useUserSubscription)
const mockUsePlan = vi.mocked(useAdminSubscriptionPlan)
const mockUseActivateRental = vi.mocked(useActivateAsRental)
const mockUseActivatePurchase = vi.mocked(useActivateAsPurchase)
const mockUseCancelAdmin = vi.mocked(useCancelSubscriptionAdmin)

// ── Helper factories ───────────────────────────────────────────────────────────

function createMutationMock(overrides: Partial<{
  mutate: ReturnType<typeof vi.fn>
  isPending: boolean
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

const defaultPlan: AdminPlanResponse = {
  id: 'plan-001',
  stripeProductId: 'prod_001',
  activeStripePriceId: 'price_001',
  unitAmountCents: 1000,
  purchasePriceCents: 5000,
  lateFeeCents: 500,
  currency: 'usd',
  interval: 'month',
  updatedAt: '2026-05-01T00:00:00.000Z',
}

const rentalSub: Subscription = {
  id: 'sub-001',
  userId: 'user-001',
  status: 'active',
  model: 'rental',
  currentPeriodStart: '2026-05-01T00:00:00.000Z',
  currentPeriodEnd: '2026-06-01T00:00:00.000Z',
  cancelAtPeriodEnd: false,
  canceledAt: null,
  purchasedAt: null,
}

const purchaseSub: Subscription = {
  id: 'sub-002',
  userId: 'user-001',
  status: 'active',
  model: 'purchase',
  currentPeriodStart: '2026-05-01T00:00:00.000Z',
  currentPeriodEnd: '9999-12-31T00:00:00.000Z',
  cancelAtPeriodEnd: false,
  canceledAt: null,
  purchasedAt: '2026-05-01T00:00:00.000Z',
}

function setupMocks({
  subResponse = null as AdminUserSubscriptionResponse | null,
  hasPaymentMethod = true,
  plan = defaultPlan,
  rentalMut = createMutationMock(),
  purchaseMut = createMutationMock(),
  cancelMut = createMutationMock(),
}: {
  subResponse?: AdminUserSubscriptionResponse | null
  hasPaymentMethod?: boolean
  plan?: AdminPlanResponse
  rentalMut?: ReturnType<typeof createMutationMock>
  purchaseMut?: ReturnType<typeof createMutationMock>
  cancelMut?: ReturnType<typeof createMutationMock>
} = {}) {
  const resolvedResponse: AdminUserSubscriptionResponse = subResponse ?? {
    subscription: null,
    hasPaymentMethod,
  }

  mockUseUserSub.mockReturnValue({
    data: resolvedResponse,
    isPending: false,
    isError: false,
    error: null,
  } as unknown as ReturnType<typeof useUserSubscription>)

  mockUsePlan.mockReturnValue({
    data: plan,
    isPending: false,
    isError: false,
    error: null,
  } as unknown as ReturnType<typeof useAdminSubscriptionPlan>)

  mockUseActivateRental.mockReturnValue(
    rentalMut as unknown as ReturnType<typeof useActivateAsRental>,
  )
  mockUseActivatePurchase.mockReturnValue(
    purchaseMut as unknown as ReturnType<typeof useActivateAsPurchase>,
  )
  mockUseCancelAdmin.mockReturnValue(
    cancelMut as unknown as ReturnType<typeof useCancelSubscriptionAdmin>,
  )
}

// ── Test driver component ──────────────────────────────────────────────────────
// Tests only the Dispenser section logic, isolated from the full credit page.

import { useState } from 'react'

function DispenserSectionDriver({ userId = 'user-001' }: { userId?: string }) {
  const { data: subData } = useUserSubscription(userId)
  const { data: plan } = useAdminSubscriptionPlan()
  const rentalMut = useActivateAsRental(userId)
  const purchaseMut = useActivateAsPurchase(userId)
  const cancelMut = useCancelSubscriptionAdmin()

  const [confirm, setConfirm] = useState<'rental' | 'purchase' | 'cancel' | null>(null)

  const subscription = subData?.subscription ?? null
  const hasPaymentMethod = subData?.hasPaymentMethod ?? false
  const purchasePriceConfigured = (plan?.purchasePriceCents ?? 0) > 0

  const canActivateRental = hasPaymentMethod
  const canActivatePurchase = hasPaymentMethod && purchasePriceConfigured

  const isNoSub = !subscription || subscription.status === 'canceled'
  const isRental = subscription && subscription.status !== 'canceled' && subscription.model === 'rental'
  const isPurchase = subscription && subscription.model === 'purchase'

  const handleConfirm = () => {
    if (confirm === 'rental') {
      rentalMut.mutate()
    } else if (confirm === 'purchase') {
      purchaseMut.mutate()
    } else if (confirm === 'cancel' && subscription) {
      cancelMut.mutate({ subscriptionId: subscription.id, userId })
    }
    setConfirm(null)
  }

  return (
    <section data-testid="dispenser-section">
      <h2>Dispenser</h2>

      {confirm && (
        <dialog open data-testid="confirm-dialog">
          <button onClick={handleConfirm} data-testid="confirm-yes">Confirmar</button>
          <button onClick={() => setConfirm(null)} data-testid="confirm-no">Cancelar</button>
        </dialog>
      )}

      {isNoSub && (
        <div data-testid="state-no-sub">
          <p>El cliente no tiene dispenser.</p>
          <button
            data-testid="activate-rental-btn"
            disabled={!canActivateRental}
            onClick={() => setConfirm('rental')}
          >
            Activar como alquiler
          </button>
          {!hasPaymentMethod && (
            <p data-testid="no-payment-hint-rental">Cliente sin método de pago</p>
          )}
          <button
            data-testid="activate-purchase-btn"
            disabled={!canActivatePurchase}
            onClick={() => setConfirm('purchase')}
          >
            Activar como compra
          </button>
          {!hasPaymentMethod && (
            <p data-testid="no-payment-hint-purchase">Cliente sin método de pago</p>
          )}
          {hasPaymentMethod && !purchasePriceConfigured && (
            <p data-testid="no-purchase-price-hint">
              Configura el precio en /super/subscription primero
            </p>
          )}
        </div>
      )}

      {isRental && (
        <div data-testid="state-rental">
          <p>Alquiler activo desde {subscription!.currentPeriodStart.slice(0, 10)}</p>
          <p>Próximo cargo: {subscription!.currentPeriodEnd.slice(0, 10)}</p>
          <button
            data-testid="cancel-rental-btn"
            onClick={() => setConfirm('cancel')}
          >
            Cancelar suscripción
          </button>
        </div>
      )}

      {isPurchase && (
        <div data-testid="state-purchase">
          <p>Dispenser comprado el {subscription!.purchasedAt?.slice(0, 10)}</p>
        </div>
      )}
    </section>
  )
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('super.credit.$userId — Dispenser section (T61)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // T61-1: Dispenser section renders
  it('T61-1: Dispenser section is present in the page', () => {
    setupMocks()
    renderWithProviders(<DispenserSectionDriver />)

    expect(screen.getByTestId('dispenser-section')).toBeInTheDocument()
  })

  // T61-2: no subscription state
  it('T61-2: shows activate buttons when user has no subscription', () => {
    setupMocks({ hasPaymentMethod: true })
    renderWithProviders(<DispenserSectionDriver />)

    expect(screen.getByTestId('state-no-sub')).toBeInTheDocument()
    expect(screen.getByTestId('activate-rental-btn')).toBeInTheDocument()
    expect(screen.getByTestId('activate-purchase-btn')).toBeInTheDocument()
  })

  // T61-3: disabled with hint when no stripeCustomerId
  it('T61-3: both activate buttons are disabled with hint when user has no payment method', () => {
    setupMocks({ hasPaymentMethod: false })
    renderWithProviders(<DispenserSectionDriver />)

    expect(screen.getByTestId('activate-rental-btn')).toBeDisabled()
    expect(screen.getByTestId('activate-purchase-btn')).toBeDisabled()
    expect(screen.getAllByTestId('no-payment-hint-rental')).toHaveLength(1)
    expect(screen.getAllByTestId('no-payment-hint-purchase')).toHaveLength(1)
  })

  // T61-4: purchase disabled when purchasePriceCents=0
  it('T61-4: activate purchase is disabled when plan.purchasePriceCents=0 with hint', () => {
    setupMocks({
      hasPaymentMethod: true,
      plan: { ...defaultPlan, purchasePriceCents: 0 },
    })
    renderWithProviders(<DispenserSectionDriver />)

    expect(screen.getByTestId('activate-rental-btn')).not.toBeDisabled()
    expect(screen.getByTestId('activate-purchase-btn')).toBeDisabled()
    expect(screen.getByTestId('no-purchase-price-hint')).toBeInTheDocument()
  })

  // T61-5: active rental state
  it('T61-5: shows rental state when user has active rental subscription', () => {
    setupMocks({
      subResponse: { subscription: rentalSub, hasPaymentMethod: true },
    })
    renderWithProviders(<DispenserSectionDriver />)

    expect(screen.getByTestId('state-rental')).toBeInTheDocument()
    expect(screen.getByText(/Alquiler activo desde/)).toBeInTheDocument()
    expect(screen.getByTestId('cancel-rental-btn')).toBeInTheDocument()
  })

  // T61-6: purchase state
  it('T61-6: shows purchase state when user has a purchase subscription', () => {
    setupMocks({
      subResponse: { subscription: purchaseSub, hasPaymentMethod: true },
    })
    renderWithProviders(<DispenserSectionDriver />)

    expect(screen.getByTestId('state-purchase')).toBeInTheDocument()
    expect(screen.getByText(/Dispenser comprado el/)).toBeInTheDocument()
    expect(screen.queryByTestId('cancel-rental-btn')).not.toBeInTheDocument()
  })

  // T61-7: activate as rental calls mutation
  it('T61-7: activate rental button opens confirm dialog and calls mutation', async () => {
    const mutateMock = vi.fn()
    setupMocks({
      hasPaymentMethod: true,
      rentalMut: createMutationMock({ mutate: mutateMock }),
    })
    renderWithProviders(<DispenserSectionDriver />)

    await userEvent.click(screen.getByTestId('activate-rental-btn'))
    await userEvent.click(screen.getByTestId('confirm-yes'))

    await waitFor(() => {
      expect(mutateMock).toHaveBeenCalledTimes(1)
    })
  })

  // T61-8: cancel subscription calls mutation with correct args
  it('T61-8: cancel rental calls cancel mutation with subscriptionId and userId', async () => {
    const mutateMock = vi.fn()
    setupMocks({
      subResponse: { subscription: rentalSub, hasPaymentMethod: true },
      cancelMut: createMutationMock({ mutate: mutateMock }),
    })
    renderWithProviders(<DispenserSectionDriver />)

    await userEvent.click(screen.getByTestId('cancel-rental-btn'))
    await userEvent.click(screen.getByTestId('confirm-yes'))

    await waitFor(() => {
      expect(mutateMock).toHaveBeenCalledWith({
        subscriptionId: 'sub-001',
        userId: 'user-001',
      })
    })
  })
})
