/**
 * Promoter layout — el promotor tampoco ve puntos (hoja "Más") y un asociado
 * que cae acá se manda al área de cliente, igual que un cliente.
 */
import React from 'react'
import { fireEvent } from '@testing-library/react-native'
import { renderWithProviders } from '../../test/test-utils'

jest.mock('../../lib/queries', () => ({
  useCurrentUser: jest.fn(),
}))

jest.mock('expo-router', () => {
  const React = require('react')
  const { Pressable } = require('react-native')
  const Screen = ({ name, listeners }: { name: string; listeners?: { tabPress?: (e: unknown) => void } }) =>
    listeners?.tabPress ? (
      <Pressable
        testID={`tab-${name}`}
        onPress={() => listeners.tabPress!({ preventDefault: jest.fn() })}
      />
    ) : null
  const Tabs = ({ children }: { children: React.ReactNode }) => <>{children}</>
  Tabs.Screen = Screen
  const router = { push: jest.fn(), replace: jest.fn(), navigate: jest.fn(), back: jest.fn() }
  return { Tabs, router, useRouter: () => router }
})

jest.mock('expo-symbols', () => ({ SymbolView: 'SymbolView' }))
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: jest.fn(() => ({ top: 0, bottom: 0, left: 0, right: 0 })),
}))

import { router } from 'expo-router'
import { useCurrentUser } from '../../lib/queries'
import PromoterLayout from './_layout'

const mockUseCurrentUser = useCurrentUser as jest.MockedFunction<typeof useCurrentUser>
const mockRouter = router as jest.Mocked<typeof router>

function asRole(role: string) {
  mockUseCurrentUser.mockReturnValue({
    data: { id: 'u-1', role },
    isPending: false,
  } as unknown as ReturnType<typeof useCurrentUser>)
}

afterEach(() => jest.clearAllMocks())

describe('(promoter)/_layout', () => {
  it('the "Más" sheet has no "Puntos" entry', () => {
    asRole('promoter')
    const { getByTestId, getByText, queryByText } = renderWithProviders(<PromoterLayout />)

    fireEvent.press(getByTestId('tab-more'))

    expect(getByText('Mi cuenta')).toBeTruthy()
    expect(queryByText(/puntos/i)).toBeNull()
  })

  it.each(['client', 'associate'])('redirects a %s out of the promoter area to the customer tabs', (role) => {
    asRole(role)
    renderWithProviders(<PromoterLayout />)

    expect(mockRouter.replace).toHaveBeenCalledWith('/(tabs)')
  })

  it('keeps a promoter in place', () => {
    asRole('promoter')
    renderWithProviders(<PromoterLayout />)

    expect(mockRouter.replace).not.toHaveBeenCalled()
  })
})
