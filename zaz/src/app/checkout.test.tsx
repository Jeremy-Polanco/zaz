/**
 * Phase 7 — Checkout refactor tests (T50–T64)
 *
 * TDD Pairs G–T:
 *   G/H  — Smart-default within 200m pre-selects nearest address
 *   I/J  — Smart-default outside 200m falls back to is_default
 *   K/L  — Smart-default GPS denied → falls back to default, no re-prompt
 *   M/N  — Zero saved addresses → ad-hoc mode, no picker
 *   O/P  — User taps "Usar una dirección diferente" → ad-hoc form visible
 *   Q/R  — Save-this-address: checked + label → createAddress called on order success
 *   S/T  — Save fails after order success → toast shown, navigation proceeds
 */
import React from 'react'
import { fireEvent, act, waitFor } from '@testing-library/react-native'
import { Alert } from 'react-native'
import { renderWithProviders } from '../test/test-utils'

// ── module mocks ──────────────────────────────────────────────────────────────

// Mock expo-location — the module we're testing against
const mockGetForegroundPermissions = jest.fn()
const mockGetCurrentPosition = jest.fn()

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(),
  getForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  Accuracy: { Balanced: 3 },
}))

jest.mock('../lib/queries', () => ({
  useMyAddresses: jest.fn(),
  useCreateAddress: jest.fn(),
  useCreateOrder: jest.fn(),
  useCurrentUser: jest.fn(),
  useMyCredit: jest.fn(),
  useMySubscription: jest.fn(),
  usePointsBalance: jest.fn(),
  useProducts: jest.fn(),
  useUpdateMe: jest.fn(),
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

jest.mock('../lib/api', () => ({
  API_URL: 'http://localhost:3000',
  api: {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
  },
}))

// MapPicker can't render in jest-expo
jest.mock('../components/MapPicker', () => ({
  MapPicker: () => null,
}))

// Cart
jest.mock('../lib/cart', () => ({
  useCart: jest.fn(() => ({ items: { 'product-1': 2 } })),
  cart: { clear: jest.fn() },
}))

// ── imports after mocks ───────────────────────────────────────────────────────

import * as Location from 'expo-location'
import {
  useMyAddresses,
  useCreateAddress,
  useCreateOrder,
  useCurrentUser,
  useMyCredit,
  useMySubscription,
  usePointsBalance,
  useProducts,
  useUpdateMe,
} from '../lib/queries'
import { router } from 'expo-router'
import CheckoutScreen from './checkout'
import type { UserAddress } from '../lib/types'

// ── typed mock helpers ────────────────────────────────────────────────────────

const mockUseMyAddresses = useMyAddresses as jest.MockedFunction<typeof useMyAddresses>
const mockUseCreateAddress = useCreateAddress as jest.MockedFunction<typeof useCreateAddress>
const mockUseCreateOrder = useCreateOrder as jest.MockedFunction<typeof useCreateOrder>
const mockUseCurrentUser = useCurrentUser as jest.MockedFunction<typeof useCurrentUser>
const mockUseMyCredit = useMyCredit as jest.MockedFunction<typeof useMyCredit>
const mockUseMySubscription = useMySubscription as jest.MockedFunction<typeof useMySubscription>
const mockUsePointsBalance = usePointsBalance as jest.MockedFunction<typeof usePointsBalance>
const mockUseProducts = useProducts as jest.MockedFunction<typeof useProducts>
const mockUseUpdateMe = useUpdateMe as jest.MockedFunction<typeof useUpdateMe>

const mockLocation = Location as jest.Mocked<typeof Location>
const mockRouter = router as jest.Mocked<typeof router>

// ── fixtures ──────────────────────────────────────────────────────────────────

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

// Madrid-area addresses for haversine tests
const MADRID_ADDR = makeAddress({
  id: 'addr-madrid',
  label: 'Madrid',
  lat: 40.416775,
  lng: -3.70379,
  isDefault: true,
})

const NYC_ADDR = makeAddress({
  id: 'addr-nyc',
  label: 'Nueva York',
  lat: 40.712776,
  lng: -74.005974,
  isDefault: false,
})

// A product so the checkout screen doesn't render the empty-cart state
const MOCK_PRODUCT = {
  id: 'product-1',
  name: 'Producto Test',
  effectivePriceCents: 1000,
  basePriceCents: 1000,
  offerActive: false,
  offerLabel: null,
  stock: 10,
  categoryId: 'cat-1',
  description: null,
  imageUrl: null,
  active: true,
}

const mockCreateOrderMutateAsync = jest.fn()
const mockCreateAddressMutate = jest.fn()
const mockCreateAddressMutateAsync = jest.fn()

function setupBaseQueryMocks(addresses: UserAddress[]) {
  mockUseMyAddresses.mockReturnValue({
    data: addresses,
    isPending: false,
    isLoading: false,
  } as unknown as ReturnType<typeof useMyAddresses>)

  mockUseCreateOrder.mockReturnValue({
    mutateAsync: mockCreateOrderMutateAsync,
    isPending: false,
  } as unknown as ReturnType<typeof useCreateOrder>)

  mockUseCreateAddress.mockReturnValue({
    mutate: mockCreateAddressMutate,
    mutateAsync: mockCreateAddressMutateAsync,
    isPending: false,
  } as unknown as ReturnType<typeof useCreateAddress>)

  mockUseCurrentUser.mockReturnValue({
    data: { id: 'user-1', role: 'client', addressDefault: null },
  } as unknown as ReturnType<typeof useCurrentUser>)

  mockUseMyCredit.mockReturnValue({
    data: null,
  } as unknown as ReturnType<typeof useMyCredit>)

  mockUseMySubscription.mockReturnValue({
    data: null,
  } as unknown as ReturnType<typeof useMySubscription>)

  mockUsePointsBalance.mockReturnValue({
    data: null,
  } as unknown as ReturnType<typeof usePointsBalance>)

  mockUseProducts.mockReturnValue({
    data: [MOCK_PRODUCT],
  } as unknown as ReturnType<typeof useProducts>)

  mockUseUpdateMe.mockReturnValue({
    mutate: jest.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof useUpdateMe>)
}

let alertSpy: jest.SpyInstance

beforeEach(() => {
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined)
  mockCreateOrderMutateAsync.mockResolvedValue({ id: 'order-1' })
  mockCreateAddressMutateAsync.mockResolvedValue({ id: 'addr-new' })
  mockCreateAddressMutate.mockImplementation(() => undefined)
})

afterEach(() => {
  jest.clearAllMocks()
})

// ── T65 — Phase 11: checkout shipping copy cleanup ────────────────────────────

describe('T65 — checkout shipping label copy cleanup', () => {
  /**
   * "Gratis con tu suscripción" must NOT appear regardless of subscription status.
   * "A cotizar" must always appear in the shipping row.
   */
  it('does NOT show "Gratis con tu suscripción" when user has an active subscription', async () => {
    setupBaseQueryMocks([])

    // Give the user an active subscription
    mockUseMySubscription.mockReturnValue({
      data: { id: 'sub-1', status: 'active', cancelAtPeriodEnd: false,
              currentPeriodStart: '2026-01-01T00:00:00Z', currentPeriodEnd: '2026-02-01T00:00:00Z',
              canceledAt: null },
    } as unknown as ReturnType<typeof useMySubscription>)

    mockLocation.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' } as never)
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' } as never)

    const { queryByText } = renderWithProviders(<CheckoutScreen />)

    await waitFor(() => {
      expect(queryByText(/gratis con tu suscripción/i)).toBeNull()
    })
  })

  it('always shows "A cotizar" in the shipping row regardless of subscription status', async () => {
    setupBaseQueryMocks([])

    // Give the user an active subscription
    mockUseMySubscription.mockReturnValue({
      data: { id: 'sub-1', status: 'active', cancelAtPeriodEnd: false,
              currentPeriodStart: '2026-01-01T00:00:00Z', currentPeriodEnd: '2026-02-01T00:00:00Z',
              canceledAt: null },
    } as unknown as ReturnType<typeof useMySubscription>)

    mockLocation.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' } as never)
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' } as never)

    const { queryByText } = renderWithProviders(<CheckoutScreen />)

    await waitFor(() => {
      expect(queryByText(/A cotizar/i)).toBeTruthy()
    })
  })

  it('shows "A cotizar" for users without a subscription too', async () => {
    setupBaseQueryMocks([])

    // No subscription (default mock already has null)
    mockLocation.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' } as never)
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' } as never)

    const { queryByText } = renderWithProviders(<CheckoutScreen />)

    await waitFor(() => {
      expect(queryByText(/A cotizar/i)).toBeTruthy()
    })
  })
})

// ── Pair G/H — Smart-default within 200m pre-selects nearest ──────────────────

describe('Pair G/H — Smart-default selects address within 200m of GPS', () => {
  /**
   * Setup: 2 saved addresses (Madrid default, NYC non-default).
   * GPS returns coords ~100m from the Madrid address.
   * Expected: Madrid address is pre-selected (visible in picker as selected).
   */
  it('pre-selects the address closest to GPS when within 200m', async () => {
    // Madrid coords with a tiny offset (~100m away)
    const nearMadridLat = 40.416775 + 0.0005 // ~55m north
    const nearMadridLng = -3.70379

    setupBaseQueryMocks([MADRID_ADDR, NYC_ADDR])

    mockLocation.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' } as never)
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' } as never)
    mockLocation.getCurrentPositionAsync.mockResolvedValue({
      coords: { latitude: nearMadridLat, longitude: nearMadridLng },
    } as never)

    const { getByTestId } = renderWithProviders(<CheckoutScreen />)

    await waitFor(() => {
      // The Madrid address should be shown as selected
      expect(getByTestId('selected-address-label')).toBeTruthy()
    })

    const selectedLabel = getByTestId('selected-address-label')
    expect(selectedLabel.props.children).toBe('Madrid')
  })

  it('does not pre-select NYC when GPS is near Madrid', async () => {
    const nearMadridLat = 40.416775
    const nearMadridLng = -3.70379

    setupBaseQueryMocks([MADRID_ADDR, NYC_ADDR])

    mockLocation.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' } as never)
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' } as never)
    mockLocation.getCurrentPositionAsync.mockResolvedValue({
      coords: { latitude: nearMadridLat, longitude: nearMadridLng },
    } as never)

    const { getByTestId } = renderWithProviders(<CheckoutScreen />)

    await waitFor(() => {
      expect(getByTestId('selected-address-label')).toBeTruthy()
    })

    const selectedLabel = getByTestId('selected-address-label')
    expect(selectedLabel.props.children).not.toBe('Nueva York')
  })
})

// ── Pair I/J — Smart-default outside 200m falls back to default ───────────────

describe('Pair I/J — Smart-default falls back to is_default when GPS is far', () => {
  /**
   * Both addresses are far from Buenos Aires GPS position.
   * Expected: Madrid (isDefault=true) is pre-selected.
   */
  it('pre-selects the is_default address when no address is within 200m', async () => {
    setupBaseQueryMocks([MADRID_ADDR, NYC_ADDR])

    // Buenos Aires — far from both Madrid and NYC
    mockLocation.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' } as never)
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' } as never)
    mockLocation.getCurrentPositionAsync.mockResolvedValue({
      coords: { latitude: -34.6037, longitude: -58.3816 }, // Buenos Aires
    } as never)

    const { getByTestId } = renderWithProviders(<CheckoutScreen />)

    await waitFor(() => {
      expect(getByTestId('selected-address-label')).toBeTruthy()
    })

    expect(getByTestId('selected-address-label').props.children).toBe('Madrid')
  })

  it('falls back to first address when no address has isDefault and GPS is far', async () => {
    const addrA = makeAddress({ id: 'addr-a', label: 'A', isDefault: false })
    const addrB = makeAddress({ id: 'addr-b', label: 'B', isDefault: false })

    setupBaseQueryMocks([addrA, addrB])

    mockLocation.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' } as never)
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' } as never)
    mockLocation.getCurrentPositionAsync.mockResolvedValue({
      coords: { latitude: 0, longitude: 0 }, // equator — far from both
    } as never)

    const { getByTestId } = renderWithProviders(<CheckoutScreen />)

    await waitFor(() => {
      expect(getByTestId('selected-address-label')).toBeTruthy()
    })

    // First address should be selected (fallback when no isDefault)
    expect(getByTestId('selected-address-label').props.children).toBe('A')
  })
})

// ── Pair K/L — Smart-default GPS denied ───────────────────────────────────────

describe('Pair K/L — Smart-default falls back silently when GPS denied', () => {
  /**
   * Location.getForegroundPermissionsAsync returns denied.
   * Expected: default address pre-selected; no re-prompt.
   */
  it('pre-selects the default address when permission is denied', async () => {
    setupBaseQueryMocks([MADRID_ADDR, NYC_ADDR])

    mockLocation.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' } as never)
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' } as never)
    // getCurrentPositionAsync should NOT be called when permission denied
    mockLocation.getCurrentPositionAsync.mockRejectedValue(new Error('Permission denied'))

    const { getByTestId } = renderWithProviders(<CheckoutScreen />)

    await waitFor(() => {
      expect(getByTestId('selected-address-label')).toBeTruthy()
    })

    expect(getByTestId('selected-address-label').props.children).toBe('Madrid')
  })

  it('does not call getCurrentPositionAsync when permission denied', async () => {
    setupBaseQueryMocks([MADRID_ADDR, NYC_ADDR])

    mockLocation.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' } as never)
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' } as never)

    renderWithProviders(<CheckoutScreen />)

    // Wait for the effect to run
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })

    expect(mockLocation.getCurrentPositionAsync).not.toHaveBeenCalled()
  })
})

// ── Pair M/N — Zero saved addresses → ad-hoc mode ────────────────────────────

describe('Pair M/N — Zero saved addresses → ad-hoc mode immediately', () => {
  /**
   * useMyAddresses returns empty array.
   * Expected: ad-hoc form is visible, picker (address list) is NOT shown.
   */
  it('shows the ad-hoc address form when user has no saved addresses', async () => {
    setupBaseQueryMocks([])

    mockLocation.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' } as never)
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' } as never)

    const { getByTestId } = renderWithProviders(<CheckoutScreen />)

    await waitFor(() => {
      expect(getByTestId('adhoc-address-form')).toBeTruthy()
    })
  })

  it('does NOT show the saved-address picker when user has no saved addresses', async () => {
    setupBaseQueryMocks([])

    mockLocation.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' } as never)
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' } as never)

    const { queryByTestId } = renderWithProviders(<CheckoutScreen />)

    await waitFor(async () => {
      expect(queryByTestId('saved-address-picker')).toBeNull()
    })
  })
})

// ── Pair O/P — User manually picks ad-hoc ────────────────────────────────────

describe('Pair O/P — User manually switches to ad-hoc mode', () => {
  /**
   * With saved addresses, user taps "Usar una dirección diferente".
   * Expected: ad-hoc form becomes visible; save-checkbox is shown.
   */
  it('shows ad-hoc form when user taps "Usar una dirección diferente"', async () => {
    setupBaseQueryMocks([MADRID_ADDR])

    mockLocation.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' } as never)
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' } as never)

    const { getByText, getByTestId } = renderWithProviders(<CheckoutScreen />)

    // First wait for the picker to appear
    await waitFor(() => {
      expect(getByTestId('saved-address-picker')).toBeTruthy()
    })

    // Tap the "Usar una dirección diferente" button
    await act(async () => {
      fireEvent.press(getByText(/Usar una dirección diferente/i))
    })

    await waitFor(() => {
      expect(getByTestId('adhoc-address-form')).toBeTruthy()
    })
  })

  it('shows the save-this-address checkbox in ad-hoc mode', async () => {
    setupBaseQueryMocks([MADRID_ADDR])

    mockLocation.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' } as never)
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' } as never)

    const { getByText, getByTestId } = renderWithProviders(<CheckoutScreen />)

    await waitFor(() => {
      expect(getByTestId('saved-address-picker')).toBeTruthy()
    })

    await act(async () => {
      fireEvent.press(getByText(/Usar una dirección diferente/i))
    })

    await waitFor(() => {
      expect(getByTestId('save-address-checkbox')).toBeTruthy()
    })
  })
})

// ── Pair Q/R — Save-this-address with label calls createAddress ───────────────

describe('Pair Q/R — Save-this-address: checked + label → createAddress called', () => {
  /**
   * In ad-hoc mode (no saved addresses), user:
   * 1. Enters address text + sets pin via mock
   * 2. Checks "Guardar esta dirección"
   * 3. Types label "Casa"
   * 4. Submits order
   * Expected: after order success, useCreateAddress.mutateAsync called with label/line1.
   */
  it('calls createAddress.mutateAsync with label and address on order success', async () => {
    setupBaseQueryMocks([])

    mockLocation.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' } as never)
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' } as never)

    mockCreateOrderMutateAsync.mockResolvedValue({ id: 'order-1' })
    mockCreateAddressMutateAsync.mockResolvedValue({ id: 'addr-saved' })

    const { getByTestId, getByText } = renderWithProviders(<CheckoutScreen />)

    // Wait for ad-hoc form
    await waitFor(() => {
      expect(getByTestId('adhoc-address-form')).toBeTruthy()
    })

    // Enter address
    await act(async () => {
      fireEvent.changeText(getByTestId('adhoc-address-input'), 'Calle 5 #123')
    })

    // Set coordinates via testID on the "set pin" helper
    await act(async () => {
      fireEvent.press(getByTestId('set-test-pin'))
    })

    // Check "Guardar esta dirección"
    await act(async () => {
      fireEvent.press(getByTestId('save-address-checkbox'))
    })

    // Type the label
    await act(async () => {
      fireEvent.changeText(getByTestId('save-address-label-input'), 'Casa')
    })

    // Confirm order via Alert mock (dismiss the Alert modal)
    alertSpy.mockImplementation((_title, _msg, buttons: Array<{ text: string; onPress?: () => void }>) => {
      const confirmBtn = buttons?.find((b) => b.text === 'Sí, confirmar')
      confirmBtn?.onPress?.()
    })

    await act(async () => {
      fireEvent.press(getByText(/Confirmar pedido/i))
    })

    await waitFor(() => {
      expect(mockCreateOrderMutateAsync).toHaveBeenCalled()
    })

    await waitFor(() => {
      expect(mockCreateAddressMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          label: 'Casa',
          line1: 'Calle 5 #123',
        }),
      )
    })
  })

  it('does NOT call createAddress when checkbox is unchecked', async () => {
    setupBaseQueryMocks([])

    mockLocation.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' } as never)
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' } as never)

    mockCreateOrderMutateAsync.mockResolvedValue({ id: 'order-1' })

    const { getByTestId, getByText } = renderWithProviders(<CheckoutScreen />)

    await waitFor(() => {
      expect(getByTestId('adhoc-address-form')).toBeTruthy()
    })

    // Enter address
    await act(async () => {
      fireEvent.changeText(getByTestId('adhoc-address-input'), 'Calle 5 #123')
    })

    await act(async () => {
      fireEvent.press(getByTestId('set-test-pin'))
    })

    // Do NOT check the save checkbox

    alertSpy.mockImplementation((_title, _msg, buttons: Array<{ text: string; onPress?: () => void }>) => {
      const confirmBtn = buttons?.find((b) => b.text === 'Sí, confirmar')
      confirmBtn?.onPress?.()
    })

    await act(async () => {
      fireEvent.press(getByText(/Confirmar pedido/i))
    })

    await waitFor(() => {
      expect(mockCreateOrderMutateAsync).toHaveBeenCalled()
    })

    expect(mockCreateAddressMutateAsync).not.toHaveBeenCalled()
  })
})

