import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../test/test-utils'
import type { AdminPlanResponse } from '../lib/types'

// ── Module mocks ───────────────────────────────────────────────────────────────
// The stub CAPTURES the options handed to createFileRoute, so the route guard
// can be asserted for real further down instead of merely checking that the
// module loads.
// `vi.hoisted` runs before the mocked imports do. A plain const would still be
// in its temporal dead zone here, because createFileRoute is invoked at the
// route module's IMPORT time, not at render time.
const { mockRouteOptions } = vi.hoisted(() => ({
  mockRouteOptions: { current: null as Record<string, unknown> | null },
}))

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const original = await importOriginal<typeof import('@tanstack/react-router')>()
  return {
    ...original,
    createFileRoute: () => (options: Record<string, unknown>) => {
      mockRouteOptions.current = options
      return {}
    },
    redirect: vi.fn((opts) => ({ __redirect: opts })),
    isRedirect: vi.fn(() => false),
  }
})

vi.mock('../lib/queries', () => ({
  useAdminSubscriptionPlan: vi.fn(),
  useUpdateSubscriptionPlan: vi.fn(),
  // La tarjeta del plan Premium vive en la misma página.
  useAdminSubscriptionPlans: vi.fn(() => ({ data: [], isPending: false })),
  useCreateSubscriptionPlan: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
}))
vi.mock('../lib/api', () => ({
  api: { get: vi.fn(), put: vi.fn() },
  TOKEN_KEY: 'dashgo.token',
}))

import {
  useAdminSubscriptionPlan,
  useUpdateSubscriptionPlan,
} from '../lib/queries'
import { SuperSubscriptionPage } from './super.subscription'

const mockUsePlan = vi.mocked(useAdminSubscriptionPlan)
const mockUseMutation = vi.mocked(useUpdateSubscriptionPlan)

// ── Fixtures ───────────────────────────────────────────────────────────────────

const defaultPlan: AdminPlanResponse = {
  id: 'plan-uuid-001',
  tier: 'standard' as const,
  stripeProductId: 'prod_test001',
  activeStripePriceId: 'price_test001',
  unitAmountCents: 1000,
  grossAmountCents: 1089,
  currency: 'usd',
  interval: 'month',
  updatedAt: '2026-05-01T00:00:00.000Z',
}

function createMutationMock(
  overrides: Partial<{
    mutate: ReturnType<typeof vi.fn>
    isPending: boolean
    isSuccess: boolean
    isError: boolean
    error: { message: string } | null
  }> = {},
) {
  return {
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    isSuccess: false,
    isError: false,
    error: null,
    reset: vi.fn(),
    ...overrides,
  }
}

function setup({
  plan = defaultPlan,
  planPending = false,
  mutation = createMutationMock(),
}: {
  plan?: AdminPlanResponse | null
  planPending?: boolean
  mutation?: ReturnType<typeof createMutationMock>
} = {}) {
  mockUsePlan.mockReturnValue({
    data: planPending ? undefined : plan,
    isPending: planPending,
    isError: false,
    error: null,
  } as unknown as ReturnType<typeof useAdminSubscriptionPlan>)

  mockUseMutation.mockReturnValue(
    mutation as unknown as ReturnType<typeof useUpdateSubscriptionPlan>,
  )
  return mutation
}

