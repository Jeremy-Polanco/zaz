/**
 * SuperRentalsScreen (mobile) — the "Alquileres" admin panel.
 *
 * Regression cover for a panel that lied: the screen fetched ONE 25-row page
 * and then computed "N resultados" and the Al día / Debiendo / En riesgo cards
 * from it. With chip "Todos" the owner saw "25 resultados · Al día 23"; with
 * chip "Activo", "25 resultados · Al día 25" — both describing the window, not
 * the business, and with no way to reach rental #26.
 *
 * The header count now comes from the server `total` and the cards from
 * GET /admin/rentals/summary (global, filter-independent).
 */
import React from 'react'
import { fireEvent, screen } from '@testing-library/react-native'
import { renderWithProviders } from '../../test/test-utils'

// ── module mocks ──────────────────────────────────────────────────────────────

jest.mock('../../lib/queries', () => ({
  useAdminRentals: jest.fn(),
  useAdminRentalsSummary: jest.fn(),
  useChargeLateFee: jest.fn(),
  useChargeTheftFee: jest.fn(),
  useCancelRental: jest.fn(),
  useRetryRentalSetup: jest.fn(),
  useResetMaintenance: jest.fn(),
}))

import {
  useAdminRentals,
  useAdminRentalsSummary,
  useCancelRental,
  useChargeLateFee,
  useChargeTheftFee,
  useResetMaintenance,
  useRetryRentalSetup,
} from '../../lib/queries'
import SuperRentalsScreen from './rentals'
import type { AdminRentalResponse, AdminRentalsSummary } from '../../lib/types'

const mockRentals = useAdminRentals as jest.MockedFunction<typeof useAdminRentals>
const mockSummary = useAdminRentalsSummary as jest.MockedFunction<
  typeof useAdminRentalsSummary
>

// ── fixtures ──────────────────────────────────────────────────────────────────

function makeRental(
  overrides: Partial<AdminRentalResponse> = {},
): AdminRentalResponse {
  return {
    id: 'rental-1',
    userId: 'user-1',
    userName: 'Ana Cliente',
    userPhone: '+18095550001',
    productId: 'prod-1',
    productName: 'Bebedero',
    status: 'active',
    monthlyRentCents: 2000,
    lateFeeCents: 0,
    theftFeeCents: 0,
    theftFeeChargedAt: null,
    stripeSubscriptionId: 'sub_1',
    currentPeriodEnd: '2026-06-01T00:00:00Z',
    activatedAt: '2026-05-01T00:00:00Z',
    canceledAt: null,
    nextMaintenanceAt: null,
    daysDelinquent: 0,
    createdAt: '2026-05-01T00:00:00Z',
    ...overrides,
  } as AdminRentalResponse
}

function makeSummary(
  overrides: Partial<AdminRentalsSummary> = {},
): AdminRentalsSummary {
  return {
    total: 0,
    byStatus: {
      active: 0,
      past_due: 0,
      unpaid: 0,
      pending_setup: 0,
      canceled: 0,
    },
    rentAtRiskCents: 0,
    ...overrides,
  }
}

