/**
 * T43 — Address List screen tests (RED → GREEN with T44 impl)
 *
 * Scenarios:
 *   1. Renders both address labels when list has 2 items
 *   2. Default badge appears on the default address
 *   3. No default badge on non-default address
 *   4. "Agregar" CTA is always visible
 *   5. Empty state shown when list is empty
 *   6. "Agregar" CTA visible in empty state
 *   7. Tapping "Agregar" navigates to /addresses/new
 *   8. Tapping an address row navigates to /addresses/[id]
 */
import React from 'react'
import { fireEvent } from '@testing-library/react-native'
import { renderWithProviders } from '../../test/test-utils'

// ── module mocks ──────────────────────────────────────────────────────────────

jest.mock('../../lib/queries', () => ({
  useMyAddresses: jest.fn(),
}))

jest.mock('expo-router', () => {
  const router = {
    push: jest.fn(),
    back: jest.fn(),
    replace: jest.fn(),
    navigate: jest.fn(),
    dismiss: jest.fn(),
  }
  return {
    router,
    useRouter: () => router,
    useLocalSearchParams: jest.fn(() => ({})),
    Link: 'Link',
    Stack: { Screen: 'Stack.Screen' },
  }
})

jest.mock('../../lib/api', () => ({
  API_URL: 'http://localhost:3000',
  api: {
    get: jest.fn(),
    post: jest.fn(),
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
  },
}))

// ── imports after mocks ───────────────────────────────────────────────────────

import { useMyAddresses } from '../../lib/queries'
import { router } from 'expo-router'
import AddressesIndex from './index'
import type { UserAddress } from '../../lib/types'

// ── typed mock helpers ────────────────────────────────────────────────────────

const mockUseMyAddresses = useMyAddresses as jest.MockedFunction<typeof useMyAddresses>
const mockRouter = router as jest.Mocked<typeof router>

function makeAddress(overrides: Partial<UserAddress> = {}): UserAddress {
  return {
    id: 'addr-1',
    userId: 'user-1',
    label: 'Casa',
    line1: 'Av. 27 de Febrero 123',
    line2: null,
    lat: 18.47,
    lng: -69.9,
    instructions: null,
    isDefault: false,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

function setupMocks(addresses: UserAddress[], isPending = false) {
  mockUseMyAddresses.mockReturnValue({
    data: addresses,
    isPending,
    isLoading: isPending,
  } as unknown as ReturnType<typeof useMyAddresses>)
}

afterEach(() => {
  jest.clearAllMocks()
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AddressesIndex — list with 2 addresses', () => {
  const addr1 = makeAddress({ id: 'addr-1', label: 'Casa', isDefault: true })
  const addr2 = makeAddress({ id: 'addr-2', label: 'Oficina', isDefault: false })

  beforeEach(() => setupMocks([addr1, addr2]))

  it('renders both address labels', () => {
    const { getByText } = renderWithProviders(<AddressesIndex />)
    expect(getByText('Casa')).toBeTruthy()
    expect(getByText('Oficina')).toBeTruthy()
  })

  it('shows default badge on the default address', () => {
    const { getByText } = renderWithProviders(<AddressesIndex />)
    // Default badge text
    expect(getByText('Por defecto')).toBeTruthy()
  })

  it('does not show extra default badges', () => {
    const { queryAllByText } = renderWithProviders(<AddressesIndex />)
    expect(queryAllByText('Por defecto')).toHaveLength(1)
  })

  it('renders the Agregar CTA', () => {
    const { getByText } = renderWithProviders(<AddressesIndex />)
    expect(getByText(/Agregar/)).toBeTruthy()
  })

  it('navigates to /addresses/new when Agregar is tapped', () => {
    const { getByText } = renderWithProviders(<AddressesIndex />)
    fireEvent.press(getByText(/Agregar/))
    expect(mockRouter.push).toHaveBeenCalledWith('/addresses/new')
  })

  it('navigates to /addresses/[id] when an address row is tapped', () => {
    const { getByText } = renderWithProviders(<AddressesIndex />)
    fireEvent.press(getByText('Oficina'))
    expect(mockRouter.push).toHaveBeenCalledWith('/addresses/addr-2')
  })
})

describe('AddressesIndex — empty state', () => {
  beforeEach(() => setupMocks([]))

  it('shows empty state message', () => {
    const { getByText } = renderWithProviders(<AddressesIndex />)
    expect(getByText(/Sin direcciones guardadas/)).toBeTruthy()
  })

  it('shows Agregar CTA in empty state', () => {
    const { getByText } = renderWithProviders(<AddressesIndex />)
    expect(getByText(/Agregar/)).toBeTruthy()
  })

  it('navigates to /addresses/new from empty state Agregar', () => {
    const { getByText } = renderWithProviders(<AddressesIndex />)
    fireEvent.press(getByText(/Agregar/))
    expect(mockRouter.push).toHaveBeenCalledWith('/addresses/new')
  })
})

describe('AddressesIndex — loading state', () => {
  it('renders without crashing while loading', () => {
    setupMocks([], true)
    const { UNSAFE_getByType } = renderWithProviders(<AddressesIndex />)
    const { ActivityIndicator } = require('react-native')
    expect(UNSAFE_getByType(ActivityIndicator)).toBeTruthy()
  })
})
