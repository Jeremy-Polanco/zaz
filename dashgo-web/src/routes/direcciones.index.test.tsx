import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '../test/test-utils'
import type { UserAddress } from '../lib/types'

vi.mock('../lib/queries', () => ({ useMyAddresses: vi.fn() }))
vi.mock('../lib/api', () => ({ api: { get: vi.fn() }, TOKEN_KEY: 'dashgo.token' }))
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@tanstack/react-router')>()
  return {
    ...original,
    createFileRoute: () => () => ({}),
    redirect: vi.fn(),
    Link: ({
      children,
      ...props
    }: {
      children: React.ReactNode
      to?: string
      params?: unknown
    }) => <a {...props}>{children}</a>,
  }
})

import { useMyAddresses } from '../lib/queries'
import { AddressesPage } from './direcciones.index'

const mockUseMyAddresses = vi.mocked(useMyAddresses)

function setAddresses(addresses: UserAddress[] | undefined, isPending = false) {
  mockUseMyAddresses.mockReturnValue({
    data: addresses,
    isPending,
  } as unknown as ReturnType<typeof useMyAddresses>)
}

const sample: UserAddress[] = [
  {
    id: 'a-1',
    userId: 'u-1',
    label: 'Casa',
    line1: 'Av. 27 de Febrero 123',
    line2: 'Apto 3B',
    lat: 40.84,
    lng: -73.93,
    instructions: null,
    isDefault: true,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  },
  {
    id: 'a-2',
    userId: 'u-1',
    label: 'Oficina',
    line1: 'Calle El Conde 45',
    line2: null,
    lat: 40.85,
    lng: -73.94,
    instructions: null,
    isDefault: false,
    createdAt: '2026-06-02T00:00:00.000Z',
    updatedAt: '2026-06-02T00:00:00.000Z',
  },
]

describe('direcciones (address book list)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lists each saved address and marks the default one', () => {
    setAddresses(sample)
    renderWithProviders(<AddressesPage />)
    expect(screen.getByText('Casa')).toBeInTheDocument()
    expect(screen.getByText('Oficina')).toBeInTheDocument()
    expect(screen.getByText('Por defecto')).toBeInTheDocument()
  })

  it('shows the empty state with a create CTA when there are none', () => {
    setAddresses([])
    renderWithProviders(<AddressesPage />)
    expect(screen.getByText(/Sin direcciones guardadas/i)).toBeInTheDocument()
    // The "+ Agregar dirección" CTA still appears (header + empty state).
    expect(
      screen.getAllByText(/Agregar dirección/i).length,
    ).toBeGreaterThanOrEqual(1)
  })

  it('shows a loading indicator while pending', () => {
    setAddresses(undefined, true)
    renderWithProviders(<AddressesPage />)
    expect(screen.getByText(/Cargando direcciones/i)).toBeInTheDocument()
  })
})
