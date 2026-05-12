/**
 * subscription screen tests — 5 states + deep-link return.
 *
 * We mock all queries and expo-router hooks to control each UI state.
 *
 * States tested:
 *   1. loading         — isPending = true
 *   2. none            — sub = null
 *   3. active          — status='active', cancelAtPeriodEnd=false
 *   4. cancel-pending  — status='active', cancelAtPeriodEnd=true
 *   5. past_due        — status='past_due'
 *   6. canceled        — status='canceled'
 * Deep-link return:
 *   7. success=1 param → toast visible + refetch called
 */
import React from 'react'
import { renderWithProviders } from '../../test/test-utils'

// ── module mocks (hoisted) ────────────────────────────────────────────────────

jest.mock('../../lib/queries', () => ({
  useMySubscription: jest.fn(),
  useSubscriptionPlan: jest.fn(),
  useCreateCheckoutSession: jest.fn(),
  useCreatePortalSession: jest.fn(),
  useCancelSubscription: jest.fn(),
  useReactivateSubscription: jest.fn(),
}))

jest.mock('../../lib/api', () => ({
  API_URL: 'http://localhost:3000',
  api: {
    get: jest.fn(),
    post: jest.fn(),
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
  },
}))

jest.mock('../../lib/format', () => ({
  formatCents: (v: number) => `$${(v / 100).toFixed(2)}`,
  formatDate: (d: string) => d,
}))

jest.mock('../../components/ui', () => {
  const { Text, View } = require('react-native')
  return {
    Button: ({ children, onPress }: { children: React.ReactNode; onPress?: () => void }) => (
      <Text onPress={onPress}>{children}</Text>
    ),
    Eyebrow: ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>,
    Hairline: () => <View />,
  }
})

// expo-router is already mocked in setup.ts but we need to control
// useLocalSearchParams per test — override here.
jest.mock('expo-router', () => {
  const { useEffect } = require('react')
  const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn() }
  return {
    router: mockRouter,
    useRouter: () => mockRouter,
    // useFocusEffect must behave like useEffect (post-render) to avoid
    // "too many re-renders" from setState calls inside the callback.
    useFocusEffect: jest.fn((cb: () => unknown) => {
      useEffect(() => {
        const cleanup = cb()
        if (typeof cleanup === 'function') return cleanup
      // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])
    }),
    useLocalSearchParams: jest.fn(() => ({})),
    Link: 'Link',
  }
})

// ── imports after mocks ───────────────────────────────────────────────────────

import {
  useMySubscription,
  useSubscriptionPlan,
  useCreateCheckoutSession,
  useCreatePortalSession,
  useCancelSubscription,
  useReactivateSubscription,
} from '../../lib/queries'
import { useLocalSearchParams, useFocusEffect } from 'expo-router'
import SubscriptionTab from './subscription'
import type { Subscription, SubscriptionPlan } from '../../lib/types'

// ── typed mock helpers ────────────────────────────────────────────────────────

const mockUseMySubscription = useMySubscription as jest.MockedFunction<typeof useMySubscription>
const mockUseSubscriptionPlan = useSubscriptionPlan as jest.MockedFunction<typeof useSubscriptionPlan>
const mockUseCreateCheckoutSession = useCreateCheckoutSession as jest.MockedFunction<typeof useCreateCheckoutSession>
const mockUseCreatePortalSession = useCreatePortalSession as jest.MockedFunction<typeof useCreatePortalSession>
const mockUseCancelSubscription = useCancelSubscription as jest.MockedFunction<typeof useCancelSubscription>
const mockUseReactivateSubscription = useReactivateSubscription as jest.MockedFunction<typeof useReactivateSubscription>
const mockSearchParams = useLocalSearchParams as jest.MockedFunction<typeof useLocalSearchParams>
// useFocusEffect is mocked as useEffect in the jest.mock factory above — no per-test override needed
void useFocusEffect // keep the import to avoid TS unused warning

const mockPlan: SubscriptionPlan = { priceCents: 1000, currency: 'usd', interval: 'month' }

function makeSub(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: 'sub-1',
    status: 'active',
    currentPeriodStart: '2024-01-01T00:00:00Z',
    currentPeriodEnd: '2024-02-01T00:00:00Z',
    cancelAtPeriodEnd: false,
    canceledAt: null,
    ...overrides,
  }
}

