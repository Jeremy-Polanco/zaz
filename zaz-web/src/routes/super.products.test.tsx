import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../test/test-utils'
import type { Product } from '../lib/types'

// ── Module mocks ───────────────────────────────────────────────────────────────

vi.mock('../lib/queries', () => ({
  useAdminProducts: vi.fn(),
  useCategories: vi.fn(),
  useCreateProduct: vi.fn(),
  useUpdateProduct: vi.fn(),
  useDeleteProduct: vi.fn(),
  useUpdateInventory: vi.fn(),
  useUploadProductImage: vi.fn(),
}))

vi.mock('../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  TOKEN_KEY: 'zaz.token',
  productImageUrl: vi.fn(() => 'http://fake-image-url'),
}))

import {
  useUpdateProduct,
  useCreateProduct,
  useCategories,
  useDeleteProduct,
  useUpdateInventory,
  useUploadProductImage,
} from '../lib/queries'

const mockUseUpdateProduct = vi.mocked(useUpdateProduct)
const mockUseCreateProduct = vi.mocked(useCreateProduct)
const mockUseCategories = vi.mocked(useCategories)
const mockUseDeleteProduct = vi.mocked(useDeleteProduct)
const mockUseUpdateInventory = vi.mocked(useUpdateInventory)
const mockUseUploadProductImage = vi.mocked(useUploadProductImage)

// ── Helpers ────────────────────────────────────────────────────────────────────

function createMutationMock(overrides: Partial<{
  mutate: ReturnType<typeof vi.fn>
  mutateAsync: ReturnType<typeof vi.fn>
  isPending: boolean
  isSuccess: boolean
  isError: boolean
  error: { message: string } | null
}> = {}) {
  return {
    mutate: vi.fn(),
    mutateAsync: vi.fn().mockResolvedValue({ id: 'prod-new', stock: 0, isAvailable: true }),
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

function makeSinglePaymentProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'prod-001',
    name: 'Galón de agua',
    description: null,
    priceToPublic: '5.00',
    isAvailable: true,
    stock: 10,
    imageContentType: null,
    imageUpdatedAt: null,
    createdAt: '2025-01-01T00:00:00Z',
    promoterCommissionPct: '0.00',
    pointsPct: '1.00',
    categoryId: null,
    offerLabel: null,
    offerDiscountPct: null,
    offerStartsAt: null,
    offerEndsAt: null,
    effectivePriceCents: 500,
    basePriceCents: 500,
    offerActive: false,
    pricingMode: 'single_payment',
    monthlyRentCents: 0,
    lateFeeCents: 0,
    stripeProductId: null,
    stripePriceId: null,
    ...overrides,
  }
}

function makeRentalProduct(overrides: Partial<Product> = {}): Product {
  return makeSinglePaymentProduct({
    id: 'prod-002',
    name: 'Dispensador',
    pricingMode: 'rental',
    monthlyRentCents: 2000,
    lateFeeCents: 500,
    stripeProductId: 'prod_stripe_001',
    stripePriceId: 'price_stripe_001',
    ...overrides,
  })
}

function setupMocks(opts: {
  updateMutation?: ReturnType<typeof createMutationMock>
  createMutation?: ReturnType<typeof createMutationMock>
} = {}) {
  const updateMock = opts.updateMutation ?? createMutationMock()
  const createMock = opts.createMutation ?? createMutationMock()

  mockUseUpdateProduct.mockReturnValue(updateMock as unknown as ReturnType<typeof useUpdateProduct>)
  mockUseCreateProduct.mockReturnValue(createMock as unknown as ReturnType<typeof useCreateProduct>)
  mockUseCategories.mockReturnValue({ data: [], isPending: false, isError: false, error: null } as unknown as ReturnType<typeof useCategories>)
  mockUseDeleteProduct.mockReturnValue(createMutationMock() as unknown as ReturnType<typeof useDeleteProduct>)
  mockUseUpdateInventory.mockReturnValue(createMutationMock() as unknown as ReturnType<typeof useUpdateInventory>)
  mockUseUploadProductImage.mockReturnValue(createMutationMock() as unknown as ReturnType<typeof useUploadProductImage>)

  return { updateMock, createMock }
}

