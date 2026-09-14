/**
 * T47 — Edit Address screen tests (RED → GREEN with T48 impl)
 *
 * Scenarios:
 *   1. Form is pre-populated with existing address values
 *   2. Submitting changed value calls useUpdateAddress.mutate with { id, ...changes }
 *   3. Delete button is visible
 *   4. Tapping delete shows confirmation (Alert) and calls useDeleteAddress.mutate
 *   5. Set as default button is visible
 *   6. Tapping set as default calls useSetDefaultAddress.mutate with id
 */
import React from 'react'
import { fireEvent, act, waitFor } from '@testing-library/react-native'
import { renderWithProviders } from '../../test/test-utils'

// ── module mocks ──────────────────────────────────────────────────────────────

const mockUpdateMutateAsync = jest.fn()
const mockDeleteMutate = jest.fn()
const mockSetDefaultMutate = jest.fn()

jest.mock('../../lib/queries', () => ({
  useMyAddresses: jest.fn(),
  useUpdateAddress: jest.fn(),
  useDeleteAddress: jest.fn(),
  useSetDefaultAddress: jest.fn(),
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
    useLocalSearchParams: jest.fn(() => ({ id: 'addr-1' })),
    Link: 'Link',
    Stack: { Screen: 'Stack.Screen' },
  }
})

jest.mock('../../lib/api', () => ({
  API_URL: 'http://localhost:3000',
  api: {
    patch: jest.fn(),
    delete: jest.fn(),
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
  },
}))

jest.mock('../../components/MapPicker', () => {
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

const mockReverseGeocode = jest.fn()
jest.mock('../../lib/geo', () => ({
  reverseGeocode: (...args: unknown[]) => mockReverseGeocode(...args),
}))

// Alert will be spied on after react-native is imported below

// ── imports after mocks ───────────────────────────────────────────────────────

import { Alert } from 'react-native'
import {
  useMyAddresses,
  useUpdateAddress,
  useDeleteAddress,
  useSetDefaultAddress,
} from '../../lib/queries'
import { router, useLocalSearchParams } from 'expo-router'
import EditAddress from './[id]'
import type { UserAddress } from '../../lib/types'

// ── typed mock helpers ────────────────────────────────────────────────────────

const mockUseMyAddresses = useMyAddresses as jest.MockedFunction<typeof useMyAddresses>
const mockUseUpdateAddress = useUpdateAddress as jest.MockedFunction<typeof useUpdateAddress>
const mockUseDeleteAddress = useDeleteAddress as jest.MockedFunction<typeof useDeleteAddress>
const mockUseSetDefaultAddress = useSetDefaultAddress as jest.MockedFunction<typeof useSetDefaultAddress>
const mockRouter = router as jest.Mocked<typeof router>
const mockUseLocalSearchParams = useLocalSearchParams as jest.MockedFunction<typeof useLocalSearchParams>

// Spy on Alert.alert after react-native is imported
let alertSpy: jest.SpyInstance

const testAddress: UserAddress = {
  id: 'addr-1',
  userId: 'user-1',
  label: 'Casa',
  line1: 'Av. 27 de Febrero 123',
  line2: null,
  building: null,
  lat: 18.47,
  lng: -69.9,
  instructions: 'Timbre 3',
  isDefault: true,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  postalCode: '10451',
}

beforeEach(() => {
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined)
  mockReverseGeocode.mockResolvedValue({ text: 'x', postalCode: null })
})

function setupMocks() {
  mockUseLocalSearchParams.mockReturnValue({ id: 'addr-1' } as ReturnType<typeof useLocalSearchParams>)

  mockUseMyAddresses.mockReturnValue({
    data: [testAddress],
    isPending: false,
  } as unknown as ReturnType<typeof useMyAddresses>)

  mockUpdateMutateAsync.mockResolvedValue({ ...testAddress, label: 'Casa 2' })
  mockUseUpdateAddress.mockReturnValue({
    mutateAsync: mockUpdateMutateAsync,
    isPending: false,
  } as unknown as ReturnType<typeof useUpdateAddress>)

  mockDeleteMutate.mockResolvedValue(undefined)
  mockUseDeleteAddress.mockReturnValue({
    mutateAsync: mockDeleteMutate,
    isPending: false,
  } as unknown as ReturnType<typeof useDeleteAddress>)

  mockSetDefaultMutate.mockResolvedValue(testAddress)
  mockUseSetDefaultAddress.mockReturnValue({
    mutateAsync: mockSetDefaultMutate,
    isPending: false,
  } as unknown as ReturnType<typeof useSetDefaultAddress>)
}

afterEach(() => {
  jest.clearAllMocks()
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('EditAddress — pre-population', () => {
  beforeEach(() => setupMocks())

  it('pre-populates the label field with existing value', () => {
    const { getByDisplayValue } = renderWithProviders(<EditAddress />)
    expect(getByDisplayValue('Casa')).toBeTruthy()
  })

  it('pre-populates the line1 field with existing value', () => {
    const { getByDisplayValue } = renderWithProviders(<EditAddress />)
    expect(getByDisplayValue('Av. 27 de Febrero 123')).toBeTruthy()
  })

  it('pre-populates the postal code field with the existing ZIP', () => {
    const { getByDisplayValue } = renderWithProviders(<EditAddress />)
    expect(getByDisplayValue('10451')).toBeTruthy()
  })
})

describe('EditAddress — update flow', () => {
  beforeEach(() => setupMocks())

  it('calls mutateAsync with id and updated label', async () => {
    const { getByDisplayValue, getByText } = renderWithProviders(<EditAddress />)
    const labelInput = getByDisplayValue('Casa')
    fireEvent.changeText(labelInput, 'Casa Nueva')
    await act(async () => {
      fireEvent.press(getByText(/Guardar/i))
    })
    await waitFor(() => {
      expect(mockUpdateMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'addr-1',
          label: 'Casa Nueva',
        }),
      )
    })
  })
})

describe('EditAddress — postal code (ZIP)', () => {
  beforeEach(() => setupMocks())

  it('calls mutateAsync with the updated ZIP', async () => {
    const { getByDisplayValue, getByText } = renderWithProviders(<EditAddress />)
    const zipInput = getByDisplayValue('10451')
    fireEvent.changeText(zipInput, '07201')
    await act(async () => {
      fireEvent.press(getByText(/Guardar/i))
    })
    await waitFor(() => {
      expect(mockUpdateMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'addr-1', postalCode: '07201' }),
      )
    })
  })

  it('shows a validation error when the ZIP is cleared', async () => {
    const { getByDisplayValue, getByText, queryByText } = renderWithProviders(
      <EditAddress />,
    )
    fireEvent.changeText(getByDisplayValue('10451'), '')
    await act(async () => {
      fireEvent.press(getByText(/Guardar/i))
    })
    await waitFor(() => {
      expect(queryByText(/Ingresá un ZIP de 5 dígitos/i)).toBeTruthy()
    })
  })

  it('prefills the ZIP from the geocoder only when the field is empty', async () => {
    mockReverseGeocode.mockResolvedValue({ text: 'x', postalCode: '99999' })
    const { getByTestId, getByDisplayValue } = renderWithProviders(<EditAddress />)

    // Already has a ZIP ('10451') — moving the pin must not overwrite it.
    await act(async () => {
      fireEvent.press(getByTestId('map-picker'))
    })

    await waitFor(() => {
      expect(getByDisplayValue('10451')).toBeTruthy()
    })
  })
})

