import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import { renderWithProviders } from '../test/test-utils'
import type { UserAddress } from '../lib/types'

vi.mock('../lib/queries', () => ({
  useMyAddresses: vi.fn(),
  useSetDefaultAddress: vi.fn(),
  useCreateAddress: vi.fn(),
}))
vi.mock('../lib/geo', () => ({
  requestBrowserLocation: vi.fn(),
  reverseGeocode: vi.fn(),
}))
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    ...props
  }: {
    children: React.ReactNode
    to?: string
    onClick?: () => void
  }) => <a {...props}>{children}</a>,
}))

import {
  useMyAddresses,
  useSetDefaultAddress,
  useCreateAddress,
} from '../lib/queries'
import { AddressSwitcher } from './AddressSwitcher'

const mockUseMyAddresses = vi.mocked(useMyAddresses)
const mockUseSetDefaultAddress = vi.mocked(useSetDefaultAddress)
const mockUseCreateAddress = vi.mocked(useCreateAddress)

function setAddresses(addresses: UserAddress[] | undefined) {
  mockUseMyAddresses.mockReturnValue({
    data: addresses,
  } as unknown as ReturnType<typeof useMyAddresses>)
}

function setSetDefault() {
  const mutate = vi.fn()
  mockUseSetDefaultAddress.mockReturnValue({
    mutate,
    mutateAsync: vi.fn(),
    isPending: false,
    variables: undefined,
  } as unknown as ReturnType<typeof useSetDefaultAddress>)
  return mutate
}

function setCreateAddress() {
  mockUseCreateAddress.mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof useCreateAddress>)
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

describe('AddressSwitcher (header)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setSetDefault()
    setCreateAddress()
  })

  it('shows the active address label on the trigger', () => {
    setAddresses(sample)
    renderWithProviders(<AddressSwitcher />)
    // The trigger surfaces the default address ("Casa").
    expect(screen.getByText('Casa')).toBeInTheDocument()
  })

  it('opens the modal and lists saved addresses', () => {
    setAddresses(sample)
    renderWithProviders(<AddressSwitcher />)
    fireEvent.click(screen.getByRole('button', { name: /Casa/i }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Oficina')).toBeInTheDocument()
  })

  it('swaps the active address when a non-active one is chosen', () => {
    setAddresses(sample)
    const mutate = setSetDefault()
    renderWithProviders(<AddressSwitcher />)
    fireEvent.click(screen.getByRole('button', { name: /Casa/i }))
    // The active "Casa" row is disabled; choosing "Oficina" triggers set-default.
    fireEvent.click(screen.getByRole('button', { name: /Oficina/i }))
    expect(mutate.mock.calls[0][0]).toBe('a-2')
  })

  it('falls back to an "Agregar dirección" trigger when there are none', () => {
    setAddresses([])
    renderWithProviders(<AddressSwitcher />)
    expect(screen.getByText(/Agregar dirección/i)).toBeInTheDocument()
  })
})
