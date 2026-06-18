/**
 * UserAddressesPanel (mobile) — super-admin management of a customer's saved
 * addresses: list, set-default, edit, delete. Mirrors the web panel.
 */
import React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react-native'
import { renderWithProviders } from '../test/test-utils'

// ── module mocks ──────────────────────────────────────────────────────────────

jest.mock('../lib/queries', () => ({
  useSuperUserAddresses: jest.fn(),
  useSetDefaultAddressForUser: jest.fn(),
  useDeleteAddressForUser: jest.fn(),
  useUpdateAddressForUser: jest.fn(),
}))

import {
  useSuperUserAddresses,
  useSetDefaultAddressForUser,
  useDeleteAddressForUser,
  useUpdateAddressForUser,
} from '../lib/queries'
import { UserAddressesPanel } from './UserAddressesPanel'
import type { UserAddress } from '../lib/types'

const mockAddresses = useSuperUserAddresses as jest.MockedFunction<
  typeof useSuperUserAddresses
>
const mockSetDefault = useSetDefaultAddressForUser as jest.MockedFunction<
  typeof useSetDefaultAddressForUser
>
const mockDelete = useDeleteAddressForUser as jest.MockedFunction<
  typeof useDeleteAddressForUser
>
const mockUpdate = useUpdateAddressForUser as jest.MockedFunction<
  typeof useUpdateAddressForUser
>

// ── fixtures ──────────────────────────────────────────────────────────────────

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
    building: null,
    lat: 18.48,
    lng: -69.91,
    instructions: 'Timbre B',
    isDefault: false,
    createdAt: '2026-01-02T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  },
]

function queryResult(data: UserAddress[] | undefined, isPending = false) {
  return {
    data,
    isPending,
    isLoading: isPending,
    isError: false,
    error: null,
    refetch: jest.fn(),
  } as unknown as ReturnType<typeof useSuperUserAddresses>
}

function mutationMock(overrides: Record<string, unknown> = {}) {
  return {
    mutate: jest.fn(),
    mutateAsync: jest.fn().mockResolvedValue({}),
    isPending: false,
    ...overrides,
  }
}

// ── tests ──────────────────────────────────────────────────────────────────────

describe('UserAddressesPanel (mobile)', () => {
  let setDefaultMutate: jest.Mock
  let deleteMutate: jest.Mock
  let updateMutateAsync: jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()
    setDefaultMutate = jest.fn()
    deleteMutate = jest.fn()
    updateMutateAsync = jest.fn().mockResolvedValue({})
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
    mockAddresses.mockReturnValue(queryResult(addresses))
    renderWithProviders(<UserAddressesPanel userId="user-abc" />)

    expect(screen.getByText('Casa')).toBeTruthy()
    expect(screen.getByText('Oficina')).toBeTruthy()
    expect(screen.getAllByText('Predeterminada')).toHaveLength(1)
  })

  it('set-default appears only on the non-default address and fires the mutation', () => {
    mockAddresses.mockReturnValue(queryResult(addresses))
    renderWithProviders(<UserAddressesPanel userId="user-abc" />)

    const buttons = screen.getAllByText('Hacer predeterminada')
    expect(buttons).toHaveLength(1)
    fireEvent.press(buttons[0])
    expect(setDefaultMutate).toHaveBeenCalledWith('addr-2')
  })

  it('delete fires with the address id', () => {
    mockAddresses.mockReturnValue(queryResult(addresses))
    renderWithProviders(<UserAddressesPanel userId="user-abc" />)

    fireEvent.press(screen.getAllByText('Eliminar')[0])
    expect(deleteMutate).toHaveBeenCalledWith('addr-1')
  })

  it('edits an address and saves the updated fields', async () => {
    mockAddresses.mockReturnValue(queryResult(addresses))
    renderWithProviders(<UserAddressesPanel userId="user-abc" />)

    fireEvent.press(screen.getAllByText('Editar')[0])

    const labelInput = screen.getByDisplayValue('Casa')
    fireEvent.changeText(labelInput, 'Casa Nueva')
    fireEvent.press(screen.getByText('Guardar'))

    await waitFor(() => {
      expect(updateMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'addr-1',
          label: 'Casa Nueva',
          line1: 'Calle Duarte 45',
        }),
      )
    })
  })

  it('shows the empty-state copy when there are no addresses', () => {
    mockAddresses.mockReturnValue(queryResult([]))
    renderWithProviders(<UserAddressesPanel userId="user-abc" />)

    expect(screen.getByText(/sin direcciones guardadas/i)).toBeTruthy()
  })
})
