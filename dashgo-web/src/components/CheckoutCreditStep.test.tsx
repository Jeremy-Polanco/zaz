import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../test/test-utils'
import type { MyCreditResponse } from '../lib/types'

// ── Module mock for useMyCredit ────────────────────────────────────────────────
// We mock the queries module so no HTTP requests are made.
vi.mock('../lib/queries', () => ({
  useMyCredit: vi.fn(),
}))

// ── Lazy import after mock registration ───────────────────────────────────────
import { CheckoutCreditStep } from './CheckoutCreditStep'
import { useMyCredit } from '../lib/queries'

const mockUseMyCredit = vi.mocked(useMyCredit)

function makeCreditData(overrides: Partial<MyCreditResponse> = {}): MyCreditResponse {
  return {
    balanceCents: 5000,        // $50.00 balance
    creditLimitCents: 10000,   // $100.00 limit → available = $150.00
    dueDate: null,
    status: 'active',
    amountOwedCents: 0,
    locked: false,
    movements: [],
    ...overrides,
  }
}

function mockCredit(data: MyCreditResponse | undefined) {
  mockUseMyCredit.mockReturnValue({
    data,
    isPending: false,
    isError: false,
    error: null,
  } as unknown as ReturnType<typeof useMyCredit>)
}

describe('CheckoutCreditStep', () => {
  beforeEach(() => {
    mockCredit(makeCreditData())
  })

  it('renders the credit toggle for a CLIENT with a non-overdue account', () => {
    renderWithProviders(
      <CheckoutCreditStep
        userRole="client"
        subtotalCents={3000}
        useCredit={false}
        onToggle={vi.fn()}
      />,
    )
    expect(screen.getByText(/Usar mi crédito/i)).toBeInTheDocument()
  })

  it('renders nothing for a PROMOTER user', () => {
    const { container } = renderWithProviders(
      <CheckoutCreditStep
        userRole="promoter"
        subtotalCents={3000}
        useCredit={false}
        onToggle={vi.fn()}
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing for SUPER_ADMIN_DELIVERY', () => {
    const { container } = renderWithProviders(
      <CheckoutCreditStep
        userRole="super_admin_delivery"
        subtotalCents={3000}
        useCredit={false}
        onToggle={vi.fn()}
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when credit status is "none"', () => {
    mockCredit(makeCreditData({ status: 'none', balanceCents: null, creditLimitCents: null }))
    const { container } = renderWithProviders(
      <CheckoutCreditStep
        userRole="client"
        subtotalCents={3000}
        useCredit={false}
        onToggle={vi.fn()}
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when credit status is "overdue"', () => {
    mockCredit(makeCreditData({ status: 'overdue' }))
    const { container } = renderWithProviders(
      <CheckoutCreditStep
        userRole="client"
        subtotalCents={3000}
        useCredit={false}
        onToggle={vi.fn()}
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('creditApplied = min(available, subtotal) — limited by available credit', () => {
    // balance=5000 ($50) + limit=10000 ($100) = available=15000 ($150)
    // subtotal=3000 ($30) < available → creditApplied=$30
    mockCredit(makeCreditData({ balanceCents: 5000, creditLimitCents: 10000 }))
    renderWithProviders(
      <CheckoutCreditStep
        userRole="client"
        subtotalCents={3000}
        useCredit={false}
        onToggle={vi.fn()}
      />,
    )
    // The applied amount text shows "Aplica $30.00 de crédito"
    expect(screen.getByText(/Aplica \$30\.00 de crédito/i)).toBeInTheDocument()
  })

  it('creditApplied = min(available, subtotal) — limited by subtotal', () => {
    // balance=100 ($1) + limit=100 ($1) = available=200 ($2)
    // subtotal=5000 ($50) > available → creditApplied=$2
    mockCredit(makeCreditData({ balanceCents: 100, creditLimitCents: 100 }))
    renderWithProviders(
      <CheckoutCreditStep
        userRole="client"
        subtotalCents={5000}
        useCredit={false}
        onToggle={vi.fn()}
      />,
    )
    // Applied = min(200, 5000) = 200 → $2.00
    expect(screen.getByText(/Aplica \$2\.00 de crédito/i)).toBeInTheDocument()
  })

  it('calls onToggle when the checkbox is clicked', async () => {
    const onToggle = vi.fn()
    renderWithProviders(
      <CheckoutCreditStep
        userRole="client"
        subtotalCents={3000}
        useCredit={false}
        onToggle={onToggle}
      />,
    )
    const checkbox = screen.getByRole('checkbox')
    await userEvent.click(checkbox)
    expect(onToggle).toHaveBeenCalledWith(true)
  })

  it('shows breakdown when useCredit=true', () => {
    renderWithProviders(
      <CheckoutCreditStep
        userRole="client"
        subtotalCents={3000}
        useCredit={true}
        onToggle={vi.fn()}
      />,
    )
    expect(screen.getByText(/Crédito aplicado/i)).toBeInTheDocument()
  })

  it('renders nothing when available credit <= 0', () => {
    mockCredit(makeCreditData({ balanceCents: 0, creditLimitCents: 0 }))
    const { container } = renderWithProviders(
      <CheckoutCreditStep
        userRole="client"
        subtotalCents={3000}
        useCredit={false}
        onToggle={vi.fn()}
      />,
    )
    expect(container.firstChild).toBeNull()
  })
})
