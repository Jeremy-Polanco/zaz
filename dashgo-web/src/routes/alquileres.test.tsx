import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '../test/test-utils'
import type { Rental } from '../lib/types'

vi.mock('../lib/queries', () => ({ useMyRentals: vi.fn() }))
vi.mock('../lib/api', () => ({ api: { get: vi.fn() }, TOKEN_KEY: 'dashgo.token' }))
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@tanstack/react-router')>()
  return {
    ...original,
    createFileRoute: () => () => ({}),
    redirect: vi.fn(),
    Link: ({ children, ...props }: { children: React.ReactNode; to?: string }) => (
      <a {...props}>{children}</a>
    ),
  }
})

import { useMyRentals } from '../lib/queries'
import { RentalsPage } from './alquileres'

const mockUseMyRentals = vi.mocked(useMyRentals)

function setRentals(rentals: Rental[] | undefined, isPending = false) {
  mockUseMyRentals.mockReturnValue({
    data: rentals,
    isPending,
  } as unknown as ReturnType<typeof useMyRentals>)
}

const sample: Rental[] = [
  {
    id: 'r-1',
    productId: 'p-1',
    productName: 'Dispensador de agua fría/caliente',
    productImageUrl: 'https://example.com/p1.png',
    monthlyRentCents: 19999,
    status: 'active',
    nextChargeAt: '2026-07-01T00:00:00.000Z',
    activatedAt: '2026-06-01T00:00:00.000Z',
  },
  {
    id: 'r-2',
    productId: 'p-2',
    productName: 'Bomba de agua',
    productImageUrl: 'https://example.com/p2.png',
    monthlyRentCents: 9999,
    status: 'pending_setup',
    nextChargeAt: null,
    activatedAt: null,
  },
]

describe('alquileres (customer rentals)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders one card per rental with its status label', () => {
    setRentals(sample)
    renderWithProviders(<RentalsPage />)
    expect(screen.getByText('Dispensador de agua fría/caliente')).toBeInTheDocument()
    expect(screen.getByText('Bomba de agua')).toBeInTheDocument()
    expect(screen.getByText('Activo')).toBeInTheDocument()
    expect(screen.getByText('Pendiente')).toBeInTheDocument()
  })

  it('shows the pending-setup explainer for pending rentals', () => {
    setRentals(sample)
    renderWithProviders(<RentalsPage />)
    expect(
      screen.getByText(/Estamos terminando de configurar tu alquiler/i),
    ).toBeInTheDocument()
  })

  it('shows the empty state when there are no rentals', () => {
    setRentals([])
    renderWithProviders(<RentalsPage />)
    expect(screen.getByText(/No tienes alquileres activos/i)).toBeInTheDocument()
  })

  it('shows a loading indicator while pending', () => {
    setRentals(undefined, true)
    renderWithProviders(<RentalsPage />)
    expect(screen.getByText(/Cargando alquileres/i)).toBeInTheDocument()
  })
})
