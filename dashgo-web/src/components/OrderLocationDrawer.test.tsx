import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../test/test-utils'
import type { Order } from '../lib/types'

// ── Module mocks ───────────────────────────────────────────────────────────────
// MapPicker (react-leaflet) doesn't render meaningfully in jsdom — stub it.
// SavedAddressesList has its own suite; stub it to a marker here.
vi.mock('./MapPicker', () => ({
  MapPicker: () => <div data-testid="map-picker" />,
}))
vi.mock('./SavedAddressesList', () => ({
  SavedAddressesList: () => <div data-testid="saved-addresses-list" />,
}))
vi.mock('../lib/geo', () => ({
  requestBrowserLocation: vi.fn(),
  reverseGeocode: vi.fn(),
}))
vi.mock('../lib/queries', () => ({
  useCreateAddressForUser: vi.fn(),
  useSetOrderDeliveryAddress: vi.fn(),
}))

import { requestBrowserLocation, reverseGeocode } from '../lib/geo'
import { useCreateAddressForUser, useSetOrderDeliveryAddress } from '../lib/queries'
import { OrderLocationDrawer } from './OrderLocationDrawer'

const mockRequestLocation = vi.mocked(requestBrowserLocation)
const mockReverseGeocode = vi.mocked(reverseGeocode)
const mockUseCreateAddressForUser = vi.mocked(useCreateAddressForUser)
const mockUseSetOrderDeliveryAddress = vi.mocked(useSetOrderDeliveryAddress)

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'order-001',
    customerId: 'cust-001',
    customer: { fullName: 'Ana Cliente' },
    deliveryAddress: null,
    ...overrides,
  } as Order
}

function mutationMock(mutateAsync = vi.fn().mockResolvedValue({})) {
  return {
    mutate: vi.fn(),
    mutateAsync,
    isPending: false,
    isError: false,
    isSuccess: false,
    error: null,
    reset: vi.fn(),
  }
}

describe('OrderLocationDrawer — ZIP', () => {
  let setLocationMutateAsync: ReturnType<typeof vi.fn>
  let createForUserMutateAsync: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    setLocationMutateAsync = vi.fn().mockResolvedValue({})
    createForUserMutateAsync = vi.fn().mockResolvedValue({})
    mockUseSetOrderDeliveryAddress.mockReturnValue(
      mutationMock(setLocationMutateAsync) as unknown as ReturnType<
        typeof useSetOrderDeliveryAddress
      >,
    )
    mockUseCreateAddressForUser.mockReturnValue(
      mutationMock(createForUserMutateAsync) as unknown as ReturnType<
        typeof useCreateAddressForUser
      >,
    )
  })

  it('renders a ZIP input with numeric mode and a 5-char limit', () => {
    renderWithProviders(
      <OrderLocationDrawer order={makeOrder()} onClose={vi.fn()} />,
    )

    const zipInput = screen.getByLabelText(/código postal|zip/i)
    expect(zipInput).toHaveAttribute('inputmode', 'numeric')
    expect(zipInput).toHaveAttribute('maxlength', '5')
  })

  it('prefills the ZIP from "Usar mi ubicación" when the field is empty', async () => {
    mockRequestLocation.mockResolvedValue({ lat: 18.47, lng: -69.9 })
    mockReverseGeocode.mockResolvedValue({
      text: 'Calle Duarte 100',
      lat: 18.47,
      lng: -69.9,
      postalCode: '10451',
    })

    renderWithProviders(
      <OrderLocationDrawer order={makeOrder()} onClose={vi.fn()} />,
    )

    await userEvent.click(
      screen.getByRole('button', { name: /usar mi ubicación/i }),
    )

    const zipInput = await screen.findByLabelText(/código postal|zip/i)
    expect(zipInput).toHaveValue('10451')
  })

  it('does not overwrite a ZIP the admin already typed', async () => {
    mockRequestLocation.mockResolvedValue({ lat: 18.47, lng: -69.9 })
    mockReverseGeocode.mockResolvedValue({
      text: 'Calle Duarte 100',
      lat: 18.47,
      lng: -69.9,
      postalCode: '10451',
    })

    renderWithProviders(
      <OrderLocationDrawer order={makeOrder()} onClose={vi.fn()} />,
    )

    const zipInput = screen.getByLabelText(/código postal|zip/i)
    await userEvent.type(zipInput, '99999')

    await userEvent.click(
      screen.getByRole('button', { name: /usar mi ubicación/i }),
    )
    await screen.findByText(/18\.47000/)

    expect(zipInput).toHaveValue('99999')
  })

  it('sends the typed ZIP in the delivery-address payload', async () => {
    renderWithProviders(
      <OrderLocationDrawer order={makeOrder()} onClose={vi.fn()} />,
    )

    await userEvent.type(
      screen.getByLabelText(/código postal|zip/i),
      '10451',
    )
    // Pin coords via "Usar mi ubicación" so the Guardar button is enabled.
    mockRequestLocation.mockResolvedValue({ lat: 18.47, lng: -69.9 })
    mockReverseGeocode.mockResolvedValue({
      text: '',
      lat: 18.47,
      lng: -69.9,
      postalCode: null,
    })
    await userEvent.click(
      screen.getByRole('button', { name: /usar mi ubicación/i }),
    )
    await screen.findByText(/18\.47000/)

    await userEvent.click(
      screen.getByRole('button', { name: /guardar ubicación/i }),
    )

    expect(setLocationMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ postalCode: '10451' }),
    )
  })

  it('includes the ZIP in the saved-address payload when saving to the customer', async () => {
    renderWithProviders(
      <OrderLocationDrawer order={makeOrder()} onClose={vi.fn()} />,
    )

    await userEvent.type(
      screen.getByLabelText(/código postal|zip/i),
      '10451',
    )
    mockRequestLocation.mockResolvedValue({ lat: 18.47, lng: -69.9 })
    mockReverseGeocode.mockResolvedValue({
      text: '',
      lat: 18.47,
      lng: -69.9,
      postalCode: null,
    })
    await userEvent.click(
      screen.getByRole('button', { name: /usar mi ubicación/i }),
    )
    await screen.findByText(/18\.47000/)

    await userEvent.click(
      screen.getByLabelText(/guardar esta dirección al cliente/i),
    )
    await userEvent.type(
      screen.getByLabelText(/nombre de la dirección/i),
      'Casa',
    )
    await userEvent.click(
      screen.getByRole('button', { name: /guardar ubicación/i }),
    )

    expect(createForUserMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ postalCode: '10451' }),
    )
  })
})
