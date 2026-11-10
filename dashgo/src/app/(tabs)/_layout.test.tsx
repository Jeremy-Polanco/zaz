/**
 * Tab layout — la hoja "Más" del cliente ya no trae "Puntos" (el cliente
 * dejó de ver puntos; solo el saldo de asociado vive en el checkout).
 */
import React from 'react'
import { fireEvent } from '@testing-library/react-native'
import { renderWithProviders } from '../../test/test-utils'

jest.mock('../../lib/queries', () => ({
  useCurrentUser: jest.fn(),
  useMyAssociateBalance: jest.fn(),
  useMySubscription: jest.fn(),
  useMyRentals: jest.fn(),
}))

// Tabs real needs a navigator; render each Screen's tabPress listener as a
// button so the real layout's "Más" wiring (and the real MoreSheet) run.
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

import {
  useCurrentUser,
  useMyAssociateBalance,
  useMyRentals,
  useMySubscription,
} from '../../lib/queries'
import { router } from 'expo-router'
import TabLayout from './_layout'

const mockUseCurrentUser = useCurrentUser as jest.MockedFunction<typeof useCurrentUser>
const mockUseBalance = useMyAssociateBalance as jest.MockedFunction<typeof useMyAssociateBalance>

const mockUseSubscription = useMySubscription as jest.MockedFunction<typeof useMySubscription>
const mockUseRentals = useMyRentals as jest.MockedFunction<typeof useMyRentals>

function openMore(
  role: string,
  balanceCents = 0,
  { subscription = null, rentals = [] }: { subscription?: object | null; rentals?: object[] } = {},
) {
  mockUseSubscription.mockReturnValue({
    data: subscription,
  } as unknown as ReturnType<typeof useMySubscription>)
  mockUseRentals.mockReturnValue({
    data: rentals,
  } as unknown as ReturnType<typeof useMyRentals>)
  mockUseCurrentUser.mockReturnValue({
    data: { id: 'u-1', role },
    isPending: false,
  } as unknown as ReturnType<typeof useCurrentUser>)
  mockUseBalance.mockReturnValue({
    data: { balanceCents, entries: [] },
    isPending: false,
  } as unknown as ReturnType<typeof useMyAssociateBalance>)
  const utils = renderWithProviders(<TabLayout />)
  fireEvent.press(utils.getByTestId('tab-more'))
  return utils
}

describe('(tabs)/_layout — hoja "Más"', () => {
  it('a client sees their account options but no "Puntos"', () => {
    const { getByText, queryByText } = openMore('client')

    expect(getByText('Mi cuenta')).toBeTruthy()
    expect(queryByText(/puntos/i)).toBeNull()
  })

  it('an associate gets the same customer sheet, with no "Puntos"', () => {
    const { getByText, queryByText } = openMore('associate')

    expect(getByText('Mi cuenta')).toBeTruthy()
    expect(queryByText(/puntos/i)).toBeNull()
  })

  it('an associate sees the pool entry and it routes to the pool screen', () => {
    const { getByText } = openMore('associate')

    fireEvent.press(getByText('Pool de asociados'))

    expect(router.navigate).toHaveBeenCalledWith('/(tabs)/pool')
  })

  it('a client without balance never sees the pool entry', () => {
    const { queryByText } = openMore('client', 0)

    expect(queryByText('Pool de asociados')).toBeNull()
  })

  it('an ex-associate (client with balance) still reaches the pool screen', () => {
    const { getByText } = openMore('client', 800)

    fireEvent.press(getByText('Pool de asociados'))

    expect(router.navigate).toHaveBeenCalledWith('/(tabs)/pool')
    expect(mockUseBalance).toHaveBeenCalledWith(true)
  })
})

describe('(tabs)/_layout — hoja "Más" del asociado sin ofertas de bebedero', () => {
  it('an associate without subscription or rentals does not see either entry', () => {
    const { getByText, queryByText } = openMore('associate')

    expect(getByText('Mi cuenta')).toBeTruthy()
    expect(queryByText('Suscripción')).toBeNull()
    expect(queryByText('Alquileres')).toBeNull()
  })

  it('an associate with a subscription keeps the subscription entry only', () => {
    const { getByText, queryByText } = openMore('associate', 0, {
      subscription: { id: 's-1', status: 'canceled' },
    })

    expect(getByText('Suscripción')).toBeTruthy()
    expect(queryByText('Alquileres')).toBeNull()
  })

  it('an associate with a rental keeps the rentals entry only', () => {
    const { getByText, queryByText } = openMore('associate', 0, { rentals: [{ id: 'r-1' }] })

    expect(getByText('Alquileres')).toBeTruthy()
    expect(queryByText('Suscripción')).toBeNull()
  })

  it('a client always sees both entries and does not fetch for the gate', () => {
    const { getByText } = openMore('client')

    expect(getByText('Suscripción')).toBeTruthy()
    expect(getByText('Alquileres')).toBeTruthy()
    expect(mockUseSubscription).toHaveBeenCalledWith(false)
    expect(mockUseRentals).toHaveBeenCalledWith(false)
  })
})
