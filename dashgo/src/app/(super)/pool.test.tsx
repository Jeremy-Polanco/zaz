/**
 * Panel del pool (mobile, super admin) — resumen del trimestre en curso y
 * lista de repartos. Español hardcodeado como sus hermanas de `(super)`.
 */
import React from 'react'
import { within } from '@testing-library/react-native'
import { renderWithProviders } from '../../test/test-utils'

jest.mock('../../lib/queries', () => ({
  usePoolSummary: jest.fn(),
  usePoolDistributions: jest.fn(),
}))

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: jest.fn(() => ({ top: 0, bottom: 0, left: 0, right: 0 })),
}))

import { usePoolDistributions, usePoolSummary } from '../../lib/queries'
import SuperPoolScreen from './pool'
import type { PoolDistribution, PoolSummary } from '../../lib/types'

const mockUseSummary = usePoolSummary as jest.MockedFunction<typeof usePoolSummary>
const mockUseDistributions = usePoolDistributions as jest.MockedFunction<typeof usePoolDistributions>

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

beforeEach(() => {
  jest.clearAllMocks()
  mockUseSummary.mockReturnValue({
    data: SUMMARY,
    isPending: false,
  } as unknown as ReturnType<typeof usePoolSummary>)
})

describe('(super)/pool', () => {
  it('pide el resumen habilitado y muestra el pool en curso', () => {
    mockUseDistributions.mockReturnValue({
      data: [],
      isPending: false,
    } as unknown as ReturnType<typeof usePoolDistributions>)
    const { getByText } = renderWithProviders(<SuperPoolScreen />)

    expect(mockUseSummary).toHaveBeenCalledWith(true)
    expect(getByText('$123.45')).toBeTruthy()
    expect(getByText('1 de enero de 2027')).toBeTruthy()
    expect(getByText('Aún no se hizo ningún reparto.')).toBeTruthy()
  })

  it('la fila del reparto muestra trimestre, total, asociados, parte c/u y arrastre', () => {
    mockUseDistributions.mockReturnValue({
      data: [DISTRIBUTION],
      isPending: false,
    } as unknown as ReturnType<typeof usePoolDistributions>)
    const { getByTestId } = renderWithProviders(<SuperPoolScreen />)

    const row = within(getByTestId('distribution-1999-Q3'))
    expect(row.getByText('3.º trimestre 1999')).toBeTruthy()
    expect(row.getByText('$100.01')).toBeTruthy()
    expect(row.getByText('3')).toBeTruthy()
    expect(row.getByText('$33.33')).toBeTruthy()
    expect(row.getByText('$0.02')).toBeTruthy()
  })
})
