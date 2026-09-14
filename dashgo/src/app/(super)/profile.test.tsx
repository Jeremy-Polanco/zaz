/**
 * SuperProfileScreen — Tarifa de envío (general delivery rate editor).
 *
 * The super admin can now change the flat shipping rate the API charges on
 * every order from this screen. GET /shipping/rate feeds the current value;
 * PUT /shipping/rate (useUpdateShippingRate) saves the admin's edit in cents.
 */
import React from 'react'
import { fireEvent, waitFor } from '@testing-library/react-native'
import { renderWithProviders } from '../../test/test-utils'

jest.mock('../../lib/queries', () => ({
  useCurrentUser: jest.fn(),
  useLogout: jest.fn(() => jest.fn()),
  useShippingRate: jest.fn(),
  useUpdateShippingRate: jest.fn(),
}))

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn(), back: jest.fn() },
}))

import {
  useCurrentUser,
  useShippingRate,
  useUpdateShippingRate,
} from '../../lib/queries'
import SuperProfileScreen from './profile'

const mockUseCurrentUser = useCurrentUser as jest.MockedFunction<typeof useCurrentUser>
const mockUseShippingRate = useShippingRate as jest.MockedFunction<typeof useShippingRate>
const mockUseUpdateShippingRate = useUpdateShippingRate as jest.MockedFunction<
  typeof useUpdateShippingRate
>

function setup(shippingCents = 500) {
  mockUseCurrentUser.mockReturnValue({
    data: {
      id: 'admin-1',
      fullName: 'Ana Admin',
      phone: '+18095551234',
      addressDefault: { text: 'Calle Falsa 123' },
    },
    isPending: false,
  } as unknown as ReturnType<typeof useCurrentUser>)

  mockUseShippingRate.mockReturnValue({
    data: { shippingCents },
  } as unknown as ReturnType<typeof useShippingRate>)
}

const mockMutateAsync = jest.fn()

beforeEach(() => {
  mockMutateAsync.mockResolvedValue({ shippingCents: 650 })
  mockUseUpdateShippingRate.mockReturnValue({
    mutateAsync: mockMutateAsync,
    isPending: false,
  } as unknown as ReturnType<typeof useUpdateShippingRate>)
})

afterEach(() => {
  jest.clearAllMocks()
})

describe('SuperProfileScreen — Tarifa de envío', () => {
  it('renders the current rate ("$5.00 por pedido")', async () => {
    setup(500)

    const { getByText } = renderWithProviders(<SuperProfileScreen />)

    await waitFor(() => {
      expect(getByText(/\$5\.00 por pedido/)).toBeTruthy()
    })
  })

  it('submits the typed dollar amount as cents ("6.50" → 650) and shows the transient confirmation', async () => {
    setup(500)

    const { getByText, getByPlaceholderText } = renderWithProviders(
      <SuperProfileScreen />,
    )

    await waitFor(() => {
      expect(getByText(/\$5\.00 por pedido/)).toBeTruthy()
    })

    fireEvent.changeText(getByPlaceholderText('5.00'), '6.50')
    fireEvent.press(getByText('Guardar tarifa'))

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith({ shippingCents: 650 })
    })
    expect(await findConfirmation(getByText)).toBeTruthy()
  })

  it('shows the inline validation error for a value outside $0-$100', async () => {
    setup(500)

    const { getByText, getByPlaceholderText } = renderWithProviders(
      <SuperProfileScreen />,
    )

    await waitFor(() => {
      expect(getByText(/\$5\.00 por pedido/)).toBeTruthy()
    })

    fireEvent.changeText(getByPlaceholderText('5.00'), '150')

    expect(getByText('Ingresá un monto entre $0 y $100.')).toBeTruthy()

    fireEvent.press(getByText('Guardar tarifa'))
    expect(mockMutateAsync).not.toHaveBeenCalled()
  })
})

// Small helper so the "wait, then assert" shape stays readable above.
function findConfirmation(getByText: (text: string) => unknown) {
  return waitFor(() => getByText('Tarifa actualizada'))
}
