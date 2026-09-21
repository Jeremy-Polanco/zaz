import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../test/test-utils'
import type { AdminUser, AuthUser } from '../lib/types'

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

// `useTransferSellerPortfolio` is intentionally left as the REAL
// implementation (spread from the original module) so the transfer tests
// below exercise the actual mutationFn and assert on the mocked `api.post`
// call — not just on a stubbed `mutate`. Every other hook stays mocked,
// matching the rest of this file's page-level tests.
vi.mock('../lib/queries', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/queries')>()
  return {
    ...original,
    useAdminUsers: vi.fn(() => ({ data: [], isPending: false })),
    useCurrentUser: vi.fn(() => ({ data: null })),
    useDeleteUser: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
    useUpdateUserAdmin: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  }
})

vi.mock('../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  TOKEN_KEY: 'dashgo.token',
  productImageUrl: vi.fn(),
}))

vi.mock('../components/UserAddressesPanel', () => ({
  UserAddressesPanel: () => null,
}))

import { api } from '../lib/api'
import { useAdminUsers, useCurrentUser } from '../lib/queries'
import {
  PromoterCell,
  RoleCell,
  SellerCell,
  SubscriptionBadge,
  SuperUsersPage,
} from './super.users'

const mockUseAdminUsers = vi.mocked(useAdminUsers)
const mockUseCurrentUser = vi.mocked(useCurrentUser)

function mkUser(o: Partial<AdminUser> = {}): AdminUser {
  return {
    id: 'u-1',
    email: null,
    fullName: 'Cliente Uno',
    phone: null,
    role: 'client',
    referralCode: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    hasActiveSubscription: false,
    subscriptionStatus: null,
    sellerId: null,
    ...o,
  }
}

const SELLER = mkUser({ id: 's-1', fullName: 'Vendedor Uno', role: 'seller' })
const PROMOTER = mkUser({ id: 'p-1', fullName: 'Promotor Uno', role: 'promoter' })

describe('SubscriptionBadge', () => {
  it('distingue "Pago pendiente" (past_due) de "Activa" y de "Sin suscripción"', () => {
    // past_due sigue siendo suscriptor para el cobro; mostrarlo como "Sin
    // suscripción" hacía creer que la app había perdido la suscripción.
    renderWithProviders(
      <>
        <SubscriptionBadge
          user={mkUser({ hasActiveSubscription: true, subscriptionStatus: 'active' })}
        />
        <SubscriptionBadge user={mkUser({ id: 'u-2', subscriptionStatus: 'past_due' })} />
        <SubscriptionBadge user={mkUser({ id: 'u-3', subscriptionStatus: null })} />
      </>,
    )
    expect(screen.getByText('Activa')).toBeInTheDocument()
    expect(screen.getByText('Pago pendiente')).toBeInTheDocument()
    expect(screen.getByText('Sin suscripción')).toBeInTheDocument()
  })
})

