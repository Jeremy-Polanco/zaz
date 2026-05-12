/**
 * T45 — New Address screen tests (RED → GREEN with T46 impl)
 *
 * Scenarios:
 *   1. Form fields are visible (label, line1)
 *   2. Submitting empty label shows validation error
 *   3. Submitting empty line1 shows validation error
 *   4. Submitting valid form calls useCreateAddress.mutate with correct payload
 *   5. On submit success, navigates back to /addresses
 */
import React from 'react'
import { fireEvent, act, waitFor } from '@testing-library/react-native'
import { renderWithProviders } from '../../test/test-utils'

// ── module mocks ──────────────────────────────────────────────────────────────

const mockMutateAsync = jest.fn()
const mockMutate = jest.fn()

jest.mock('../../lib/queries', () => ({
  useCreateAddress: jest.fn(),
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
    post: jest.fn(),
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
  },
}))

// MapPicker uses react-native-maps which can't render in jest-expo
jest.mock('../../components/MapPicker', () => ({
  MapPicker: () => null,
}))

// ── imports after mocks ───────────────────────────────────────────────────────

import { useCreateAddress } from '../../lib/queries'
import { router } from 'expo-router'
import NewAddress from './new'

// ── typed mock helpers ────────────────────────────────────────────────────────

const mockUseCreateAddress = useCreateAddress as jest.MockedFunction<typeof useCreateAddress>
const mockRouter = router as jest.Mocked<typeof router>

function setupMocks(opts: { onSuccess?: () => void } = {}) {
  mockMutateAsync.mockImplementation(async () => {
    opts.onSuccess?.()
    return { id: 'addr-new' }
  })
  mockUseCreateAddress.mockReturnValue({
    mutate: mockMutate,
    mutateAsync: mockMutateAsync,
    isPending: false,
    isLoading: false,
  } as unknown as ReturnType<typeof useCreateAddress>)
}

afterEach(() => {
  jest.clearAllMocks()
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('NewAddress — form fields', () => {
  beforeEach(() => setupMocks())

  it('renders the label field', () => {
    const { getByPlaceholderText } = renderWithProviders(<NewAddress />)
    expect(getByPlaceholderText(/Ej: Casa, Oficina/i)).toBeTruthy()
  })

  it('renders the line1 field', () => {
    const { getByPlaceholderText } = renderWithProviders(<NewAddress />)
    expect(getByPlaceholderText(/Av. 27 de Febrero/i)).toBeTruthy()
  })

  it('renders the save button', () => {
    const { getByText } = renderWithProviders(<NewAddress />)
    expect(getByText(/Guardar/i)).toBeTruthy()
  })
})

describe('NewAddress — validation', () => {
  beforeEach(() => setupMocks())

  it('shows validation error for empty label on submit', async () => {
    const { getByText, queryByText } = renderWithProviders(<NewAddress />)
    // Don't fill label, press submit
    await act(async () => {
      fireEvent.press(getByText(/Guardar/i))
    })
    await waitFor(() => {
      expect(queryByText(/Nombre requerido/i)).toBeTruthy()
    })
  })

  it('shows validation error for empty line1 on submit', async () => {
    const { getByText, getByPlaceholderText, queryByText } = renderWithProviders(
      <NewAddress />,
    )
    // Fill label but not line1
    fireEvent.changeText(getByPlaceholderText(/Ej: Casa, Oficina/i), 'Casa')
    await act(async () => {
      fireEvent.press(getByText(/Guardar/i))
    })
    await waitFor(() => {
      expect(queryByText(/Dirección requerida/i)).toBeTruthy()
    })
  })

  it('does not call mutate when form is invalid', async () => {
    const { getByText } = renderWithProviders(<NewAddress />)
    await act(async () => {
      fireEvent.press(getByText(/Guardar/i))
    })
    expect(mockMutate).not.toHaveBeenCalled()
    expect(mockMutateAsync).not.toHaveBeenCalled()
  })
})

describe('NewAddress — submission', () => {
  it('calls mutateAsync with the form values on valid submit', async () => {
    setupMocks()
    const { getByText, getByPlaceholderText } = renderWithProviders(<NewAddress />)
    fireEvent.changeText(getByPlaceholderText(/Ej: Casa, Oficina/i), 'Trabajo')
    fireEvent.changeText(getByPlaceholderText(/Av. 27 de Febrero/i), 'Calle 5 #123')
    await act(async () => {
      fireEvent.press(getByText(/Guardar/i))
    })
    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          label: 'Trabajo',
          line1: 'Calle 5 #123',
        }),
      )
    })
  })

  it('navigates back to /addresses on successful submit', async () => {
    setupMocks()
    const { getByText, getByPlaceholderText } = renderWithProviders(<NewAddress />)
    fireEvent.changeText(getByPlaceholderText(/Ej: Casa, Oficina/i), 'Trabajo')
    fireEvent.changeText(getByPlaceholderText(/Av. 27 de Febrero/i), 'Calle 5 #123')
    await act(async () => {
      fireEvent.press(getByText(/Guardar/i))
    })
    await waitFor(() => {
      expect(mockRouter.replace).toHaveBeenCalledWith('/addresses' as never)
    })
  })
})