function setup(
  opts: {
    rentals?: AdminRentalResponse[]
    /** Server-side count for the current filter. Defaults to the page length. */
    total?: number
    summary?: AdminRentalsSummary
    summaryPending?: boolean
  } = {},
) {
  const items = opts.rentals ?? []
  mockRentals.mockReturnValue({
    data: { items, total: opts.total ?? items.length },
    isPending: false,
    isRefetching: false,
    refetch: jest.fn(),
  } as unknown as ReturnType<typeof useAdminRentals>)

  mockSummary.mockReturnValue({
    data: opts.summaryPending ? undefined : (opts.summary ?? makeSummary()),
    isPending: opts.summaryPending ?? false,
  } as unknown as ReturnType<typeof useAdminRentalsSummary>)

  const mutation = {
    mutate: jest.fn(),
    mutateAsync: jest.fn().mockResolvedValue({}),
    isPending: false,
  }
  for (const hook of [
    useChargeLateFee,
    useChargeTheftFee,
    useCancelRental,
    useRetryRentalSetup,
    useResetMaintenance,
  ]) {
    ;(hook as jest.Mock).mockReturnValue(mutation)
  }
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('SuperRentalsScreen (mobile) — KPI cards', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('reads the cards from the summary endpoint, not from the fetched page', () => {
    setup({
      // The visible page is all cancelled; the cards must ignore it entirely.
      rentals: [
        makeRental({ id: 'r1', status: 'canceled', monthlyRentCents: 9900 }),
        makeRental({ id: 'r2', status: 'canceled', monthlyRentCents: 9900 }),
      ],
      total: 2,
      summary: makeSummary({
        total: 52,
        byStatus: {
          active: 40,
          past_due: 3,
          unpaid: 2,
          pending_setup: 0,
          canceled: 7,
        },
        rentAtRiskCents: 12500,
      }),
    })
    renderWithProviders(<SuperRentalsScreen />)

    expect(screen.getByText('40')).toBeTruthy() // Al día
    expect(screen.getByText('5')).toBeTruthy() // Debiendo = past_due + unpaid
    // formatMoney drops the cents on whole amounts: 12500 → "$125".
    expect(screen.getByText('$125')).toBeTruthy() // En riesgo
  })

  it('shows a placeholder instead of a wrong number while the summary loads', () => {
    setup({ rentals: [makeRental()], summaryPending: true })
    renderWithProviders(<SuperRentalsScreen />)

    // Three cards, three placeholders — never a stale or page-derived count.
    expect(screen.getAllByText('—')).toHaveLength(3)
  })
})

describe('SuperRentalsScreen (mobile) — truncated first page', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  const page = Array.from({ length: 25 }, (_, i) =>
    makeRental({ id: `r${i}`, userName: `Cliente ${i}` }),
  )

  it('reports the server total, not the 25 rows it rendered', () => {
    setup({
      rentals: page,
      total: 40,
      summary: makeSummary({
        total: 40,
        byStatus: {
          active: 31,
          past_due: 4,
          unpaid: 1,
          pending_setup: 2,
          canceled: 2,
        },
        rentAtRiskCents: 7500,
      }),
    })
    renderWithProviders(<SuperRentalsScreen />)

    expect(screen.getByText('40 resultados.')).toBeTruthy()
    // 31 comes from the summary, not from the 25 active rows on screen.
    expect(screen.getByText('31')).toBeTruthy()
  })

  it('renders pagination controls with the right page count', () => {
    setup({ rentals: page, total: 40 })
    renderWithProviders(<SuperRentalsScreen />)

    // 40 rentals / 25 per page = 2 pages.
    expect(screen.getByText('Página 1 de 2')).toBeTruthy()
    expect(screen.getByText('Anterior')).toBeTruthy()
    expect(screen.getByText('Siguiente')).toBeTruthy()
  })

  it('asks the API for the next page when "Siguiente" is pressed', () => {
    setup({ rentals: page, total: 40 })
    renderWithProviders(<SuperRentalsScreen />)

    fireEvent.press(screen.getByText('Siguiente'))

    expect(mockRentals).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 2, pageSize: 25 }),
    )
  })

  it('resets to page 1 when the operator switches the status chip', () => {
    setup({ rentals: page, total: 40 })
    renderWithProviders(<SuperRentalsScreen />)

    fireEvent.press(screen.getByText('Siguiente'))
    expect(mockRentals).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 2 }),
    )

    // Page 2 of "Todos" is not page 2 of "Setup" — staying there would show an
    // empty list for no visible reason. ("Setup" is the only chip label that
    // isn't also a row badge, so it identifies the chip unambiguously.)
    fireEvent.press(screen.getByText('Setup'))
    expect(mockRentals).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 1, status: ['pending_setup'] }),
    )
  })

  it('hides the pagination when everything fits on one page', () => {
    setup({ rentals: [makeRental()], total: 1 })
    renderWithProviders(<SuperRentalsScreen />)

    expect(screen.queryByText('Siguiente')).toBeNull()
  })
})
