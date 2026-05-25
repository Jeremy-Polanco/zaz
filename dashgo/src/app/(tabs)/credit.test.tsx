/**
 * credit screen tests — 5 states.
 *
 * We mock the queries module entirely so the screen never calls the real API.
 * States:
 *   1. none       — no credit account (data.balanceCents = null)
 *   2. active     — has account, positive available balance
 *   3. overdue    — has account, status = 'overdue'
 *   4. loading    — isPending = true (spinner visible)
 *   5. empty-movements — account exists but no movements
 */
import React from 'react'
import { renderWithProviders } from '../../test/test-utils'

// Hoist mock declarations (jest.mock is hoisted above imports)
jest.mock('../../lib/queries', () => ({
  useMyCredit: jest.fn(),
  useCurrentUser: jest.fn(() => ({ data: { creditLocked: false } })),
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
    Eyebrow: ({ children, className }: { children: React.ReactNode; className?: string }) => (
      <Text>{children}</Text>
    ),
    Hairline: () => <View />,
    Button: ({ children, onPress }: { children: React.ReactNode; onPress?: () => void }) => (
      <Text onPress={onPress}>{children}</Text>
    ),
  }
})

import { useMyCredit } from '../../lib/queries'
import CreditTab from './credit'
import type { MyCreditResponse } from '../../lib/types'

const mockUseMyCredit = useMyCredit as jest.MockedFunction<typeof useMyCredit>

function makeCreditData(overrides: Partial<MyCreditResponse> = {}): MyCreditResponse {
  return {
    balanceCents: 0,
    creditLimitCents: 10000,
    dueDate: null,
    status: 'active',
    amountOwedCents: 0,
    locked: false,
    movements: [],
    ...overrides,
  }
}

type MockReturn = {
  data: MyCreditResponse | undefined
  isPending: boolean
  refetch: jest.Mock
  isRefetching: boolean
}

function setupMock(overrides: Partial<MockReturn> = {}) {
  mockUseMyCredit.mockReturnValue({
    data: makeCreditData(),
    isPending: false,
    refetch: jest.fn(),
    isRefetching: false,
    ...overrides,
  } as unknown as ReturnType<typeof useMyCredit>)
}

afterEach(() => {
  jest.clearAllMocks()
})

describe('CreditTab — state: loading', () => {
  it('shows an ActivityIndicator while pending', () => {
    setupMock({ isPending: true, data: undefined })
    const { UNSAFE_getByType } = renderWithProviders(<CreditTab />)
    const { ActivityIndicator } = require('react-native')
    expect(UNSAFE_getByType(ActivityIndicator)).toBeTruthy()
  })
})

describe('CreditTab — state: none (no account)', () => {
  it('shows "Sin cuenta de crédito" when balanceCents is null', () => {
    setupMock({
      data: makeCreditData({ balanceCents: null, creditLimitCents: null, status: 'none' }),
    })
    const { getByText } = renderWithProviders(<CreditTab />)
    expect(getByText('Sin cuenta de crédito')).toBeTruthy()
  })
})

describe('CreditTab — state: active (has account)', () => {
  it('shows "Disponible" label when account exists', () => {
    setupMock({
      data: makeCreditData({
        balanceCents: 5000,
        creditLimitCents: 10000,
        status: 'active',
      }),
    })
    const { getByText } = renderWithProviders(<CreditTab />)
    expect(getByText('Disponible')).toBeTruthy()
  })

  it('shows "Balance" label when account exists', () => {
    setupMock({
      data: makeCreditData({ balanceCents: 5000, creditLimitCents: 10000 }),
    })
    const { getByText } = renderWithProviders(<CreditTab />)
    expect(getByText('Balance')).toBeTruthy()
  })

  it('shows "Límite" label when account exists', () => {
    setupMock({
      data: makeCreditData({ balanceCents: 5000, creditLimitCents: 10000 }),
    })
    const { getByText } = renderWithProviders(<CreditTab />)
    expect(getByText('Límite')).toBeTruthy()
  })
})

describe('CreditTab — state: overdue', () => {
  it('shows overdue warning text when status is overdue', () => {
    setupMock({
      data: makeCreditData({
        balanceCents: -2000,
        creditLimitCents: 10000,
        status: 'overdue',
      }),
    })
    const { getByText } = renderWithProviders(<CreditTab />)
    expect(
      getByText(/Cuenta vencida/),
    ).toBeTruthy()
  })
})

describe('CreditTab — state: empty movements', () => {
  it('shows "Sin movimientos" when account exists but has no history', () => {
    setupMock({
      data: makeCreditData({ balanceCents: 0, creditLimitCents: 5000, movements: [] }),
    })
    const { getByText } = renderWithProviders(<CreditTab />)
    expect(getByText('Sin movimientos')).toBeTruthy()
  })
})
