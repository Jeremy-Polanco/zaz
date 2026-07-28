import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../test/test-utils'
import type { Product } from '../lib/types'

// ── Module mocks ───────────────────────────────────────────────────────────────

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
  useAdminProducts: vi.fn(),
  useCategories: vi.fn(),
  useCreateProduct: vi.fn(),
  useUpdateProduct: vi.fn(),
  useDeleteProduct: vi.fn(),
  useUpdateInventory: vi.fn(),
  useUploadProductImage: vi.fn(),
  useReorderProducts: vi.fn(),
}))

vi.mock('../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  TOKEN_KEY: 'dashgo.token',
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
import {
  computeReorderItems,
  isStockValid,
  parseDisplayOrder,
  ProductForm,
} from './super.products'

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
    displayOrder: 0,
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

/**
 * Wires every hook ProductForm reaches for, including a category — the save
 * button is `disabled={!allValid}` and `allValid` requires one, so without it
 * nothing can be submitted.
 */
function setupProductFormMocks(opts: { updateAsync?: ReturnType<typeof vi.fn> } = {}) {
  setupMocks({
    updateMutation: createMutationMock(
      opts.updateAsync ? { mutateAsync: opts.updateAsync } : {},
    ),
  })
  mockUseCategories.mockReturnValue({
    data: [{ id: 'cat-1', name: 'Agua', slug: 'agua', displayOrder: 0 }],
    isPending: false,
    isError: false,
    error: null,
  } as unknown as ReturnType<typeof useCategories>)
}

/** A rental product that satisfies every "listo para guardar" check. */
function makeSaveableRental() {
  return makeRentalProduct({ categoryId: 'cat-1' })
}

// ── Pricing mode: rendered from the REAL ProductForm ──────────────────────────
// The previous version of this block rendered a `PricingModeDriver` that
// re-implemented the form, and exported its own `validateRentalFields` whose
// error copy exists nowhere in production. It proved a validator that does not
// exist. These drive the real component through its "Precio" tab.

async function openPricingTab(product: Product | null = null) {
  const onDone = vi.fn()
  renderWithProviders(<ProductForm editing={product} onDone={onDone} />)
  await userEvent.click(screen.getByRole('button', { name: /Precio/ }))
  return { onDone }
}

describe('ProductForm — pricing mode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupProductFormMocks()
  })

  it('defaults a new product to single payment, with no rental fields', async () => {
    await openPricingTab(null)

    expect(screen.queryByTestId('rental-fields')).not.toBeInTheDocument()
    expect(screen.getByTestId('pricing-mode-single')).toBeInTheDocument()
  })

  it('keeps a single-payment product on single payment', async () => {
    await openPricingTab(makeSinglePaymentProduct())

    expect(screen.queryByTestId('rental-fields')).not.toBeInTheDocument()
  })

  it('reveals the rental fields when switching to rental', async () => {
    await openPricingTab(makeSinglePaymentProduct())

    await userEvent.click(screen.getByTestId('pricing-mode-rental'))

    expect(screen.getByTestId('rental-fields')).toBeInTheDocument()
    expect(screen.getByTestId('monthly-rent-input')).toBeInTheDocument()
    expect(screen.getByTestId('late-fee-input')).toBeInTheDocument()
  })

  it('hides them again when switching back to single payment', async () => {
    await openPricingTab(makeRentalProduct())
    expect(screen.getByTestId('rental-fields')).toBeInTheDocument()

    await userEvent.click(screen.getByTestId('pricing-mode-single'))

    expect(screen.queryByTestId('rental-fields')).not.toBeInTheDocument()
  })

  it('prefills a rental product\'s amounts, converting cents to dollars', async () => {
    await openPricingTab(makeRentalProduct())

    expect(screen.getByTestId('monthly-rent-input')).toHaveValue(20)
    expect(screen.getByTestId('late-fee-input')).toHaveValue(5)
  })
})