describe('EditAddress — delete flow', () => {
  beforeEach(() => setupMocks())

  it('shows a delete button', () => {
    const { getByText } = renderWithProviders(<EditAddress />)
    expect(getByText(/Eliminar/i)).toBeTruthy()
  })

  it('calls Alert.alert when delete is tapped', async () => {
    const { getByText } = renderWithProviders(<EditAddress />)
    await act(async () => {
      fireEvent.press(getByText(/Eliminar/i))
    })
    expect(alertSpy).toHaveBeenCalled()
  })

  it('calls useDeleteAddress.mutateAsync after confirming delete', async () => {
    // Make Alert immediately call the confirm callback
    alertSpy.mockImplementation((_title, _msg, buttons: Array<{ text: string; onPress?: () => void }>) => {
      const confirmBtn = buttons?.find((b) => b.text === 'Eliminar')
      confirmBtn?.onPress?.()
    })
    const { getByText } = renderWithProviders(<EditAddress />)
    await act(async () => {
      fireEvent.press(getByText(/Eliminar/i))
    })
    await waitFor(() => {
      expect(mockDeleteMutate).toHaveBeenCalledWith('addr-1')
    })
  })
})

describe('EditAddress — set default', () => {
  beforeEach(() => setupMocks())

  it('shows a "Hacer principal" button when address is default (for changing)', () => {
    // The button should always be visible; for default address it may say something else
    const { getByText } = renderWithProviders(<EditAddress />)
    // Could be "Hacer principal" or "Es la principal"
    expect(
      getByText(/Hacer principal|Es la principal/i),
    ).toBeTruthy()
  })

  it('calls useSetDefaultAddress.mutateAsync with id when non-default tapped', async () => {
    // Override: make it a non-default address
    mockUseMyAddresses.mockReturnValue({
      data: [{ ...testAddress, isDefault: false }],
      isPending: false,
    } as unknown as ReturnType<typeof useMyAddresses>)

    const { getByText } = renderWithProviders(<EditAddress />)
    await act(async () => {
      fireEvent.press(getByText(/Hacer principal/i))
    })
    await waitFor(() => {
      expect(mockSetDefaultMutate).toHaveBeenCalledWith('addr-1')
    })
  })
})
