/**
 * LocationBottomSheet — super-admin sheet to pin an order's delivery
 * location. New in this change: an optional ZIP input, prefilled from the
 * geocoder (like the free-text address) when "Usar mi ubicación" resolves
 * one, and sent both in the order's delivery-address PATCH and in any
 * saved-address created for the customer.
 */
import React from 'react'
import { fireEvent, render, waitFor, act } from '@testing-library/react-native'
import type { Order } from '../lib/types'

jest.mock('../lib/queries', () => ({
  useCreateAddressForUser: jest.fn(),
  useSetOrderDeliveryAddress: jest.fn(),
}))

const mockRequestDeviceLocation = jest.fn()
const mockReverseGeocode = jest.fn()
jest.mock('../lib/geo', () => ({
  requestDeviceLocation: (...args: unknown[]) => mockRequestDeviceLocation(...args),
  reverseGeocode: (...args: unknown[]) => mockReverseGeocode(...args),
}))

// MapPicker uses react-native-maps which can't render in jest-expo — stub it
// with a pressable that fires onChange with a fixed coordinate.
jest.mock('./MapPicker', () => {
  const RN = require('react-native')
  return {
    MapPicker: ({
      onChange,
    }: {
      onChange: (coords: { lat: number; lng: number }) => void
    }) =>
      require('react').createElement(RN.Pressable, {
        testID: 'map-picker',
        onPress: () => onChange({ lat: 40.85, lng: -73.93 }),
      }),
  }
})

import { useCreateAddressForUser, useSetOrderDeliveryAddress } from '../lib/queries'
import { LocationBottomSheet } from './LocationBottomSheet'

const mockUseCreateAddressForUser = useCreateAddressForUser as jest.MockedFunction<
  typeof useCreateAddressForUser
>
const mockUseSetOrderDeliveryAddress = useSetOrderDeliveryAddress as jest.MockedFunction<
  typeof useSetOrderDeliveryAddress
>

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'order-1',
    customerId: 'user-1',
    customer: { id: 'user-1', fullName: 'Ana Cliente' } as Order['customer'],
    status: 'pending_quote',
    deliveryAddress: null,
    subtotal: '45.00',
    pointsRedeemed: '0',
    shipping: '5.00',
    tax: '0',
    taxRate: '0.08887',
    totalAmount: '50.00',
    paymentMethod: 'cash',
    stripePaymentIntentId: null,
    paidAt: null,
    items: [],
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  } as Order
}

const mockSetOrderLocationMutateAsync = jest.fn()
const mockCreateForUserMutateAsync = jest.fn()

function setupMocks() {
  mockSetOrderLocationMutateAsync.mockResolvedValue({})
  mockUseSetOrderDeliveryAddress.mockReturnValue({
    mutateAsync: mockSetOrderLocationMutateAsync,
    isPending: false,
  } as unknown as ReturnType<typeof useSetOrderDeliveryAddress>)

  mockCreateForUserMutateAsync.mockResolvedValue({})
  mockUseCreateAddressForUser.mockReturnValue({
    mutateAsync: mockCreateForUserMutateAsync,
    isPending: false,
  } as unknown as ReturnType<typeof useCreateAddressForUser>)

  mockReverseGeocode.mockResolvedValue({ text: 'x', postalCode: null })
  mockRequestDeviceLocation.mockResolvedValue({ lat: 40.85, lng: -73.93 })
}

afterEach(() => {
  jest.clearAllMocks()
})

describe('LocationBottomSheet — postal code (ZIP)', () => {
  beforeEach(() => setupMocks())

  it('renders the ZIP input', () => {
    const { getByPlaceholderText } = render(
      <LocationBottomSheet order={makeOrder()} onClose={jest.fn()} />,
    )
    expect(getByPlaceholderText('07201')).toBeTruthy()
  })

  it('sends the typed ZIP in the delivery-address payload', async () => {
    const { getByPlaceholderText, getByTestId, getByText } = render(
      <LocationBottomSheet order={makeOrder()} onClose={jest.fn()} />,
    )

    fireEvent.changeText(getByPlaceholderText('07201'), '10451')
    await act(async () => {
      fireEvent.press(getByTestId('map-picker'))
    })
    await act(async () => {
      fireEvent.press(getByText('Guardar →'))
    })

    await waitFor(() => {
      expect(mockSetOrderLocationMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ postalCode: '10451' }),
      )
    })
  })

  it('omits postalCode from the payload when left blank', async () => {
    const { getByTestId, getByText } = render(
      <LocationBottomSheet order={makeOrder()} onClose={jest.fn()} />,
    )

    await act(async () => {
      fireEvent.press(getByTestId('map-picker'))
    })
    await act(async () => {
      fireEvent.press(getByText('Guardar →'))
    })

    await waitFor(() => {
      expect(mockSetOrderLocationMutateAsync).toHaveBeenCalled()
    })
    const payload = mockSetOrderLocationMutateAsync.mock.calls[0][0]
    expect(payload.postalCode).toBeUndefined()
  })

  it('includes the ZIP when saving the location to the customer address book', async () => {
    const { getByPlaceholderText, getByTestId, getByText } = render(
      <LocationBottomSheet order={makeOrder()} onClose={jest.fn()} />,
    )

    fireEvent.changeText(getByPlaceholderText('07201'), '10451')
    await act(async () => {
      fireEvent.press(getByTestId('map-picker'))
    })
    fireEvent.press(getByText('Guardar esta dirección al cliente'))
    fireEvent.changeText(getByPlaceholderText('Ej. Casa, Trabajo'), 'Casa')
    await act(async () => {
      fireEvent.press(getByText('Guardar →'))
    })

    await waitFor(() => {
      expect(mockCreateForUserMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ postalCode: '10451' }),
      )
    })
  })

  it('prefills the ZIP from the geocoder when "Usar mi ubicación" resolves one', async () => {
    mockReverseGeocode.mockResolvedValue({ text: 'Calle X', postalCode: '10451' })

    const { getByText, getByPlaceholderText } = render(
      <LocationBottomSheet order={makeOrder()} onClose={jest.fn()} />,
    )

    await act(async () => {
      fireEvent.press(getByText('📍 Usar mi ubicación'))
    })

    await waitFor(() => {
      expect(getByPlaceholderText('07201').props.value).toBe('10451')
    })
  })

  it('pre-populates the ZIP field from the order\'s existing delivery address', () => {
    const { getByDisplayValue } = render(
      <LocationBottomSheet
        order={makeOrder({
          deliveryAddress: { text: 'Calle Duarte 100', postalCode: '10451' },
        })}
        onClose={jest.fn()}
      />,
    )
    expect(getByDisplayValue('10451')).toBeTruthy()
  })
})