describe('SellerCell', () => {
  it('shows the assigned seller name to a non-admin viewer', () => {
    renderWithProviders(
      <SellerCell
        user={mkUser({ sellerId: 's-1' })}
        sellers={[SELLER]}
        canAssign={false}
        onAssign={vi.fn()}
        pending={false}
      />,
    )
    expect(screen.getByText('Vendedor Uno')).toBeInTheDocument()
  })

  it('renders a picker for the super admin, with the current seller selected', () => {
    renderWithProviders(
      <SellerCell
        user={mkUser({ sellerId: 's-1' })}
        sellers={[SELLER]}
        canAssign
        onAssign={vi.fn()}
        pending={false}
      />,
    )
    const select = screen.getByLabelText('Vendedor de Cliente Uno')
    expect((select as HTMLSelectElement).value).toBe('s-1')
  })

  it('assigns a seller', async () => {
    const onAssign = vi.fn()
    renderWithProviders(
      <SellerCell
        user={mkUser()}
        sellers={[SELLER]}
        canAssign
        onAssign={onAssign}
        pending={false}
      />,
    )
    await userEvent.selectOptions(
      screen.getByLabelText('Vendedor de Cliente Uno'),
      's-1',
    )
    expect(onAssign).toHaveBeenCalledWith('s-1')
  })

  it('unassigns with the empty option, sending null (not "")', async () => {
    const onAssign = vi.fn()
    renderWithProviders(
      <SellerCell
        user={mkUser({ sellerId: 's-1' })}
        sellers={[SELLER]}
        canAssign
        onAssign={onAssign}
        pending={false}
      />,
    )
    await userEvent.selectOptions(
      screen.getByLabelText('Vendedor de Cliente Uno'),
      '',
    )
    expect(onAssign).toHaveBeenCalledWith(null)
  })

  it('the column does not apply to sellers or admins', () => {
    const { rerender } = renderWithProviders(
      <SellerCell
        user={mkUser({ role: 'seller' })}
        sellers={[SELLER]}
        canAssign
        onAssign={vi.fn()}
        pending={false}
      />,
    )
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()

    rerender(
      <SellerCell
        user={mkUser({ role: 'super_admin_delivery' })}
        sellers={[SELLER]}
        canAssign
        onAssign={vi.fn()}
        pending={false}
      />,
    )
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('REGRESSION: an assigned seller missing from the roster must not read as "Sin asignar"', () => {
    // El padrón de vendedores se derivaba de la lista FILTRADA por suscripción.
    // Con "Con suscripción activa" puesto, un vendedor no suscripto salía de la
    // lista y su cliente aparecía como "Sin asignar" — dato falso, no una
    // limitación. La página ahora arma el padrón con la lista sin filtrar.
    renderWithProviders(
      <SellerCell
        user={mkUser({ sellerId: 's-1' })}
        sellers={[]} // padrón incompleto
        canAssign={false}
        onAssign={vi.fn()}
        pending={false}
      />,
    )
    expect(screen.queryByText('Sin asignar')).not.toBeInTheDocument()
    expect(screen.getByText('Asignado')).toBeInTheDocument()
  })

  it('REGRESSION: the picker keeps an unresolvable seller selected, never silently unassigns', async () => {
    const onAssign = vi.fn()
    renderWithProviders(
      <SellerCell
        user={mkUser({ sellerId: 's-1' })}
        sellers={[]}
        canAssign
        onAssign={onAssign}
        pending={false}
      />,
    )
    const select = screen.getByLabelText(
      'Vendedor de Cliente Uno',
    ) as HTMLSelectElement
    // Sin la opción "fuera de la lista" el select cae a "" y el próximo submit
    // desasignaría al cliente sin que nadie lo pidiera.
    expect(select.value).toBe('s-1')
    expect(onAssign).not.toHaveBeenCalled()
  })
})

describe('RoleCell', () => {
  it('promotes a client to seller', async () => {
    const onChange = vi.fn()
    renderWithProviders(
      <RoleCell
        user={mkUser()}
        canEdit
        onChange={onChange}
        pending={false}
      />,
    )
    await userEvent.selectOptions(
      screen.getByLabelText('Rol de Cliente Uno'),
      'seller',
    )
    expect(onChange).toHaveBeenCalledWith('seller')
  })

  it('never offers super admin — that role is not grantable from the panel', () => {
    renderWithProviders(
      <RoleCell user={mkUser()} canEdit onChange={vi.fn()} pending={false} />,
    )
    const options = screen
      .getAllByRole('option')
      .map((o) => (o as HTMLOptionElement).value)
    expect(options).toEqual(['client', 'seller', 'promoter'])
    expect(options).not.toContain('super_admin_delivery')
  })

  it('renders plain text for a super admin row', () => {
    renderWithProviders(
      <RoleCell
        user={mkUser({ role: 'super_admin_delivery' })}
        canEdit
        onChange={vi.fn()}
        pending={false}
      />,
    )
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.getByText('Reparto')).toBeInTheDocument()
  })

  it('renders plain text when the viewer cannot edit', () => {
    renderWithProviders(
      <RoleCell user={mkUser()} canEdit={false} onChange={vi.fn()} pending={false} />,
    )
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.getByText('Cliente')).toBeInTheDocument()
  })
})