// ── Pair S/T — Save fails after order success → toast, navigation proceeds ────

describe('Pair S/T — Save-address failure after order success is non-blocking', () => {
  /**
   * Order succeeds. createAddress.mutateAsync rejects.
   * Expected: Alert.alert shown with aviso message; router.replace called (navigation succeeds).
   */
  it('shows Alert.alert when save-address fails after order success', async () => {
    setupBaseQueryMocks([])

    mockLocation.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' } as never)
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' } as never)

    mockCreateOrderMutateAsync.mockResolvedValue({ id: 'order-1' })
    mockCreateAddressMutateAsync.mockRejectedValue(new Error('Network error'))

    const { getByTestId, getByText } = renderWithProviders(<CheckoutScreen />)

    await waitFor(() => {
      expect(getByTestId('adhoc-address-form')).toBeTruthy()
    })

    await act(async () => {
      fireEvent.changeText(getByTestId('adhoc-address-input'), 'Calle Test #1')
    })

    await act(async () => {
      fireEvent.press(getByTestId('set-test-pin'))
    })

    // Check save checkbox
    await act(async () => {
      fireEvent.press(getByTestId('save-address-checkbox'))
    })

    await act(async () => {
      fireEvent.changeText(getByTestId('save-address-label-input'), 'Trabajo')
    })

    // The first Alert.alert call will be the "¿Confirmas el pedido?" modal
    // We need to allow that one then capture the error Alert
    let confirmCalled = false
    alertSpy.mockImplementation((_title, _msg, buttons: Array<{ text: string; onPress?: () => void }>) => {
      if (!confirmCalled) {
        confirmCalled = true
        const confirmBtn = buttons?.find((b) => b.text === 'Sí, confirmar')
        confirmBtn?.onPress?.()
      }
      // Second call: the save failure alert — just let it be recorded
    })

    await act(async () => {
      fireEvent.press(getByText(/Confirmar pedido/i))
    })

    await waitFor(() => {
      expect(mockCreateOrderMutateAsync).toHaveBeenCalled()
    })

    // Wait for the save attempt + failure
    await waitFor(() => {
      expect(mockCreateAddressMutateAsync).toHaveBeenCalled()
    })

    // Alert should have been called (at least twice: confirm + error)
    await waitFor(() => {
      expect(alertSpy.mock.calls.length).toBeGreaterThanOrEqual(2)
    })
  })

  it('navigates to order screen even when save-address fails', async () => {
    setupBaseQueryMocks([])

    mockLocation.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' } as never)
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' } as never)

    mockCreateOrderMutateAsync.mockResolvedValue({ id: 'order-2' })
    mockCreateAddressMutateAsync.mockRejectedValue(new Error('Save failed'))

    const { getByTestId, getByText } = renderWithProviders(<CheckoutScreen />)

    await waitFor(() => {
      expect(getByTestId('adhoc-address-form')).toBeTruthy()
    })

    await act(async () => {
      fireEvent.changeText(getByTestId('adhoc-address-input'), 'Calle Test #2')
    })

    await act(async () => {
      fireEvent.press(getByTestId('set-test-pin'))
    })

    await act(async () => {
      fireEvent.press(getByTestId('save-address-checkbox'))
    })

    await act(async () => {
      fireEvent.changeText(getByTestId('save-address-label-input'), 'Casa')
    })

    let confirmCalled = false
    alertSpy.mockImplementation((_title, _msg, buttons: Array<{ text: string; onPress?: () => void }>) => {
      if (!confirmCalled) {
        confirmCalled = true
        const confirmBtn = buttons?.find((b) => b.text === 'Sí, confirmar')
        confirmBtn?.onPress?.()
      }
    })

    await act(async () => {
      fireEvent.press(getByText(/Confirmar pedido/i))
    })

    await waitFor(() => {
      expect(mockRouter.replace).toHaveBeenCalledWith(
        expect.objectContaining({
          pathname: '/orders/[orderId]',
          params: { orderId: 'order-2' },
        }),
      )
    })
  })
})
