/**
 * SuperUsersScreen (mobile) — super-admin user management.
 *
 * Covers the delete-user action, which mobile was missing entirely while the
 * web panel had it (DELETE /users/:id). Deletion is irreversible, so it goes
 * through a two-step Alert confirmation and never renders for your own row —
 * the backend 403s self-deletion from this endpoint.
 */
import React from 'react'
import { Alert } from 'react-native'
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native'
import { renderWithProviders } from '../../test/test-utils'

// ── module mocks ──────────────────────────────────────────────────────────────

const mockUpdateMutate = jest.fn()
const mockTransferMutate = jest.fn()

jest.mock('../../lib/queries', () => ({
  useAdminUsers: jest.fn(),
  useCurrentUser: jest.fn(),
  useDeleteUser: jest.fn(),
  useUpdateUserAdmin: jest.fn(() => ({
    mutate: mockUpdateMutate,
    isPending: false,
  })),
  useTransferSellerPortfolio: jest.fn(() => ({
    mutate: mockTransferMutate,
    isPending: false,
  })),
}))

jest.mock('../../components/UserAddressesPanel', () => ({
  UserAddressesPanel: () => null,
}))

import {
  useAdminUsers,
  useCurrentUser,
  useDeleteUser,
  useTransferSellerPortfolio,
} from '../../lib/queries'
import SuperUsersScreen from './users'
import type { AdminUser } from '../../lib/types'

const mockUsers = useAdminUsers as jest.MockedFunction<typeof useAdminUsers>
const mockMe = useCurrentUser as jest.MockedFunction<typeof useCurrentUser>
const mockDeleteUser = useDeleteUser as jest.MockedFunction<typeof useDeleteUser>
const mockTransferSellerPortfolio =
  useTransferSellerPortfolio as jest.MockedFunction<
    typeof useTransferSellerPortfolio
  >

// ── fixtures ──────────────────────────────────────────────────────────────────

function adminUser(overrides: Partial<AdminUser> = {}): AdminUser {
  return {
    id: 'user-1',
    fullName: 'Ana Cliente',
    phone: '+18095550001',
    email: null,
    role: 'client',
    hasActiveSubscription: false,
    subscriptionStatus: null,
    ...overrides,
  } as AdminUser
}

const users: AdminUser[] = [
  adminUser(),
  adminUser({ id: 'admin-1', fullName: 'Yo Mismo', role: 'super_admin_delivery' }),
]

/** Presses the destructive button of the most recent Alert.alert call. */
function confirmAlert(alertSpy: jest.SpyInstance, index = -1) {
  const calls = alertSpy.mock.calls
  const buttons = calls.at(index)?.[2] as
    | { text?: string; style?: string; onPress?: () => void }[]
    | undefined
  const destructive = buttons?.find((b) => b.style === 'destructive')
  // The final confirmation kicks off the mutation, which sets state — run it
  // inside act() so React flushes before assertions.
  act(() => {
    destructive?.onPress?.()
  })
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('SuperUsersScreen (mobile) — delete user', () => {
  let alertSpy: jest.SpyInstance
  let mutateAsync: jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {})
    mutateAsync = jest.fn().mockResolvedValue(undefined)

    mockUsers.mockReturnValue({
      data: users,
      isPending: false,
      isRefetching: false,
      refetch: jest.fn(),
    } as unknown as ReturnType<typeof useAdminUsers>)

    mockMe.mockReturnValue({
      data: { id: 'admin-1', role: 'super_admin_delivery' },
    } as unknown as ReturnType<typeof useCurrentUser>)

    mockDeleteUser.mockReturnValue({
      mutate: jest.fn(),
      mutateAsync,
      isPending: false,
    } as unknown as ReturnType<typeof useDeleteUser>)
  })

  afterEach(() => {
    alertSpy.mockRestore()
  })

  it('renders a delete action for other users', () => {
    renderWithProviders(<SuperUsersScreen />)

    expect(screen.getAllByText('Eliminar')).toHaveLength(1)
  })

  it('marks your own row as "Vos" instead of offering delete', () => {
    renderWithProviders(<SuperUsersScreen />)

    expect(screen.getByText('Vos')).toBeTruthy()
  })

  it('requires two confirmations before deleting', async () => {
    renderWithProviders(<SuperUsersScreen />)

    fireEvent.press(screen.getByText('Eliminar'))
    expect(alertSpy).toHaveBeenCalledTimes(1)
    // First confirmation alone must NOT delete anything.
    expect(mutateAsync).not.toHaveBeenCalled()

    confirmAlert(alertSpy)
    expect(alertSpy).toHaveBeenCalledTimes(2)
    expect(mutateAsync).not.toHaveBeenCalled()

    confirmAlert(alertSpy)
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith('user-1'))
  })

  it('names the user in the confirmation so you delete the right one', () => {
    renderWithProviders(<SuperUsersScreen />)

    fireEvent.press(screen.getByText('Eliminar'))
    expect(String(alertSpy.mock.calls[0][1])).toContain('Ana Cliente')
  })

  it('surfaces the server message when the deletion fails', async () => {
    mutateAsync.mockRejectedValueOnce({
      response: { data: { message: 'No podés eliminar tu propia cuenta.' } },
    })
    renderWithProviders(<SuperUsersScreen />)

    fireEvent.press(screen.getByText('Eliminar'))
    confirmAlert(alertSpy)
    confirmAlert(alertSpy)

    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith(
        'Error',
        'No podés eliminar tu propia cuenta.',
      ),
    )
  })
})


