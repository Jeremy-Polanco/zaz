/**
 * T90 — Profile tab "Mis alquileres" link tests (RED → GREEN with T91 impl)
 *
 * Scenarios:
 *   1. "Mis alquileres" row is visible for client users
 *   2. Tapping the row navigates to /rentals
 */
import React from 'react'
import { fireEvent } from '@testing-library/react-native'
import { renderWithProviders } from '../../test/test-utils'

// ── module mocks ──────────────────────────────────────────────────────────────

jest.mock('../../lib/queries', () => ({
  useCurrentUser: jest.fn(),
  useLogout: jest.fn(),
  useDeleteAccount: jest.fn(),
  useUpdateMe: jest.fn(() => ({
    mutateAsync: jest.fn(),
    isPending: false,
  })),
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

jest.mock('expo-symbols', () => ({
  SymbolView: 'SymbolView',
}))

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: jest.fn(() => ({ top: 0, bottom: 0, left: 0, right: 0 })),
}))

jest.mock('../../components/ui', () => {
  const { Text, View } = require('react-native')
  return {
    Button: ({ children, onPress }: { children: React.ReactNode; onPress?: () => void }) => (
      <Text onPress={onPress}>{children}</Text>
    ),
    Eyebrow: ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>,
    Hairline: () => <View />,
  }
})

jest.mock('../../components/DeleteAccountModal', () => {
  const { Text } = require('react-native')
  return {
    DeleteAccountModal: ({ visible }: { visible: boolean }) =>
      visible ? <Text>DeleteAccountModal</Text> : null,
  }
})

// ── imports after mocks ───────────────────────────────────────────────────────

import { useCurrentUser, useDeleteAccount, useLogout } from '../../lib/queries'
import { router } from 'expo-router'
import ProfileTab from './profile'

// ── typed mock helpers ────────────────────────────────────────────────────────

const mockUseCurrentUser = useCurrentUser as jest.MockedFunction<typeof useCurrentUser>
const mockUseLogout = useLogout as jest.MockedFunction<typeof useLogout>
const mockUseDeleteAccount = useDeleteAccount as jest.MockedFunction<typeof useDeleteAccount>
const mockRouter = router as jest.Mocked<typeof router>

function setupMocks(role: 'client' | 'super_admin_delivery' = 'client') {
  mockUseCurrentUser.mockReturnValue({
    data: {
      id: 'user-1',
      email: null,
      fullName: 'María García',
      phone: '+18091234567',
      role,
      addressDefault: null,
      referralCode: null,
      creditLocked: false,
    },
    isPending: false,
  } as unknown as ReturnType<typeof useCurrentUser>)

  mockUseLogout.mockReturnValue(jest.fn() as unknown as ReturnType<typeof useLogout>)

  mockUseDeleteAccount.mockReturnValue({
    mutateAsync: jest.fn().mockResolvedValue(undefined),
    isPending: false,
  } as unknown as ReturnType<typeof useDeleteAccount>)
}

afterEach(() => {
  jest.clearAllMocks()
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ProfileTab — Mis alquileres link', () => {
  it('shows "Mis alquileres" row for a client user', () => {
    setupMocks('client')
    const { getByText } = renderWithProviders(<ProfileTab />)
    expect(getByText('Mis alquileres')).toBeTruthy()
  })

  it('navigates to /rentals when "Mis alquileres" row is tapped', () => {
    setupMocks('client')
    const { getByText } = renderWithProviders(<ProfileTab />)
    fireEvent.press(getByText('Mis alquileres'))
    expect(mockRouter.navigate).toHaveBeenCalledWith('/rentals')
  })
})

// ── Account deletion (Apple Guideline 5.1.1(v)) ───────────────────────────────

describe('ProfileTab — Eliminar mi cuenta', () => {
  it('shows the "Eliminar mi cuenta" button for a client user', () => {
    setupMocks('client')
    const { getByTestId } = renderWithProviders(<ProfileTab />)
    expect(getByTestId('delete-account-button')).toBeTruthy()
  })

  it('opens the DeleteAccountModal when the button is pressed', () => {
    setupMocks('client')
    const { getByTestId, getByText, queryByText } = renderWithProviders(
      <ProfileTab />,
    )
    expect(queryByText('DeleteAccountModal')).toBeNull()
    fireEvent.press(getByTestId('delete-account-button'))
    expect(getByText('DeleteAccountModal')).toBeTruthy()
  })
})
