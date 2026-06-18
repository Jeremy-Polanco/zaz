import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../test/test-utils'
import type { UserAddress } from '../lib/types'

// ── Module mocks ───────────────────────────────────────────────────────────────
vi.mock('../lib/queries', () => ({
  useSuperUserAddresses: vi.fn(),
  useSetDefaultAddressForUser: vi.fn(),
  useDeleteAddressForUser: vi.fn(),
  useUpdateAddressForUser: vi.fn(),
}))

import {
  useSuperUserAddresses,
  useSetDefaultAddressForUser,
  useDeleteAddressForUser,
  useUpdateAddressForUser,
} from '../lib/queries'
import { UserAddressesPanel } from './UserAddressesPanel'

const mockAddresses = vi.mocked(useSuperUserAddresses)
const mockSetDefault = vi.mocked(useSetDefaultAddressForUser)
const mockDelete = vi.mocked(useDeleteAddressForUser)
const mockUpdate = vi.mocked(useUpdateAddressForUser)

// ── Fixtures ───────────────────────────────────────────────────────────────────

const addresses: UserAddress[] = [
  {
    id: 'addr-1',
    userId: 'user-abc',
    label: 'Casa',
    line1: 'Calle Duarte 45',
    line2: null,
    building: null,
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
    line1: 'Av. Churchill 1099',
    line2: 'Piso 3',
    building: 'Torre A',
    lat: 18.48,
    lng: -69.91,
    instructions: 'Timbre B',
    isDefault: false,
    createdAt: '2026-01-02T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  },
]

function queryResult(data: UserAddress[] | undefined, isLoading = false) {
  return {
    data: data ?? [],
    isLoading,
    isPending: isLoading,
    isError: false,
    error: null,
    isSuccess: !isLoading,
    isFetching: false,
    status: isLoading ? 'pending' : 'success',
    fetchStatus: 'idle',
    refetch: vi.fn(),
  }
}

function mutationMock(
  overrides: Partial<{
    mutate: ReturnType<typeof vi.fn>
    mutateAsync: ReturnType<typeof vi.fn>
    isPending: boolean
  }> = {},
) {
  return {
    mutate: vi.fn(),
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
    isError: false,
    isSuccess: false,
    error: null,
    reset: vi.fn(),
    ...overrides,
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('UserAddressesPanel', () => {
  let setDefaultMutate: ReturnType<typeof vi.fn>
  let deleteMutate: ReturnType<typeof vi.fn>
  let updateMutateAsync: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    setDefaultMutate = vi.fn()
    deleteMutate = vi.fn()
    updateMutateAsync = vi.fn().mockResolvedValue({})
    mockSetDefault.mockReturnValue(
      mutationMock({ mutate: setDefaultMutate }) as unknown as ReturnType<
        typeof useSetDefaultAddressForUser
      >,
    )
    mockDelete.mockReturnValue(
      mutationMock({ mutate: deleteMutate }) as unknown as ReturnType<
        typeof useDeleteAddressForUser
      >,
    )
    mockUpdate.mockReturnValue(
      mutationMock({ mutateAsync: updateMutateAsync }) as unknown as ReturnType<
        typeof useUpdateAddressForUser
      >,
    )
  })

  it('renders each address with the default badge only on the default one', () => {
    mockAddresses.mockReturnValue(
      queryResult(addresses) as unknown as ReturnType<typeof useSuperUserAddresses>,
    )
    renderWithProviders(<UserAddressesPanel userId="user-abc" />)

    expect(screen.getByText('Casa')).toBeInTheDocument()
    expect(screen.getByText('Oficina')).toBeInTheDocument()
    // Exact match → the badge only, not the "Hacer predeterminada" button.
    expect(screen.getAllByText('Predeterminada')).toHaveLength(1)
  })

  it('shows "Hacer predeterminada" only on non-default and calls the mutation', async () => {
    mockAddresses.mockReturnValue(
      queryResult(addresses) as unknown as ReturnType<typeof useSuperUserAddresses>,
    )
    renderWithProviders(<UserAddressesPanel userId="user-abc" />)

    const buttons = screen.getAllByRole('button', {
      name: /hacer predeterminada/i,
    })
    expect(buttons).toHaveLength(1) // only the non-default address
    await userEvent.click(buttons[0])
    expect(setDefaultMutate).toHaveBeenCalledWith('addr-2')
  })

  it('calls delete with the address id', async () => {
    mockAddresses.mockReturnValue(
      queryResult(addresses) as unknown as ReturnType<typeof useSuperUserAddresses>,
    )
    renderWithProviders(<UserAddressesPanel userId="user-abc" />)

    const items = screen.getAllByRole('listitem')
    await userEvent.click(
      within(items[0]).getByRole('button', { name: /eliminar/i }),
    )
    expect(deleteMutate).toHaveBeenCalledWith('addr-1')
  })

  it('edits an address: opens the form and saves the updated fields', async () => {
    mockAddresses.mockReturnValue(
      queryResult(addresses) as unknown as ReturnType<typeof useSuperUserAddresses>,
    )
    renderWithProviders(<UserAddressesPanel userId="user-abc" />)

    const items = screen.getAllByRole('listitem')
    await userEvent.click(
      within(items[0]).getByRole('button', { name: /editar/i }),
    )

    const labelInput = screen.getByLabelText('Etiqueta')
    await userEvent.clear(labelInput)
    await userEvent.type(labelInput, 'Casa Nueva')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(updateMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'addr-1',
        input: expect.objectContaining({ label: 'Casa Nueva', line1: 'Calle Duarte 45' }),
      }),
    )
  })

  it('shows the empty-state copy when there are no addresses', () => {
    mockAddresses.mockReturnValue(
      queryResult([]) as unknown as ReturnType<typeof useSuperUserAddresses>,
    )
    renderWithProviders(<UserAddressesPanel userId="user-abc" />)

    expect(screen.getByText(/sin direcciones guardadas/i)).toBeInTheDocument()
  })

  it('shows a loading placeholder while pending', () => {
    mockAddresses.mockReturnValue(
      queryResult(undefined, true) as unknown as ReturnType<typeof useSuperUserAddresses>,
    )
    renderWithProviders(<UserAddressesPanel userId="user-abc" />)

    expect(screen.getByText(/cargando direcciones/i)).toBeInTheDocument()
  })
})
