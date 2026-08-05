import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../test/test-utils'
import type { AdminUser } from '../lib/types'

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
  useAdminUsers: vi.fn(() => ({ data: [], isPending: false })),
  useCurrentUser: vi.fn(() => ({ data: null })),
  useDeleteUser: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useUpdateUserAdmin: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}))

vi.mock('../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  TOKEN_KEY: 'dashgo.token',
  productImageUrl: vi.fn(),
}))

vi.mock('../components/UserAddressesPanel', () => ({
  UserAddressesPanel: () => null,
}))

import { RoleCell, SellerCell } from './super.users'

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
