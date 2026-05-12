import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '../test/test-utils'
import type { UserAddress } from '../lib/types'

// ── Module mocks ───────────────────────────────────────────────────────────────
vi.mock('../lib/queries', () => ({
  useSuperUserAddresses: vi.fn(),
}))

import { useSuperUserAddresses } from '../lib/queries'
import { SavedAddressesList } from './SavedAddressesList'

const mockUseAddresses = vi.mocked(useSuperUserAddresses)

// ── Fixtures ───────────────────────────────────────────────────────────────────

const addresses: UserAddress[] = [
  {
    id: 'addr-1',
    userId: 'user-abc',
    label: 'Casa',
    line1: 'Calle Duarte 45',
    line2: null,
    lat: 18.47,
    lng: -69.9,
    instructions: null,
    isDefault: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'addr-2',
    userId: 'user-abc',
    label: 'Oficina',
    line1: 'Av. Winston Churchill 1099',
    line2: 'Piso 3',
    lat: 18.48,
    lng: -69.91,
    instructions: 'Timbre B',
    isDefault: false,
    createdAt: '2026-01-02T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  },
  {
    id: 'addr-3',
    userId: 'user-abc',
    label: 'Tío Pedro',
    line1: 'Calle Las Mercedes 23',
    line2: null,
    lat: 18.49,
    lng: -69.92,
    instructions: null,
    isDefault: false,
    createdAt: '2026-01-03T00:00:00.000Z',
    updatedAt: '2026-01-03T00:00:00.000Z',
  },
]

function makeQueryResult(overrides: Partial<{
  data: UserAddress[] | undefined
  isLoading: boolean
  isPending: boolean
  isError: boolean
}> = {}) {
  return {
    data: overrides.data ?? [],
    isLoading: overrides.isLoading ?? false,
    isPending: overrides.isPending ?? false,
    isError: overrides.isError ?? false,
    error: null,
    isSuccess: true,
    isFetching: false,
    status: 'success' as const,
    fetchStatus: 'idle' as const,
    refetch: vi.fn(),
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('SavedAddressesList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders all addresses with label and line1', () => {
    mockUseAddresses.mockReturnValue(
      makeQueryResult({ data: addresses }) as unknown as ReturnType<typeof useSuperUserAddresses>,
    )
    renderWithProviders(<SavedAddressesList userId="user-abc" />)

    expect(screen.getByText('Casa')).toBeInTheDocument()
    expect(screen.getByText('Calle Duarte 45')).toBeInTheDocument()
    expect(screen.getByText('Oficina')).toBeInTheDocument()
    expect(screen.getByText('Av. Winston Churchill 1099')).toBeInTheDocument()
    expect(screen.getByText('Tío Pedro')).toBeInTheDocument()
    expect(screen.getByText('Calle Las Mercedes 23')).toBeInTheDocument()
  })

  it('shows default badge only on the default address', () => {
    mockUseAddresses.mockReturnValue(
      makeQueryResult({ data: addresses }) as unknown as ReturnType<typeof useSuperUserAddresses>,
    )
    renderWithProviders(<SavedAddressesList userId="user-abc" />)

    // The default badge text
    const badges = screen.getAllByText(/predeterminada/i)
    expect(badges).toHaveLength(1)
  })

  it('shows "Sin direcciones guardadas" when list is empty', () => {
    mockUseAddresses.mockReturnValue(
      makeQueryResult({ data: [] }) as unknown as ReturnType<typeof useSuperUserAddresses>,
    )
    renderWithProviders(<SavedAddressesList userId="user-abc" />)

    expect(screen.getByText(/sin direcciones guardadas/i)).toBeInTheDocument()
  })

  it('shows loading placeholder while data is pending', () => {
    mockUseAddresses.mockReturnValue(
      makeQueryResult({ data: undefined, isLoading: true, isPending: true }) as unknown as ReturnType<typeof useSuperUserAddresses>,
    )
    renderWithProviders(<SavedAddressesList userId="user-abc" />)

    expect(screen.getByText(/cargando/i)).toBeInTheDocument()
  })

  it('calls useSuperUserAddresses with the correct userId', () => {
    mockUseAddresses.mockReturnValue(
      makeQueryResult({ data: [] }) as unknown as ReturnType<typeof useSuperUserAddresses>,
    )
    renderWithProviders(<SavedAddressesList userId="user-xyz" />)

    expect(mockUseAddresses).toHaveBeenCalledWith('user-xyz')
  })

  it('does not render any list items when loading', () => {
    mockUseAddresses.mockReturnValue(
      makeQueryResult({ data: undefined, isLoading: true, isPending: true }) as unknown as ReturnType<typeof useSuperUserAddresses>,
    )
    renderWithProviders(<SavedAddressesList userId="user-abc" />)

    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })
})