const priceInput = () => screen.getByTestId('price-input')
const submit = () => screen.getByTestId('submit-btn')

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('SuperSubscriptionPage — current plan', () => {
  beforeEach(() => vi.clearAllMocks())

  it('waits for the plan query', () => {
    setup({ planPending: true })
    renderWithProviders(<SuperSubscriptionPage />)

    expect(screen.getByText('Cargando…')).toBeInTheDocument()
  })

  it('shows the net price and the tax-inclusive amount actually charged', () => {
    setup({ plan: { ...defaultPlan, unitAmountCents: 1000, grossAmountCents: 1089 } })
    renderWithProviders(<SuperSubscriptionPage />)

    expect(screen.getByTestId('current-price')).toHaveTextContent('$10.00')
    // The gross line is what the customer's card is charged — the old driver
    // did not render it at all.
    expect(screen.getByTestId('current-gross-price')).toHaveTextContent('$10.89')
  })

  it('falls back to a dash when no plan is configured yet', () => {
    setup({ plan: null })
    renderWithProviders(<SuperSubscriptionPage />)

    expect(screen.getByTestId('current-price')).toHaveTextContent('—')
  })

  it('states the billing currency and interval', () => {
    setup()
    renderWithProviders(<SuperSubscriptionPage />)

    expect(screen.getByText('USD / mes')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Validation. The form carries `noValidate`, so the browser's native
// constraint layer stays out of the way and zod owns the rules — otherwise
// min/max/step on the <input> would block the submit first and the admin would
// see the browser's own (English) tooltip instead of these messages.
// ---------------------------------------------------------------------------

describe('SuperSubscriptionPage — price validation', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each([
    ['0.50', /El precio mínimo es \$1\.00/],
    ['1500', /El precio máximo es \$1000\.00/],
    ['10.999', /Máximo 2 decimales/],
  ] as const)('rejects %s with the Spanish message', async (value, message) => {
    const mutation = setup()
    renderWithProviders(<SuperSubscriptionPage />)

    await userEvent.clear(priceInput())
    await userEvent.type(priceInput(), value)
    await userEvent.click(submit())

    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(mutation.mutate).not.toHaveBeenCalled()
  })

  it('rejects an empty price', async () => {
    const mutation = setup()
    renderWithProviders(<SuperSubscriptionPage />)

    await userEvent.clear(priceInput())
    await userEvent.click(submit())

    expect(
      await screen.findByText(/Ingresa un número válido/),
    ).toBeInTheDocument()
    expect(mutation.mutate).not.toHaveBeenCalled()
  })

  // Guards the fix itself: with native validation active the browser would
  // swallow the submit and none of the messages above could ever render.
  it('opts out of native constraint validation so zod can report', () => {
    setup()
    renderWithProviders(<SuperSubscriptionPage />)

    const form = (priceInput() as HTMLInputElement).form!
    expect(form.noValidate).toBe(true)
  })
})

describe('SuperSubscriptionPage — saving', () => {
  beforeEach(() => vi.clearAllMocks())

  it('submits the price converted to cents', async () => {
    const mutation = setup()
    renderWithProviders(<SuperSubscriptionPage />)

    await userEvent.clear(priceInput())
    await userEvent.type(priceInput(), '12.50')
    await userEvent.click(submit())

    await waitFor(() =>
      expect(mutation.mutate).toHaveBeenCalledWith(
        { unitAmountCents: 1250 },
        expect.anything(),
      ),
    )
  })

  it('rounds to the nearest cent rather than truncating', async () => {
    const mutation = setup()
    renderWithProviders(<SuperSubscriptionPage />)

    await userEvent.clear(priceInput())
    await userEvent.type(priceInput(), '19.99')
    await userEvent.click(submit())

    await waitFor(() =>
      expect(mutation.mutate).toHaveBeenCalledWith(
        { unitAmountCents: 1999 },
        expect.anything(),
      ),
    )
  })

  it('blocks the button and says "Guardando…" while saving', () => {
    setup({ mutation: createMutationMock({ isPending: true }) })
    renderWithProviders(<SuperSubscriptionPage />)

    expect(submit()).toBeDisabled()
    expect(submit()).toHaveTextContent('Guardando…')
    expect(screen.getByText('Procesando…')).toBeInTheDocument()
  })

  it('confirms success to the admin', () => {
    setup({ mutation: createMutationMock({ isSuccess: true }) })
    renderWithProviders(<SuperSubscriptionPage />)

    expect(
      screen.getByText('Precio actualizado correctamente.'),
    ).toBeInTheDocument()
  })

  it('surfaces a failed save', () => {
    setup({
      mutation: createMutationMock({
        isError: true,
        error: { message: 'Stripe rechazó el precio' },
      }),
    })
    renderWithProviders(<SuperSubscriptionPage />)

    expect(screen.getByTestId('mutation-error')).toHaveTextContent(
      'Stripe rechazó el precio',
    )
  })
})

// ---------------------------------------------------------------------------
// The live preview tells the admin what the customer will actually be charged
// before they save. It did not exist in the old driver.
// ---------------------------------------------------------------------------

describe('SuperSubscriptionPage — tax preview', () => {
  beforeEach(() => vi.clearAllMocks())

  it('previews the gross amount as the admin types', async () => {
    setup()
    renderWithProviders(<SuperSubscriptionPage />)

    await userEvent.clear(priceInput())
    await userEvent.type(priceInput(), '20')

    const preview = await screen.findByTestId('gross-preview')
    // 20.00 net + tax — the exact rate lives in lib/tax.ts; assert it is
    // strictly above the net price rather than hardcoding the percentage here.
    const shown = Number(preview.textContent!.match(/\$([\d.]+)/)![1])
    expect(shown).toBeGreaterThan(20)
  })

  it('hides the preview while the price is invalid', async () => {
    setup()
    renderWithProviders(<SuperSubscriptionPage />)

    await userEvent.clear(priceInput())
    await userEvent.type(priceInput(), '0.50')
    await userEvent.click(submit())

    await screen.findByText(/El precio mínimo es \$1\.00/)
    expect(screen.queryByTestId('gross-preview')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// The route guard. The previous version asserted `typeof Route === 'object'`,
// which stays green even if beforeLoad is deleted outright. Capturing the
// options handed to createFileRoute lets us assert the guard actually exists.
// ---------------------------------------------------------------------------

describe('super.subscription route — beforeLoad guard', () => {
  it('registers a beforeLoad guard on the route', async () => {
    await import('./super.subscription')

    expect(mockRouteOptions.current).not.toBeNull()
    expect(typeof mockRouteOptions.current!.beforeLoad).toBe('function')
  })
})