describe('PromoterCell', () => {
  it('shows the assigned promoter name to a non-admin viewer', () => {
    renderWithProviders(
      <PromoterCell
        user={mkUser({ referredById: 'p-1' })}
        promoters={[PROMOTER]}
        canAssign={false}
        onAssign={vi.fn()}
        pending={false}
      />,
    )
    expect(screen.getByText('Promotor Uno')).toBeInTheDocument()
  })

  it('renders a picker for the super admin, with the current promoter selected', () => {
    renderWithProviders(
      <PromoterCell
        user={mkUser({ referredById: 'p-1' })}
        promoters={[PROMOTER]}
        canAssign
        onAssign={vi.fn()}
        pending={false}
      />,
    )
    const select = screen.getByLabelText('Promotor de Cliente Uno')
    expect((select as HTMLSelectElement).value).toBe('p-1')
  })

  it('hands a customer to a promoter', async () => {
    // Lo que pidió el dueño: hasta ahora la única forma era el link de
    // referido en el alta, y para un cliente ya registrado no había ninguna.
    const onAssign = vi.fn()
    renderWithProviders(
      <PromoterCell
        user={mkUser()}
        promoters={[PROMOTER]}
        canAssign
        onAssign={onAssign}
        pending={false}
      />,
    )
    await userEvent.selectOptions(
      screen.getByLabelText('Promotor de Cliente Uno'),
      'p-1',
    )
    expect(onAssign).toHaveBeenCalledWith('p-1')
  })

  it('unassigns with the empty option, sending null (not "")', async () => {
    const onAssign = vi.fn()
    renderWithProviders(
      <PromoterCell
        user={mkUser({ referredById: 'p-1' })}
        promoters={[PROMOTER]}
        canAssign
        onAssign={onAssign}
        pending={false}
      />,
    )
    await userEvent.selectOptions(
      screen.getByLabelText('Promotor de Cliente Uno'),
      '',
    )
    expect(onAssign).toHaveBeenCalledWith(null)
  })

  it('the column does not apply to promoters, sellers or admins', () => {
    const { rerender } = renderWithProviders(
      <PromoterCell
        user={mkUser({ role: 'promoter' })}
        promoters={[PROMOTER]}
        canAssign
        onAssign={vi.fn()}
        pending={false}
      />,
    )
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()

    rerender(
      <PromoterCell
        user={mkUser({ role: 'seller' })}
        promoters={[PROMOTER]}
        canAssign
        onAssign={vi.fn()}
        pending={false}
      />,
    )
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()

    rerender(
      <PromoterCell
        user={mkUser({ role: 'super_admin_delivery' })}
        promoters={[PROMOTER]}
        canAssign
        onAssign={vi.fn()}
        pending={false}
      />,
    )
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('an assigned promoter missing from the roster must not read as "Sin promotor"', () => {
    renderWithProviders(
      <PromoterCell
        user={mkUser({ referredById: 'p-1' })}
        promoters={[]} // padrón incompleto
        canAssign={false}
        onAssign={vi.fn()}
        pending={false}
      />,
    )
    expect(screen.queryByText('Sin promotor')).not.toBeInTheDocument()
    expect(screen.getByText('Asignado')).toBeInTheDocument()
  })

  it('the picker keeps an unresolvable promoter selected, never silently unassigns', () => {
    const onAssign = vi.fn()
    renderWithProviders(
      <PromoterCell
        user={mkUser({ referredById: 'p-1' })}
        promoters={[]}
        canAssign
        onAssign={onAssign}
        pending={false}
      />,
    )
    const select = screen.getByLabelText(
      'Promotor de Cliente Uno',
    ) as HTMLSelectElement
    expect(select.value).toBe('p-1')
    expect(onAssign).not.toHaveBeenCalled()
  })
})

// ── SuperUsersPage — seller portfolio filter & transfer ─────────────────────────
// "El super admin debe poder asignarle clientes a otro vendedor" (owner,
// 2026-09-14). `useTransferSellerPortfolio` is left un-mocked (see the
// `vi.mock('../lib/queries', ...)` factory above) so these tests assert on
// the real request the app sends via the mocked `api.post`.

function mkMe(o: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'admin-1',
    email: null,
    fullName: 'Admin',
    phone: null,
    role: 'super_admin_delivery',
    addressDefault: null,
    activeLocationId: null,
    referralCode: null,
    creditLocked: false,
    ...o,
  }
}

const SUPER_ADMIN = mkMe()
const SELLER_1 = mkUser({ id: 's-1', fullName: 'Vendedor Uno', role: 'seller' })
const SELLER_2 = mkUser({ id: 's-2', fullName: 'Vendedor Dos', role: 'seller' })
const CLIENT_A = mkUser({ id: 'c-1', fullName: 'Cliente A', sellerId: 's-1' })
const CLIENT_B = mkUser({ id: 'c-2', fullName: 'Cliente B', sellerId: 's-1' })
const CLIENT_C = mkUser({ id: 'c-3', fullName: 'Cliente C', sellerId: null })
const CLIENT_D = mkUser({ id: 'c-4', fullName: 'Cliente D', sellerId: 's-2' })
const ALL_USERS = [SELLER_1, SELLER_2, CLIENT_A, CLIENT_B, CLIENT_C, CLIENT_D]

function setup(opts: { me?: AuthUser | null; users?: AdminUser[] } = {}) {
  mockUseCurrentUser.mockReturnValue({
    data: opts.me === undefined ? SUPER_ADMIN : opts.me,
  } as unknown as ReturnType<typeof useCurrentUser>)
  mockUseAdminUsers.mockReturnValue({
    data: opts.users ?? ALL_USERS,
    isPending: false,
  } as unknown as ReturnType<typeof useAdminUsers>)
}

describe('SuperUsersPage — seller portfolio filter & transfer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('narrows the list to a seller\'s customers', async () => {
    setup()
    renderWithProviders(<SuperUsersPage />)

    await userEvent.selectOptions(
      screen.getByLabelText('Filtrar por vendedor'),
      's-1',
    )

    expect(screen.getByText('Cliente A')).toBeInTheDocument()
    expect(screen.getByText('Cliente B')).toBeInTheDocument()
    expect(screen.queryByText('Cliente C')).not.toBeInTheDocument()
    expect(screen.queryByText('Cliente D')).not.toBeInTheDocument()
  })

  it('"Sin vendedor" shows only unassigned customers', async () => {
    setup()
    renderWithProviders(<SuperUsersPage />)

    await userEvent.selectOptions(
      screen.getByLabelText('Filtrar por vendedor'),
      'none',
    )

    expect(screen.getByText('Cliente C')).toBeInTheDocument()
    expect(screen.queryByText('Cliente A')).not.toBeInTheDocument()
    expect(screen.queryByText('Cliente D')).not.toBeInTheDocument()
  })

  it('shows the reassign bar only once a concrete seller is picked', async () => {
    setup()
    renderWithProviders(<SuperUsersPage />)

    expect(
      screen.queryByLabelText('Pasar la cartera a'),
    ).not.toBeInTheDocument()

    await userEvent.selectOptions(
      screen.getByLabelText('Filtrar por vendedor'),
      'none',
    )
    expect(
      screen.queryByLabelText('Pasar la cartera a'),
    ).not.toBeInTheDocument()

    await userEvent.selectOptions(
      screen.getByLabelText('Filtrar por vendedor'),
      's-1',
    )
    expect(screen.getByLabelText('Pasar la cartera a')).toBeInTheDocument()
    expect(screen.getByText('2 clientes de Vendedor Uno')).toBeInTheDocument()
  })

  it('confirms the transfer to another seller and shows the success line', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { moved: 2 } })
    setup()
    renderWithProviders(<SuperUsersPage />)

    await userEvent.selectOptions(
      screen.getByLabelText('Filtrar por vendedor'),
      's-1',
    )
    await userEvent.selectOptions(
      screen.getByLabelText('Pasar la cartera a'),
      's-2',
    )
    await userEvent.click(
      screen.getByRole('button', { name: /Pasar 2 clientes/ }),
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Confirmar traspaso' }),
    )

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/users/sellers/s-1/transfer', {
        toSellerId: 's-2',
      }),
    )
    expect(
      await screen.findByText('Se pasaron 2 clientes a Vendedor Dos.'),
    ).toBeInTheDocument()
  })

  it('sends null when the destination is "Sin vendedor"', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { moved: 1 } })
    setup()
    renderWithProviders(<SuperUsersPage />)

    await userEvent.selectOptions(
      screen.getByLabelText('Filtrar por vendedor'),
      's-2',
    )
    await userEvent.selectOptions(
      screen.getByLabelText('Pasar la cartera a'),
      '',
    )
    await userEvent.click(
      screen.getByRole('button', { name: /Pasar 1 cliente/ }),
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Confirmar traspaso' }),
    )

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/users/sellers/s-2/transfer', {
        toSellerId: null,
      }),
    )
    expect(
      await screen.findByText('Se pasaron 1 cliente a Sin vendedor.'),
    ).toBeInTheDocument()
  })

  it('a non-admin viewer never sees the filter or the transfer bar', () => {
    setup({ me: mkMe({ id: 's-1', role: 'seller' }) })
    renderWithProviders(<SuperUsersPage />)

    expect(
      screen.queryByLabelText('Filtrar por vendedor'),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByLabelText('Pasar la cartera a'),
    ).not.toBeInTheDocument()
  })
})
