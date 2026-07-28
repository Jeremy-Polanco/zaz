import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../test/test-utils'
import type { Subscription, SubscriptionPlan } from '../lib/types'

// ── Module mocks ───────────────────────────────────────────────────────────────
// SubscriptionPage reads the Stripe return param through `Route.useSearch()`.
// Stubbing createFileRoute to hand back a `useSearch` lets the REAL page render
// — the previous suite gave up here and tested a copy of the branch logic.
const mockSearch: { session?: 'success' | 'canceled' } = {}

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const original = await importOriginal<typeof import('@tanstack/react-router')>()
  return {
    ...original,
    createFileRoute: () => () => ({ useSearch: () => mockSearch }),
    redirect: vi.fn(),
  }
})

vi.mock('../lib/queries', () => ({
  useMySubscription: vi.fn(),
  useSubscriptionPlan: vi.fn(),
  useCreateCheckoutSession: vi.fn(),
  useCreatePortalSession: vi.fn(),
  useCancelSubscription: vi.fn(),
  useReactivateSubscription: vi.fn(),
}))
vi.mock('../lib/api', () => ({ api: { get: vi.fn() }, TOKEN_KEY: 'dashgo.token' }))

import {
  useMySubscription,
  useSubscriptionPlan,
  useCreateCheckoutSession,
  useCreatePortalSession,
  useCancelSubscription,
  useReactivateSubscription,
} from '../lib/queries'
import { SUBSCRIPTION_PERKS, SubscriptionPage } from './subscription'

const mockSub = vi.mocked(useMySubscription)
const mockPlan = vi.mocked(useSubscriptionPlan)
const mockCheckout = vi.mocked(useCreateCheckoutSession)
const mockPortal = vi.mocked(useCreatePortalSession)
const mockCancel = vi.mocked(useCancelSubscription)
const mockReactivate = vi.mocked(useReactivateSubscription)

// ── Fixtures ───────────────────────────────────────────────────────────────────

const defaultPlan: SubscriptionPlan = {
  priceCents: 1000,
  currency: 'usd',
  interval: 'month',
}

function makeSub(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: 'sub_test_001',
    status: 'active',
    currentPeriodStart: '2026-01-01T00:00:00.000Z',
    currentPeriodEnd: '2026-02-01T00:00:00.000Z',
    cancelAtPeriodEnd: false,
    canceledAt: null,
    ...overrides,
  }
}

function mutationMock(isPending = false) {
  return {
    mutate: vi.fn(),
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending,
    reset: vi.fn(),
  }
}

type Mutations = {
  checkout?: ReturnType<typeof mutationMock>
  portal?: ReturnType<typeof mutationMock>
  cancel?: ReturnType<typeof mutationMock>
  reactivate?: ReturnType<typeof mutationMock>
}

function setup(
  opts: {
    sub?: Subscription | null
    subPending?: boolean
    planPending?: boolean
    refetch?: ReturnType<typeof vi.fn>
    session?: 'success' | 'canceled'
  } & Mutations = {},
) {
  mockSearch.session = opts.session

  mockSub.mockReturnValue({
    data: opts.sub ?? null,
    isPending: opts.subPending ?? false,
    isError: false,
    error: null,
    refetch: opts.refetch ?? vi.fn(),
  } as unknown as ReturnType<typeof useMySubscription>)

  mockPlan.mockReturnValue({
    data: opts.planPending ? undefined : defaultPlan,
    isPending: opts.planPending ?? false,
    isError: false,
    error: null,
  } as unknown as ReturnType<typeof useSubscriptionPlan>)

  const wire = <T,>(m: ReturnType<typeof mutationMock> | undefined) =>
    (m ?? mutationMock()) as unknown as T

  mockCheckout.mockReturnValue(wire(opts.checkout))
  mockPortal.mockReturnValue(wire(opts.portal))
  mockCancel.mockReturnValue(wire(opts.cancel))
  mockReactivate.mockReturnValue(wire(opts.reactivate))
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('subscription perks copy', () => {
  it('advertises the free bebedero alongside the other perks', () => {
    expect(SUBSCRIPTION_PERKS).toMatch(/bebedero/i)
    expect(SUBSCRIPTION_PERKS).toMatch(/gratis/i)
  })
})

describe('SubscriptionPage — loading', () => {
  beforeEach(() => vi.clearAllMocks())

  it('waits for the subscription query', () => {
    setup({ subPending: true })
    renderWithProviders(<SubscriptionPage />)

    expect(screen.getByText('Cargando suscripción…')).toBeInTheDocument()
  })

  // The plan drives the advertised price, so the page must wait for it too.
  it('waits for the plan query', () => {
    setup({ planPending: true })
    renderWithProviders(<SubscriptionPage />)

    expect(screen.getByText('Cargando suscripción…')).toBeInTheDocument()
  })
})

describe('SubscriptionPage — no subscription', () => {
  beforeEach(() => vi.clearAllMocks())

  it('advertises the plan price and the perks', () => {
    setup({ sub: null })
    renderWithProviders(<SubscriptionPage />)

    expect(screen.getByText('$10.00 / mes')).toBeInTheDocument()
    // The perks are pitched twice: in the section subtitle and in the offer card.
    expect(screen.getAllByText(new RegExp(SUBSCRIPTION_PERKS))).toHaveLength(2)
    expect(screen.getByText(/Cancela cuando quieras/)).toBeInTheDocument()
  })

  it('starts checkout from the subscribe button', async () => {
    const checkout = mutationMock()
    setup({ sub: null, checkout })
    renderWithProviders(<SubscriptionPage />)

    await userEvent.click(screen.getByRole('button', { name: 'Suscribirme' }))

    expect(checkout.mutate).toHaveBeenCalledWith({})
  })

  it('shows "Redirigiendo…" and blocks a second click while checkout is in flight', () => {
    setup({ sub: null, checkout: mutationMock(true) })
    renderWithProviders(<SubscriptionPage />)

    expect(screen.getByRole('button', { name: 'Redirigiendo…' })).toBeDisabled()
  })
})

describe('SubscriptionPage — active and auto-renewing', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows the Activa badge and the renewal date', () => {
    setup({ sub: makeSub() })
    renderWithProviders(<SubscriptionPage />)

    expect(screen.getByText('Activa')).toBeInTheDocument()
    expect(screen.getByText(/Renueva el/)).toBeInTheDocument()
  })

  it('opens the Stripe portal', async () => {
    const portal = mutationMock()
    setup({ sub: makeSub(), portal })
    renderWithProviders(<SubscriptionPage />)

    await userEvent.click(
      screen.getByRole('button', { name: 'Gestionar suscripción' }),
    )

    expect(portal.mutate).toHaveBeenCalled()
  })

  // The old suite discarded this mutation entirely (`void cancel`), so the
  // cancel path of the whole subscription flow had zero coverage.
  it('cancels the subscription', async () => {
    const cancel = mutationMock()
    setup({ sub: makeSub(), cancel })
    renderWithProviders(<SubscriptionPage />)

    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(cancel.mutate).toHaveBeenCalled()
  })

  it('shows "Cancelando…" while the cancel is in flight', () => {
    setup({ sub: makeSub(), cancel: mutationMock(true) })
    renderWithProviders(<SubscriptionPage />)

    expect(screen.getByRole('button', { name: 'Cancelando…' })).toBeDisabled()
  })
})