describe('ProductForm — saving a rental', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupProductFormMocks()
  })

  it('sends the rental amounts back in cents', async () => {
    const update = vi.fn().mockResolvedValue({ id: 'prod-rental-001' })
    setupProductFormMocks({ updateAsync: update })
    await openPricingTab(makeSaveableRental())

    await userEvent.clear(screen.getByTestId('monthly-rent-input'))
    await userEvent.type(screen.getByTestId('monthly-rent-input'), '35.50')
    await userEvent.click(screen.getByRole('button', { name: /Guardar/ }))

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'prod-002',
          pricingMode: 'rental',
          monthlyRentCents: 3550,
        }),
      ),
    )
  })

  it.each([
    ['', /Ingresa una renta válida/],
    ['0', /Ingresa una renta válida/],
  ] as const)(
    'refuses to save a rental whose monthly rent is "%s"',
    async (value, message) => {
      const update = vi.fn().mockResolvedValue({ id: 'prod-002' })
      setupProductFormMocks({ updateAsync: update })
      await openPricingTab(makeSaveableRental())

      await userEvent.clear(screen.getByTestId('monthly-rent-input'))
      if (value) await userEvent.type(screen.getByTestId('monthly-rent-input'), value)
      await userEvent.click(screen.getByRole('button', { name: /Guardar/ }))

      expect(await screen.findByText(message)).toBeInTheDocument()
      expect(update).not.toHaveBeenCalled()
    },
  )

  it('refuses a negative late fee, but allows zero', async () => {
    const update = vi.fn().mockResolvedValue({ id: 'prod-002' })
    setupProductFormMocks({ updateAsync: update })
    await openPricingTab(makeSaveableRental())

    await userEvent.clear(screen.getByTestId('late-fee-input'))
    await userEvent.type(screen.getByTestId('late-fee-input'), '-5')
    await userEvent.click(screen.getByRole('button', { name: /Guardar/ }))

    expect(await screen.findByText(/0 o más/)).toBeInTheDocument()
    expect(update).not.toHaveBeenCalled()

    // A rental with no late fee is legitimate — zero must pass.
    await userEvent.clear(screen.getByTestId('late-fee-input'))
    await userEvent.type(screen.getByTestId('late-fee-input'), '0')
    await userEvent.click(screen.getByRole('button', { name: /Guardar/ }))

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ lateFeeCents: 0 }),
      ),
    )
  })

  // The rental rules must not leak onto single-payment products, whose rent
  // fields are empty by definition.
  it('leaves single-payment products alone', async () => {
    const update = vi.fn().mockResolvedValue({ id: 'prod-001' })
    setupProductFormMocks({ updateAsync: update })
    await openPricingTab(makeSinglePaymentProduct({ categoryId: 'cat-1' }))

    await userEvent.click(screen.getByRole('button', { name: /Guardar/ }))

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ pricingMode: 'single_payment' }),
      ),
    )
  })
})

describe('super.products — isStockValid (pure function)', () => {
  // The bug: with "Manejar stock" OFF and an empty stock field, save was
  // blocked — the operator had to type a number then toggle back. Stock should
  // only be required when tracking is ON.
  it('tracking OFF + empty stock → valid (the bug: was false, blocked save)', () => {
    expect(isStockValid(false, '')).toBe(true)
  })

  it('tracking OFF + any stock text → valid', () => {
    expect(isStockValid(false, '10')).toBe(true)
  })

  it('tracking ON + empty stock → invalid (must enter a number)', () => {
    expect(isStockValid(true, '')).toBe(false)
    expect(isStockValid(true, '   ')).toBe(false)
  })

  it('tracking ON + a stock number → valid', () => {
    expect(isStockValid(true, '0')).toBe(true)
    expect(isStockValid(true, '25')).toBe(true)
  })
})

// ── Catalog ordering — parseDisplayOrder (pure function) ─────────────────────────

describe('super.products — parseDisplayOrder (pure function)', () => {
  it('empty string counts as 0 (server default)', () => {
    expect(parseDisplayOrder('')).toBe(0)
    expect(parseDisplayOrder('   ')).toBe(0)
  })

  it('parses a valid non-negative integer', () => {
    expect(parseDisplayOrder('0')).toBe(0)
    expect(parseDisplayOrder('7')).toBe(7)
    expect(parseDisplayOrder('42')).toBe(42)
  })

  it('rejects negatives and non-numeric text with null', () => {
    expect(parseDisplayOrder('-1')).toBeNull()
    expect(parseDisplayOrder('abc')).toBeNull()
  })
})

// ── Catalog ordering — computeReorderItems (pure function) ───────────────────────

describe('super.products — computeReorderItems (pure function)', () => {
  const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]

  it('moving a card down reindexes the whole list (index = displayOrder)', () => {
    // a soltada sobre c → b, c, a, d
    expect(computeReorderItems(list, 'a', 'c')).toEqual([
      { id: 'b', displayOrder: 0 },
      { id: 'c', displayOrder: 1 },
      { id: 'a', displayOrder: 2 },
      { id: 'd', displayOrder: 3 },
    ])
  })

  it('moving a card up reindexes the whole list', () => {
    // d soltada sobre b → a, d, b, c
    expect(computeReorderItems(list, 'd', 'b')).toEqual([
      { id: 'a', displayOrder: 0 },
      { id: 'd', displayOrder: 1 },
      { id: 'b', displayOrder: 2 },
      { id: 'c', displayOrder: 3 },
    ])
  })

  it('returns null when dropped on itself (no-op, no mutation fired)', () => {
    expect(computeReorderItems(list, 'b', 'b')).toBeNull()
  })

  it('returns null when either id is not in the list', () => {
    expect(computeReorderItems(list, 'ghost', 'b')).toBeNull()
    expect(computeReorderItems(list, 'a', 'ghost')).toBeNull()
  })

  it('does not mutate the input array', () => {
    const before = list.map((p) => p.id)
    computeReorderItems(list, 'a', 'd')
    expect(list.map((p) => p.id)).toEqual(before)
  })
})