/**
 * Asignación de cartera (vendedor) y de atribución (promotor).
 *
 * Los chips de vendedor existían sin un solo test. Los de promotor son nuevos:
 * hasta ahora `referredById` solo se escribía UNA vez, en el alta, desde el
 * link de referido — para un cliente ya registrado no había forma de
 * atribuirlo a un promotor. El backend valida los dos casos (rol correcto y
 * no-auto-asignación); esto es solo la UI.
 */
describe('SuperUsersScreen (mobile) — asignación de vendedor y promotor', () => {
  const roster: AdminUser[] = [
    adminUser(),
    adminUser({ id: 's-1', fullName: 'Vendedor Uno', role: 'seller' }),
    adminUser({ id: 'p-1', fullName: 'Promotor Uno', role: 'promoter' }),
  ]

  beforeEach(() => {
    jest.clearAllMocks()

    mockUsers.mockReturnValue({
      data: roster,
      isPending: false,
      isRefetching: false,
      refetch: jest.fn(),
    } as unknown as ReturnType<typeof useAdminUsers>)

    mockMe.mockReturnValue({
      data: { id: 'admin-1', role: 'super_admin_delivery' },
    } as unknown as ReturnType<typeof useCurrentUser>)

    mockDeleteUser.mockReturnValue({
      mutate: jest.fn(),
      mutateAsync: jest.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useDeleteUser>)
  })

  it('asigna un vendedor a un cliente', () => {
    renderWithProviders(<SuperUsersScreen />)

    fireEvent.press(
      screen.getByLabelText('Asignarle Ana Cliente al vendedor Vendedor Uno'),
    )

    expect(mockUpdateMutate).toHaveBeenCalledWith({
      id: 'user-1',
      sellerId: 's-1',
    })
  })

  it('desasigna el vendedor mandando null, no ""', () => {
    mockUsers.mockReturnValue({
      data: [adminUser({ sellerId: 's-1' }), roster[1]],
      isPending: false,
      isRefetching: false,
      refetch: jest.fn(),
    } as unknown as ReturnType<typeof useAdminUsers>)
    renderWithProviders(<SuperUsersScreen />)

    fireEvent.press(screen.getByLabelText('Dejar a Ana Cliente sin vendedor'))

    expect(mockUpdateMutate).toHaveBeenCalledWith({
      id: 'user-1',
      sellerId: null,
    })
  })

  it('le pasa un cliente a un promotor', () => {
    renderWithProviders(<SuperUsersScreen />)

    fireEvent.press(
      screen.getByLabelText('Atribuir Ana Cliente al promotor Promotor Uno'),
    )

    expect(mockUpdateMutate).toHaveBeenCalledWith({
      id: 'user-1',
      referredById: 'p-1',
    })
  })

  it('le quita el promotor mandando null, no ""', () => {
    mockUsers.mockReturnValue({
      data: [adminUser({ referredById: 'p-1' }), roster[2]],
      isPending: false,
      isRefetching: false,
      refetch: jest.fn(),
    } as unknown as ReturnType<typeof useAdminUsers>)
    renderWithProviders(<SuperUsersScreen />)

    fireEvent.press(screen.getByLabelText('Dejar a Ana Cliente sin promotor'))

    expect(mockUpdateMutate).toHaveBeenCalledWith({
      id: 'user-1',
      referredById: null,
    })
  })

  it('no ofrece promotor para las filas de promotor ni de vendedor', () => {
    renderWithProviders(<SuperUsersScreen />)

    expect(
      screen.queryByLabelText('Dejar a Promotor Uno sin promotor'),
    ).toBeNull()
    expect(
      screen.queryByLabelText('Dejar a Vendedor Uno sin promotor'),
    ).toBeNull()
  })

  it('dice "Asignado (fuera de la lista)" en vez de pintarlo como libre', () => {
    // Si el promotor atribuido no está en el padrón, se dice — mostrarlo como
    // "Sin promotor" es dato falso: ese cliente ya le genera comisión a alguien.
    mockUsers.mockReturnValue({
      data: [adminUser({ referredById: 'fantasma' }), roster[2]],
      isPending: false,
      isRefetching: false,
      refetch: jest.fn(),
    } as unknown as ReturnType<typeof useAdminUsers>)
    renderWithProviders(<SuperUsersScreen />)

    expect(screen.getAllByText('Asignado (fuera de la lista)').length).toBe(1)
  })
})

/**
 * Reasignar cartera: "El super admin debe poder asignarle clientes a otro
 * vendedor" — de a uno ya se podía (chips por fila). Lo que faltaba era ver
 * la CARTERA completa de un vendedor y moverla entera a otro en un solo
 * tiro, vía POST /users/sellers/:sellerId/transfer.
 */
describe('SuperUsersScreen (mobile) — reasignar cartera de vendedor', () => {
  const portfolioRoster: AdminUser[] = [
    adminUser({ id: 'c-1', fullName: 'Cliente Uno', sellerId: 's-1' }),
    adminUser({ id: 'c-2', fullName: 'Cliente Dos', sellerId: 's-2' }),
    adminUser({ id: 'c-3', fullName: 'Cliente Suelto', sellerId: null }),
    adminUser({ id: 's-1', fullName: 'Vendedor Uno', role: 'seller' }),
    adminUser({ id: 's-2', fullName: 'Vendedor Dos', role: 'seller' }),
  ]

  let alertSpy: jest.SpyInstance

  beforeEach(() => {
    jest.clearAllMocks()
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {})

    mockUsers.mockReturnValue({
      data: portfolioRoster,
      isPending: false,
      isRefetching: false,
      refetch: jest.fn(),
    } as unknown as ReturnType<typeof useAdminUsers>)

    mockMe.mockReturnValue({
      data: { id: 'admin-1', role: 'super_admin_delivery' },
    } as unknown as ReturnType<typeof useCurrentUser>)

    mockDeleteUser.mockReturnValue({
      mutate: jest.fn(),
      mutateAsync: jest.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useDeleteUser>)

    mockTransferSellerPortfolio.mockReturnValue({
      mutate: mockTransferMutate,
      isPending: false,
    } as unknown as ReturnType<typeof useTransferSellerPortfolio>)
  })

  afterEach(() => {
    alertSpy.mockRestore()
  })

  it('el chip de vendedor acota la lista a su cartera', () => {
    renderWithProviders(<SuperUsersScreen />)

    fireEvent.press(screen.getByLabelText('Ver cartera de Vendedor Uno'))

    expect(screen.getByText('Cliente Uno')).toBeTruthy()
    expect(screen.queryByText('Cliente Dos')).toBeNull()
    expect(screen.queryByText('Cliente Suelto')).toBeNull()
  })

  it('"Sin vendedor" muestra solo los clientes sin asignar', () => {
    renderWithProviders(<SuperUsersScreen />)

    fireEvent.press(screen.getByLabelText('Ver clientes sin vendedor'))

    expect(screen.getByText('Cliente Suelto')).toBeTruthy()
    expect(screen.queryByText('Cliente Uno')).toBeNull()
    expect(screen.queryByText('Cliente Dos')).toBeNull()
  })

  it('la card de reasignar cartera solo aparece con un vendedor concreto', () => {
    renderWithProviders(<SuperUsersScreen />)

    expect(screen.queryByText('1 cliente de Vendedor Uno')).toBeNull()

    fireEvent.press(screen.getByLabelText('Ver cartera de Vendedor Uno'))
    expect(screen.getByText('1 cliente de Vendedor Uno')).toBeTruthy()

    fireEvent.press(screen.getByLabelText('Ver clientes sin vendedor'))
    expect(screen.queryByText('1 cliente de Vendedor Uno')).toBeNull()

    fireEvent.press(screen.getByLabelText('Ver clientes de todos los vendedores'))
    expect(screen.queryByText(/cliente de/)).toBeNull()
  })

  it('confirma la alerta, llama a la mutación con el destino y muestra el éxito', async () => {
    const mutate = jest.fn(
      (
        vars: { sellerId: string; toSellerId: string | null },
        opts?: { onSuccess?: (data: { moved: number }) => void },
      ) => {
        opts?.onSuccess?.({ moved: 1 })
      },
    )
    mockTransferSellerPortfolio.mockReturnValue({
      mutate,
      isPending: false,
    } as unknown as ReturnType<typeof useTransferSellerPortfolio>)

    renderWithProviders(<SuperUsersScreen />)
    fireEvent.press(screen.getByLabelText('Ver cartera de Vendedor Uno'))
    fireEvent.press(screen.getByLabelText('Elegir a Vendedor Dos como destino'))

    fireEvent.press(
      screen.getByText('Pasar 1 cliente a Vendedor Dos'),
    )
    expect(alertSpy).toHaveBeenCalledWith(
      'Reasignar cartera',
      '¿Pasar 1 cliente de Vendedor Uno a Vendedor Dos?',
      expect.anything(),
    )

    const buttons = alertSpy.mock.calls.at(-1)?.[2] as
      | { text?: string; onPress?: () => void }[]
      | undefined
    const confirm = buttons?.find((b) => b.text === 'Confirmar')
    act(() => {
      confirm?.onPress?.()
    })

    expect(mutate).toHaveBeenCalledWith(
      { sellerId: 's-1', toSellerId: 's-2' },
      expect.anything(),
    )
    expect(
      await screen.findByText('Se pasaron 1 cliente a Vendedor Dos'),
    ).toBeTruthy()
  })

  it('"Sin vendedor" como destino manda toSellerId null', () => {
    const mutate = jest.fn()
    mockTransferSellerPortfolio.mockReturnValue({
      mutate,
      isPending: false,
    } as unknown as ReturnType<typeof useTransferSellerPortfolio>)

    renderWithProviders(<SuperUsersScreen />)
    fireEvent.press(screen.getByLabelText('Ver cartera de Vendedor Uno'))
    fireEvent.press(screen.getByLabelText('Elegir sin vendedor como destino'))
    fireEvent.press(screen.getByText('Pasar 1 cliente a Sin vendedor'))

    const buttons = alertSpy.mock.calls.at(-1)?.[2] as
      | { text?: string; onPress?: () => void }[]
      | undefined
    const confirm = buttons?.find((b) => b.text === 'Confirmar')
    act(() => {
      confirm?.onPress?.()
    })

    expect(mutate).toHaveBeenCalledWith(
      { sellerId: 's-1', toSellerId: null },
      expect.anything(),
    )
  })

  it('muestra el mensaje de error de la API si la transferencia falla', async () => {
    const mutate = jest.fn(
      (
        _vars: unknown,
        opts?: { onError?: (e: unknown) => void },
      ) => {
        opts?.onError?.({
          response: { data: { message: 'No se pudo reasignar.' } },
        })
      },
    )
    mockTransferSellerPortfolio.mockReturnValue({
      mutate,
      isPending: false,
    } as unknown as ReturnType<typeof useTransferSellerPortfolio>)

    renderWithProviders(<SuperUsersScreen />)
    fireEvent.press(screen.getByLabelText('Ver cartera de Vendedor Uno'))
    fireEvent.press(screen.getByLabelText('Elegir a Vendedor Dos como destino'))
    fireEvent.press(screen.getByText('Pasar 1 cliente a Vendedor Dos'))

    const buttons = alertSpy.mock.calls.at(-1)?.[2] as
      | { text?: string; onPress?: () => void }[]
      | undefined
    const confirm = buttons?.find((b) => b.text === 'Confirmar')
    act(() => {
      confirm?.onPress?.()
    })

    expect(await screen.findByText('No se pudo reasignar.')).toBeTruthy()
  })

  it('un vendedor viendo la pantalla no ve los chips ni la card de cartera', () => {
    mockMe.mockReturnValue({
      data: { id: 's-1', role: 'seller' },
    } as unknown as ReturnType<typeof useCurrentUser>)

    renderWithProviders(<SuperUsersScreen />)

    expect(
      screen.queryByLabelText('Ver cartera de Vendedor Uno'),
    ).toBeNull()
    expect(
      screen.queryByLabelText('Ver clientes sin vendedor'),
    ).toBeNull()
    expect(screen.queryByText(/cliente de/)).toBeNull()
  })
})