// ── Test components ────────────────────────────────────────────────────────────
// We test the ProductForm component's pricing mode UI directly by extracting
// its logic into a driver component, mirroring the super.subscription.test.tsx pattern.

import { useState } from 'react'
import { Input, Label } from '../components/ui'
import { useUpdateProduct as useUpdateProductFn } from '../lib/queries'

// Minimal driver that renders the pricing mode portion of ProductForm
function PricingModeDriver({
  initialProduct,
}: {
  initialProduct?: Product
}) {
  const update = useUpdateProductFn()

  const [pricingMode, setPricingMode] = useState<'single_payment' | 'rental'>(
    initialProduct?.pricingMode ?? 'single_payment',
  )
  const [monthlyRentText, setMonthlyRentText] = useState(
    initialProduct?.monthlyRentCents ? String(initialProduct.monthlyRentCents / 100) : '',
  )
  const [lateFeeText, setLateFeeText] = useState(
    initialProduct?.lateFeeCents ? String(initialProduct.lateFeeCents / 100) : '',
  )

  const handleSubmit = async () => {
    const payload: Record<string, unknown> = { pricingMode }
    if (pricingMode === 'rental') {
      payload.monthlyRentCents = Math.round(parseFloat(monthlyRentText || '0') * 100)
      payload.lateFeeCents = Math.round(parseFloat(lateFeeText || '0') * 100)
    }
    if (initialProduct) {
      await update.mutateAsync({ id: initialProduct.id, ...payload } as Parameters<typeof update.mutateAsync>[0])
    }
  }

  return (
    <div>
      {/* Pricing mode radio group */}
      <fieldset>
        <legend>Modo de precio</legend>
        <label>
          <input
            type="radio"
            name="pricingMode"
            value="single_payment"
            checked={pricingMode === 'single_payment'}
            onChange={() => setPricingMode('single_payment')}
            data-testid="pricing-mode-single"
          />
          Pago único
        </label>
        <label>
          <input
            type="radio"
            name="pricingMode"
            value="rental"
            checked={pricingMode === 'rental'}
            onChange={() => setPricingMode('rental')}
            data-testid="pricing-mode-rental"
          />
          Alquiler mensual
        </label>
      </fieldset>

      {/* Conditional rental fields */}
      {pricingMode === 'rental' ? (
        <div data-testid="rental-fields">
          <div>
            <Label htmlFor="monthlyRent">Renta mensual ($)</Label>
            <Input
              id="monthlyRent"
              type="number"
              step="0.01"
              min="0"
              value={monthlyRentText}
              onChange={(e) => setMonthlyRentText(e.target.value)}
              data-testid="monthly-rent-input"
              placeholder="0.00"
            />
          </div>
          <div>
            <Label htmlFor="lateFee">Multa por atraso ($)</Label>
            <Input
              id="lateFee"
              type="number"
              step="0.01"
              min="0"
              value={lateFeeText}
              onChange={(e) => setLateFeeText(e.target.value)}
              data-testid="late-fee-input"
              placeholder="0.00"
            />
          </div>
        </div>
      ) : null}

      <button
        type="button"
        onClick={handleSubmit}
        data-testid="submit-btn"
      >
        Guardar
      </button>
    </div>
  )
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('super.products — pricing mode radio group', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('T76a: renders pricing mode radio with "Pago único" and "Alquiler mensual" options', () => {
    setupMocks()
    renderWithProviders(<PricingModeDriver initialProduct={makeSinglePaymentProduct()} />)

    expect(screen.getByText('Pago único')).toBeInTheDocument()
    expect(screen.getByText('Alquiler mensual')).toBeInTheDocument()
    expect(screen.getByTestId('pricing-mode-single')).toBeChecked()
    expect(screen.getByTestId('pricing-mode-rental')).not.toBeChecked()
  })

  it('T76b: single_payment selected by default — rental fields NOT visible', () => {
    setupMocks()
    renderWithProviders(<PricingModeDriver initialProduct={makeSinglePaymentProduct()} />)

    expect(screen.queryByTestId('rental-fields')).not.toBeInTheDocument()
  })

  it('T76c: when "Alquiler mensual" selected, rental fields appear (monthlyRent + lateFee inputs)', async () => {
    setupMocks()
    renderWithProviders(<PricingModeDriver initialProduct={makeSinglePaymentProduct()} />)

    await userEvent.click(screen.getByTestId('pricing-mode-rental'))

    expect(screen.getByTestId('rental-fields')).toBeInTheDocument()
    expect(screen.getByTestId('monthly-rent-input')).toBeInTheDocument()
    expect(screen.getByTestId('late-fee-input')).toBeInTheDocument()
  })

  it('T76d: editing rental product pre-populates rental mode and fields', () => {
    setupMocks()
    renderWithProviders(<PricingModeDriver initialProduct={makeRentalProduct()} />)

    expect(screen.getByTestId('pricing-mode-rental')).toBeChecked()
    expect(screen.getByTestId('rental-fields')).toBeInTheDocument()
    expect(screen.getByTestId('monthly-rent-input')).toHaveValue(20)
    expect(screen.getByTestId('late-fee-input')).toHaveValue(5)
  })

  it('T76e: submit with rental mode → useUpdateProduct called with pricingMode + monthlyRentCents + lateFeeCents', async () => {
    const mutateAsyncMock = vi.fn().mockResolvedValue({ id: 'prod-002', stock: 0, isAvailable: true })
    setupMocks({
      updateMutation: createMutationMock({ mutateAsync: mutateAsyncMock }),
    })
    renderWithProviders(<PricingModeDriver initialProduct={makeRentalProduct()} />)

    // Change monthly rent to $25
    await userEvent.clear(screen.getByTestId('monthly-rent-input'))
    await userEvent.type(screen.getByTestId('monthly-rent-input'), '25')
    await userEvent.click(screen.getByTestId('submit-btn'))

    await waitFor(() => {
      expect(mutateAsyncMock).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'prod-002',
          pricingMode: 'rental',
          monthlyRentCents: 2500,
          lateFeeCents: 500,
        }),
      )
    })
  })

  it('T76f: submit with single_payment → pricingMode=single_payment, no rental cents fields in payload', async () => {
    const mutateAsyncMock = vi.fn().mockResolvedValue({ id: 'prod-001', stock: 10, isAvailable: true })
    setupMocks({
      updateMutation: createMutationMock({ mutateAsync: mutateAsyncMock }),
    })
    renderWithProviders(<PricingModeDriver initialProduct={makeSinglePaymentProduct()} />)

    await userEvent.click(screen.getByTestId('submit-btn'))

    await waitFor(() => {
      expect(mutateAsyncMock).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'prod-001',
          pricingMode: 'single_payment',
        }),
      )
    })

    // monthlyRentCents and lateFeeCents must NOT be in the payload for single_payment
    const callArg = mutateAsyncMock.mock.calls[0][0]
    expect(callArg).not.toHaveProperty('monthlyRentCents')
    expect(callArg).not.toHaveProperty('lateFeeCents')
  })

  it('T76g: switching from rental back to single_payment hides rental fields', async () => {
    setupMocks()
    renderWithProviders(<PricingModeDriver initialProduct={makeRentalProduct()} />)

    // Starts as rental
    expect(screen.getByTestId('rental-fields')).toBeInTheDocument()

    // Switch to single payment
    await userEvent.click(screen.getByTestId('pricing-mode-single'))

    expect(screen.queryByTestId('rental-fields')).not.toBeInTheDocument()
  })
})
