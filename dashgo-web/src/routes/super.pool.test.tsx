import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, within } from '@testing-library/react'
import { renderWithProviders } from '../test/test-utils'
import type { PoolDistribution, PoolSummary } from '../lib/types'

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
  usePoolSummary: vi.fn(),
  usePoolDistributions: vi.fn(),
}))

vi.mock('../lib/api', () => ({
  api: { get: vi.fn() },
  TOKEN_KEY: 'dashgo.token',
}))

import { usePoolDistributions, usePoolSummary } from '../lib/queries'
import { SuperPoolPage } from './super.pool'

const mockUseSummary = vi.mocked(usePoolSummary)
const mockUseDistributions = vi.mocked(usePoolDistributions)

const SUMMARY: PoolSummary = {
  quarter: '2026-Q4',
  poolCents: 12345,
  associateCount: 3,
  estimatedShareCents: 4115,
  nextDistributionAt: '2027-01-01T05:00:00.000Z',
}

const DISTRIBUTION: PoolDistribution = {
  id: 'd-1',
  quarter: '1999-Q3',
  totalCents: 10001,
  associateCount: 3,
  shareCents: 3333,
  remainderCents: 2,
  createdAt: '1999-10-01T04:00:00.000Z',
}

describe('SuperPoolPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseSummary.mockReturnValue({
      data: SUMMARY,
      isPending: false,
    } as unknown as ReturnType<typeof usePoolSummary>)
  })

  it('pide el resumen habilitado (el super admin puede verlo) y muestra el pool en curso', () => {
    mockUseDistributions.mockReturnValue({
      data: [],
      isPending: false,
    } as unknown as ReturnType<typeof usePoolDistributions>)
    renderWithProviders(<SuperPoolPage />)

    expect(mockUseSummary).toHaveBeenCalledWith(true)
    expect(screen.getByText('$123.45')).toBeInTheDocument()
    expect(screen.getByText('1 de enero de 2027')).toBeInTheDocument()
    expect(screen.getByText('Aún no se hizo ningún reparto.')).toBeInTheDocument()
  })

  it('la tabla de repartos muestra trimestre, total, asociados, parte c/u y arrastre', () => {
    mockUseDistributions.mockReturnValue({
      data: [DISTRIBUTION],
      isPending: false,
    } as unknown as ReturnType<typeof usePoolDistributions>)
    renderWithProviders(<SuperPoolPage />)

    const row = screen.getByText('3.º trimestre 1999').closest('tr') as HTMLElement
    expect(within(row).getByText('$100.01')).toBeInTheDocument()
    expect(within(row).getByText('3')).toBeInTheDocument()
    expect(within(row).getByText('$33.33')).toBeInTheDocument()
    expect(within(row).getByText('$0.02')).toBeInTheDocument()
  })
})
