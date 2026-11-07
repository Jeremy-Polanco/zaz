import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '../test/test-utils'
import type { AssociateBalance, AuthUser, PoolSummary } from '../lib/types'

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
  useCurrentUser: vi.fn(),
  useMyAssociateBalance: vi.fn(),
  usePoolSummary: vi.fn(),
}))

vi.mock('../lib/api', () => ({
  api: { get: vi.fn() },
  TOKEN_KEY: 'dashgo.token',
}))

import { useCurrentUser, useMyAssociateBalance, usePoolSummary } from '../lib/queries'
import { PoolPage } from './pool'

const mockUseCurrentUser = vi.mocked(useCurrentUser)
const mockUseBalance = vi.mocked(useMyAssociateBalance)
const mockUseSummary = vi.mocked(usePoolSummary)

function mkMe(role: AuthUser['role']): AuthUser {
  return {
    id: 'u-1',
    email: null,
    fullName: 'Persona',
    phone: null,
    role,
    addressDefault: null,
    activeLocationId: null,
    referralCode: null,
    creditLocked: false,
  }
}

const SUMMARY: PoolSummary = {
  quarter: '2026-Q4',
  poolCents: 12345,
  associateCount: 3,
  estimatedShareCents: 4115,
  nextDistributionAt: '2027-01-01T05:00:00.000Z',
}

function setup(role: AuthUser['role'], balance: AssociateBalance, summary?: PoolSummary) {
  mockUseCurrentUser.mockReturnValue({ data: mkMe(role) } as unknown as ReturnType<
    typeof useCurrentUser
  >)
  mockUseBalance.mockReturnValue({
    data: balance,
    isPending: false,
  } as unknown as ReturnType<typeof useMyAssociateBalance>)
  mockUseSummary.mockReturnValue({
    data: summary,
    isPending: false,
  } as unknown as ReturnType<typeof usePoolSummary>)
}

describe('PoolPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('al asociado le muestra el pool, el próximo reparto, cuántos son, su parte estimada y su saldo', () => {
    setup('associate', { balanceCents: 500, entries: [] }, SUMMARY)
    renderWithProviders(<PoolPage />)

    expect(screen.getByText('$123.45')).toBeInTheDocument()
    expect(screen.getByText('1 de enero de 2027')).toBeInTheDocument()
    expect(screen.getByText('3 asociados')).toBeInTheDocument()
    expect(screen.getByText('$41.15')).toBeInTheDocument()
    expect(screen.getByText('$5.00')).toBeInTheDocument()
    expect(mockUseSummary).toHaveBeenCalledWith(true)
  })

  it('a un cliente le muestra el saldo y NO pide el resumen (la API lo rechaza con 403)', () => {
    setup('client', { balanceCents: 800, entries: [] })
    renderWithProviders(<PoolPage />)

    expect(screen.getByText('$8.00')).toBeInTheDocument()
    expect(screen.queryByText('Tu parte estimada')).not.toBeInTheDocument()
    expect(mockUseSummary).toHaveBeenCalledWith(false)
    expect(mockUseSummary).not.toHaveBeenCalledWith(true)
  })

  it('el historial muestra la asignación con su trimestre y el canje con su orden', () => {
    setup('associate', {
      balanceCents: 500,
      entries: [
        {
          id: 'e-1',
          type: 'allocation',
          amountCents: 1000,
          orderId: null,
          quarter: '2026-Q3',
          createdAt: '2026-10-01T04:00:00.000Z',
        },
        {
          id: 'e-2',
          type: 'redemption',
          amountCents: -500,
          orderId: 'abcdef12-0000-0000-0000-000000000000',
          quarter: null,
          createdAt: '2026-10-05T14:00:00.000Z',
        },
      ],
    }, SUMMARY)
    renderWithProviders(<PoolPage />)

    expect(screen.getByText('Reparto del 3.º trimestre 2026')).toBeInTheDocument()
    expect(screen.getByText('+$10.00')).toBeInTheDocument()
    expect(screen.getByText('Canje en el pedido #ABCDEF12')).toBeInTheDocument()
    expect(screen.getByText('-$5.00')).toBeInTheDocument()
  })

  it('sin movimientos lo dice', () => {
    setup('client', { balanceCents: 0, entries: [] })
    renderWithProviders(<PoolPage />)
    expect(screen.getByText('Todavía no tienes movimientos.')).toBeInTheDocument()
  })
})