type SubQueryMock = {
  data: Subscription | null | undefined
  isPending: boolean
  refetch: jest.Mock
}

function setupMocks(
  subOverrides: Partial<SubQueryMock> = {},
  searchParams: Record<string, string> = {},
) {
  const refetch = jest.fn().mockResolvedValue(undefined)

  mockUseMySubscription.mockReturnValue({
    data: null,
    isPending: false,
    refetch,
    ...subOverrides,
  } as unknown as ReturnType<typeof useMySubscription>)

  mockUseSubscriptionPlan.mockReturnValue({
    data: mockPlan,
    isPending: false,
  } as unknown as ReturnType<typeof useSubscriptionPlan>)

  const noopMutation = {
    mutate: jest.fn(),
    mutateAsync: jest.fn().mockResolvedValue({ url: 'https://stripe.test' }),
    isPending: false,
    isLoading: false,
  }
  mockUseCreateCheckoutSession.mockReturnValue(noopMutation as unknown as ReturnType<typeof useCreateCheckoutSession>)
  mockUseCreatePortalSession.mockReturnValue(noopMutation as unknown as ReturnType<typeof useCreatePortalSession>)
  mockUseCancelSubscription.mockReturnValue(noopMutation as unknown as ReturnType<typeof useCancelSubscription>)
  mockUseReactivateSubscription.mockReturnValue(noopMutation as unknown as ReturnType<typeof useReactivateSubscription>)

  mockSearchParams.mockReturnValue(searchParams as ReturnType<typeof useLocalSearchParams>)

  return { refetch }
}

afterEach(() => {
  jest.clearAllMocks()
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SubscriptionTab — state: loading', () => {
  it('shows ActivityIndicator while pending', () => {
    setupMocks({ isPending: true, data: undefined })
    const { UNSAFE_getByType } = renderWithProviders(<SubscriptionTab />)
    const { ActivityIndicator } = require('react-native')
    expect(UNSAFE_getByType(ActivityIndicator)).toBeTruthy()
  })
})

describe('SubscriptionTab — state: none (no subscription)', () => {
  it('shows subscription plan price and subscribe button', () => {
    setupMocks({ data: null })
    const { getByText } = renderWithProviders(<SubscriptionTab />)
    expect(getByText('$10.00 / mes')).toBeTruthy()
    expect(getByText('Suscribirme')).toBeTruthy()
  })
})

describe('SubscriptionTab — state: active (auto-renewing)', () => {
  it('shows "Activa" badge', () => {
    setupMocks({ data: makeSub({ status: 'active', cancelAtPeriodEnd: false }) })
    const { getByText } = renderWithProviders(<SubscriptionTab />)
    expect(getByText('Activa')).toBeTruthy()
  })

  it('shows manage and cancel buttons', () => {
    setupMocks({ data: makeSub({ status: 'active', cancelAtPeriodEnd: false }) })
    const { getByText } = renderWithProviders(<SubscriptionTab />)
    expect(getByText('Gestionar suscripción')).toBeTruthy()
    expect(getByText('Cancelar')).toBeTruthy()
  })
})

describe('SubscriptionTab — state: cancel-pending', () => {
  it('shows "no se renovará" notice', () => {
    setupMocks({
      data: makeSub({ status: 'active', cancelAtPeriodEnd: true }),
    })
    const { getByText } = renderWithProviders(<SubscriptionTab />)
    expect(getByText(/no se renovará/)).toBeTruthy()
  })

  it('shows reactivate button', () => {
    setupMocks({ data: makeSub({ status: 'active', cancelAtPeriodEnd: true }) })
    const { getByText } = renderWithProviders(<SubscriptionTab />)
    expect(getByText('Reactivar')).toBeTruthy()
  })
})

