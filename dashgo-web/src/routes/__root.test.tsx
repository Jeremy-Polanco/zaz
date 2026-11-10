import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithRouter } from '../test/test-utils'
import type { Rental, Subscription } from '../lib/types'

vi.mock('../lib/api', () => ({ api: { get: vi.fn() }, TOKEN_KEY: 'dashgo.token' }))
vi.mock('../lib/auth', () => ({
  useCurrentUser: vi.fn(() => ({ data: null })),
  useLogout: vi.fn(() => vi.fn()),
}))
vi.mock('../lib/queries', () => ({
  useMyAssociateBalance: vi.fn(() => ({ data: { balanceCents: 0, entries: [] } })),
  useMySubscription: vi.fn(),
  useMyRentals: vi.fn(),
  useUpdateMe: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
}))

import { useMySubscription, useMyRentals } from '../lib/queries'
import { RoleNavLinks } from './__root'

const mockSub = vi.mocked(useMySubscription)
const mockRentals = vi.mocked(useMyRentals)

function setup(role: string, opts: { sub?: Subscription | null; rentals?: Rental[] } = {}) {
  mockSub.mockReturnValue({ data: opts.sub ?? null } as unknown as ReturnType<
    typeof useMySubscription
  >)
  mockRentals.mockReturnValue({ data: opts.rentals ?? [] } as unknown as ReturnType<
    typeof useMyRentals
  >)
  renderWithRouter(() => <RoleNavLinks role={role} linkClass="x" />)
}

const sub = { id: 's1', status: 'active' } as Subscription

describe('RoleNavLinks — enlace de suscripción del cliente / asociado', () => {
  beforeEach(() => vi.clearAllMocks())

  it('el cliente ve Suscripción', async () => {
    setup('client')
    expect(await screen.findByText('Suscripción')).toBeInTheDocument()
  })

  it('el asociado sin suscripción no ve Suscripción', async () => {
    setup('associate')
    await screen.findByText('Catálogo')
    expect(screen.queryByText('Suscripción')).not.toBeInTheDocument()
  })

  it('el asociado que ya tiene una suscripción la sigue viendo', async () => {
    setup('associate', { sub })
    expect(await screen.findByText('Suscripción')).toBeInTheDocument()
  })
})