describe('SubscriptionPage — cancellation scheduled', () => {
  beforeEach(() => vi.clearAllMocks())

  it('says it will not renew and keeps the perks until the end date', () => {
    setup({ sub: makeSub({ cancelAtPeriodEnd: true }) })
    renderWithProviders(<SubscriptionPage />)

    expect(screen.getByText(/no se renovará/)).toBeInTheDocument()
    expect(screen.getByText(/hasta esa fecha/)).toBeInTheDocument()
  })

  it('reactivates the subscription', async () => {
    const reactivate = mutationMock()
    setup({ sub: makeSub({ cancelAtPeriodEnd: true }), reactivate })
    renderWithProviders(<SubscriptionPage />)

    await userEvent.click(screen.getByRole('button', { name: 'Reactivar' }))

    expect(reactivate.mutate).toHaveBeenCalled()
  })
})

describe('SubscriptionPage — unhealthy states', () => {
  beforeEach(() => vi.clearAllMocks())

  it('tells a past_due customer to update their payment method', () => {
    setup({ sub: makeSub({ status: 'past_due' }) })
    renderWithProviders(<SubscriptionPage />)

    expect(screen.getByText(/Tu pago está pendiente/)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Gestionar suscripción' }),
    ).toBeInTheDocument()
  })

  it('offers to re-subscribe once the subscription ended', async () => {
    const checkout = mutationMock()
    setup({ sub: makeSub({ status: 'canceled' }), checkout })
    renderWithProviders(<SubscriptionPage />)

    expect(screen.getByText('Tu suscripción terminó.')).toBeInTheDocument()
    await userEvent.click(
      screen.getByRole('button', { name: 'Suscribirme de nuevo' }),
    )
    expect(checkout.mutate).toHaveBeenCalledWith({})
  })

  // incomplete / incomplete_expired / unpaid all fall through to the same
  // branch — which no test exercised before, in the driver or the real page.
  it.each(['incomplete', 'incomplete_expired', 'unpaid'] as const)(
    'falls back to "gestioná tu cuenta" for %s',
    (status) => {
      setup({ sub: makeSub({ status }) })
      renderWithProviders(<SubscriptionPage />)

      expect(
        screen.getByText(/Tu suscripción no está activa/),
      ).toBeInTheDocument()
    },
  )
})

// ---------------------------------------------------------------------------
// Returning from Stripe. The old suite skipped this outright ("covered in
// integration/e2e") — but the refetch is what replaces the stale "no tenés
// suscripción" state with the freshly paid one.
// ---------------------------------------------------------------------------

describe('SubscriptionPage — returning from Stripe', () => {
  beforeEach(() => vi.clearAllMocks())

  it('congratulates the customer and refetches after a successful checkout', async () => {
    const refetch = vi.fn().mockResolvedValue({})
    setup({ sub: makeSub(), session: 'success', refetch })
    renderWithProviders(<SubscriptionPage />)

    expect(
      screen.getByText(`¡Suscripción activada! ${SUBSCRIPTION_PERKS}`),
    ).toBeInTheDocument()
    await waitFor(() => expect(refetch).toHaveBeenCalled())
  })

  it('refetches after an abandoned checkout, without congratulating anyone', async () => {
    const refetch = vi.fn().mockResolvedValue({})
    setup({ sub: null, session: 'canceled', refetch })
    renderWithProviders(<SubscriptionPage />)

    await waitFor(() => expect(refetch).toHaveBeenCalled())
    expect(screen.queryByText(/¡Suscripción activada!/)).not.toBeInTheDocument()
  })

  it('does not refetch on a normal visit', async () => {
    const refetch = vi.fn()
    setup({ sub: makeSub(), refetch })
    renderWithProviders(<SubscriptionPage />)

    await waitFor(() => expect(screen.getByText('Activa')).toBeInTheDocument())
    expect(refetch).not.toHaveBeenCalled()
  })
})