describe('SubscriptionTab — state: past_due', () => {
  it('shows payment pending message', () => {
    setupMocks({ data: makeSub({ status: 'past_due' }) })
    const { getByText } = renderWithProviders(<SubscriptionTab />)
    expect(getByText('Tu pago está pendiente.')).toBeTruthy()
  })
})

describe('SubscriptionTab — state: canceled', () => {
  it('shows "Tu suscripción terminó"', () => {
    setupMocks({ data: makeSub({ status: 'canceled' }) })
    const { getByText } = renderWithProviders(<SubscriptionTab />)
    expect(getByText('Tu suscripción terminó.')).toBeTruthy()
  })

  it('shows re-subscribe button', () => {
    setupMocks({ data: makeSub({ status: 'canceled' }) })
    const { getByText } = renderWithProviders(<SubscriptionTab />)
    expect(getByText('Suscribirme de nuevo')).toBeTruthy()
  })
})

// ── T63 — Phase 11: copy cleanup ─────────────────────────────────────────────

describe('SubscriptionTab — Phase 11 copy cleanup (T63)', () => {
  it('does NOT show "Envío gratis" anywhere in the subscription screen', () => {
    setupMocks({ data: null })
    const { queryByText } = renderWithProviders(<SubscriptionTab />)
    expect(queryByText(/envío gratis/i)).toBeNull()
  })

  it('shows rental-context copy in the header subtitle', () => {
    setupMocks({ data: null })
    const { queryAllByText } = renderWithProviders(<SubscriptionTab />)
    expect(queryAllByText(/dispensador/i).length).toBeGreaterThan(0)
  })

  it('does NOT show "Envío gratis" in the cancel-pending state', () => {
    setupMocks({ data: makeSub({ status: 'active', cancelAtPeriodEnd: true }) })
    const { queryByText } = renderWithProviders(<SubscriptionTab />)
    expect(queryByText(/envío gratis/i)).toBeNull()
  })

  it('does NOT show "Envío gratis" in the past_due state', () => {
    setupMocks({ data: makeSub({ status: 'past_due' }) })
    const { queryByText } = renderWithProviders(<SubscriptionTab />)
    expect(queryByText(/envío gratis/i)).toBeNull()
  })

  it('shows success toast with rental copy (not free-shipping copy)', () => {
    setupMocks({ data: makeSub({ status: 'active' }) }, { success: '1' })
    const { queryByText } = renderWithProviders(<SubscriptionTab />)
    expect(queryByText(/envío gratis/i)).toBeNull()
  })
})

describe('SubscriptionTab — deep-link return (success=1)', () => {
  beforeAll(() => {
    jest.useFakeTimers()
  })
  afterAll(() => {
    jest.useRealTimers()
  })
  afterEach(() => {
    jest.clearAllTimers()
  })

  it('calls refetch when mounted with success param', () => {
    const { refetch } = setupMocks(
      { data: makeSub({ status: 'active' }) },
      { success: '1' },
    )
    renderWithProviders(<SubscriptionTab />)
    // useFocusEffect is mocked as useEffect — fires synchronously inside RNTL's act wrapper
    expect(refetch).toHaveBeenCalled()
  })

  it('shows success toast when success=1 is in search params', () => {
    setupMocks({ data: makeSub({ status: 'active' }) }, { success: '1' })
    const { getByText } = renderWithProviders(<SubscriptionTab />)
    expect(getByText(/¡Suscripción activada!/)).toBeTruthy()
  })

  it('does NOT show toast when no success param', () => {
    setupMocks({ data: makeSub({ status: 'active' }) }, {})
    const { queryByText } = renderWithProviders(<SubscriptionTab />)
    expect(queryByText(/¡Suscripción activada!/)).toBeNull()
  })
})
