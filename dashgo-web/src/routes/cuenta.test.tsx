import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithRouter } from '../test/test-utils'
import type { AssociateBalance, AuthUser } from '../lib/types'

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const original = await importOriginal<typeof import('@tanstack/react-router')>()
  return {
    ...original,
    createFileRoute: () => () => ({}),
    redirect: vi.fn(),
    useRouter: () => ({ navigate: vi.fn() }),
  }
})

vi.mock('../lib/api', () => ({
  api: { get: vi.fn() },
  TOKEN_KEY: 'dashgo.token',
}))

vi.mock('../lib/auth', () => ({
  useCurrentUser: vi.fn(),
  useLogout: vi.fn(() => vi.fn()),
  useDeleteAccount: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
}))

vi.mock('../lib/queries', () => ({
  useUpdateMe: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useMyAssociateBalance: vi.fn(),
  useMySubscription: vi.fn(() => ({ data: null })),
  useMyRentals: vi.fn(() => ({ data: [] })),
}))

import { useCurrentUser } from '../lib/auth'
import { useMyAssociateBalance, useMySubscription, useMyRentals } from '../lib/queries'
import { AccountPage } from './cuenta'

const mockUseCurrentUser = vi.mocked(useCurrentUser)
const mockUseBalance = vi.mocked(useMyAssociateBalance)
const mockUseSubscription = vi.mocked(useMySubscription)
const mockUseRentals = vi.mocked(useMyRentals)

function mkMe(role: AuthUser['role']): AuthUser {
  return {
    id: 'u-1',
    email: null,
    fullName: 'Persona',
    phone: null,
    role,
    addressDefault: null,
    activeLocationId: null,
    referralCode: null,
    creditLocked: false,
  }
}

function setup(role: AuthUser['role'], balance: AssociateBalance) {
  mockUseCurrentUser.mockReturnValue({
    data: mkMe(role),
    isPending: false,
  } as unknown as ReturnType<typeof useCurrentUser>)
  mockUseBalance.mockReturnValue({
    data: balance,
    isPending: false,
  } as unknown as ReturnType<typeof useMyAssociateBalance>)
}

describe('AccountPage — enlace al pool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('al asociado le muestra el enlace al pool', async () => {
    setup('associate', { balanceCents: 0, entries: [] })
    renderWithRouter(AccountPage)
    expect(await screen.findByText('Pool de asociados')).toBeInTheDocument()
  })

  it('un cliente con saldo (ex asociado) ve el enlace para llegar a su historial', async () => {
    setup('client', { balanceCents: 800, entries: [] })
    renderWithRouter(AccountPage)
    expect(await screen.findByText('Pool de asociados')).toBeInTheDocument()
    expect(mockUseBalance).toHaveBeenCalledWith(true)
  })

  it('un cliente sin saldo no ve el enlace', async () => {
    setup('client', { balanceCents: 0, entries: [] })
    renderWithRouter(AccountPage)
    await screen.findByText('Suscripción')
    expect(screen.queryByText('Pool de asociados')).not.toBeInTheDocument()
  })
})

describe('AccountPage — atajos de bebedero según el rol', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseSubscription.mockReturnValue({ data: null } as unknown as ReturnType<
      typeof useMySubscription
    >)
    mockUseRentals.mockReturnValue({ data: [] } as unknown as ReturnType<
      typeof useMyRentals
    >)
  })

  it('un cliente ve Mis alquileres y Suscripción', async () => {
    setup('client', { balanceCents: 0, entries: [] })
    renderWithRouter(AccountPage)
    expect(await screen.findByText('Mis alquileres')).toBeInTheDocument()
    expect(screen.getByText('Suscripción')).toBeInTheDocument()
  })

  it('un asociado sin suscripción ni alquileres no ve ninguno de los dos', async () => {
    setup('associate', { balanceCents: 0, entries: [] })
    renderWithRouter(AccountPage)
    await screen.findByText('Pool de asociados')
    expect(screen.queryByText('Mis alquileres')).not.toBeInTheDocument()
    expect(screen.queryByText('Suscripción')).not.toBeInTheDocument()
  })

  it('un asociado con suscripción sigue viendo Suscripción', async () => {
    setup('associate', { balanceCents: 0, entries: [] })
    mockUseSubscription.mockReturnValue({
      data: { id: 's1', status: 'active' },
    } as unknown as ReturnType<typeof useMySubscription>)
    renderWithRouter(AccountPage)
    expect(await screen.findByText('Suscripción')).toBeInTheDocument()
    expect(screen.queryByText('Mis alquileres')).not.toBeInTheDocument()
  })

  it('un asociado con un alquiler sigue viendo Mis alquileres', async () => {
    setup('associate', { balanceCents: 0, entries: [] })
    mockUseRentals.mockReturnValue({
      data: [{ id: 'r1' }],
    } as unknown as ReturnType<typeof useMyRentals>)
    renderWithRouter(AccountPage)
    expect(await screen.findByText('Mis alquileres')).toBeInTheDocument()
    expect(screen.queryByText('Suscripción')).not.toBeInTheDocument()
  })
})
