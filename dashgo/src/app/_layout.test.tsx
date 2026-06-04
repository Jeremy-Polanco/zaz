/**
 * Tests for the root layout's ErrorBoundary — verifies that any render-time
 * error that bubbles up to Expo Router's boundary is forwarded to Sentry
 * before the fallback UI renders.
 *
 * The actual Sentry SDK is mocked at the module boundary. We're testing the
 * WIRING (boundary → captureException), not Sentry itself.
 *
 * Why the heavy mock surface:
 *   `_layout.tsx` is the app's root and pulls in fonts, Stripe, React Query,
 *   Sentry, expo-router, etc. To isolate the ErrorBoundary we mock every
 *   heavy import at the module level so the test file boots in milliseconds.
 */
import React from 'react'
import { render } from '@testing-library/react-native'

// ---------------------------------------------------------------------------
// Mock @sentry/react-native BEFORE the import-under-test. Capture the
// captureException calls so we can assert the boundary forwarded the error.
// ---------------------------------------------------------------------------
jest.mock('@sentry/react-native', () => ({
  init: jest.fn(),
  captureException: jest.fn(),
  wrap: (Component: unknown) => Component,
  reactNavigationIntegration: jest.fn(() => ({ name: 'ReactNavigation' })),
}))

// ---------------------------------------------------------------------------
// Mock the canonical sentry module. `_layout.tsx` now imports `Sentry` from
// `../lib/sentry` (which calls `Sentry.init` at module load). Route the
// re-export back to the same `@sentry/react-native` mock so existing
// assertions on `Sentry.captureException` keep working.
// ---------------------------------------------------------------------------
jest.mock('../lib/sentry', () => {
  const Sentry = jest.requireMock('@sentry/react-native') as Record<string, unknown>
  return { Sentry }
})

// ---------------------------------------------------------------------------
// expo-router — the _layout file imports Stack/router/usePathname. We don't
// render any of them in this test (we only test the ErrorBoundary export),
// but the module-level import side-effects need to resolve cleanly.
// ---------------------------------------------------------------------------
jest.mock('expo-router', () => ({
  Stack: Object.assign(({ children }: { children?: React.ReactNode }) => children, {
    Screen: () => null,
  }),
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  usePathname: () => '/',
}))

// ---------------------------------------------------------------------------
// expo-splash-screen has side-effect calls (preventAutoHideAsync) at module
// scope inside _layout. Provide no-op shims.
// ---------------------------------------------------------------------------
jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn().mockResolvedValue(undefined),
  hideAsync: jest.fn().mockResolvedValue(undefined),
}))

// ---------------------------------------------------------------------------
// expo-constants — Stripe key resolver reads from this, AND the Sentry init
// at module scope reads `name`, `version`, `ios.buildNumber`, and
// `android.versionCode` to build the release/dist tags. Provide a realistic
// shape so the Sentry.init assertion below sees the expected values.
// ---------------------------------------------------------------------------
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      name: 'dashgo',
      version: '1.0.0',
      ios: { buildNumber: '42' },
      android: { versionCode: 42 },
      extra: { stripePublishableKey: 'pk_test_x' },
    },
  },
}))

// ---------------------------------------------------------------------------
// @stripe/stripe-react-native — provider is irrelevant for ErrorBoundary test.
// ---------------------------------------------------------------------------
jest.mock('@stripe/stripe-react-native', () => ({
  StripeProvider: ({ children }: { children?: React.ReactNode }) => children,
}))

// ---------------------------------------------------------------------------
// @react-native-async-storage/async-storage
// ---------------------------------------------------------------------------
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
  },
}))

// ---------------------------------------------------------------------------
// react-native-gesture-handler / safe-area-context / react-query / fonts
// ---------------------------------------------------------------------------
jest.mock('react-native-gesture-handler', () => ({
  GestureHandlerRootView: ({ children }: { children?: React.ReactNode }) => children,
}))
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children?: React.ReactNode }) => children,
  SafeAreaView: ({ children }: { children?: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}))
jest.mock('@tanstack/react-query', () => ({
  QueryClient: jest.fn().mockImplementation(() => ({})),
  QueryClientProvider: ({ children }: { children?: React.ReactNode }) => children,
  QueryCache: jest.fn().mockImplementation(() => ({})),
  MutationCache: jest.fn().mockImplementation(() => ({})),
}))
jest.mock('axios', () => ({
  __esModule: true,
  default: { isAxiosError: () => false, create: () => ({}) },
  isAxiosError: () => false,
}))
jest.mock('expo-status-bar', () => ({ StatusBar: () => null }))
jest.mock('expo-font', () => ({ useFonts: () => [true] }))
jest.mock('@expo-google-fonts/inter-tight', () => ({
  InterTight_400Regular: 'r',
  InterTight_500Medium: 'm',
  InterTight_600SemiBold: 's',
  InterTight_700Bold: 'b',
  InterTight_500Medium_Italic: 'i',
}))
jest.mock('../lib/queries', () => ({
  useCurrentUser: () => ({ data: null }),
  useUpdateMe: () => ({ mutate: jest.fn() }),
}))
jest.mock('../lib/geo', () => ({
  requestDeviceLocation: jest.fn(),
  reverseGeocode: jest.fn(),
}))
jest.mock('../components/NetworkBanner', () => ({
  NetworkBanner: () => null,
  notifyNetworkError: jest.fn(),
}))

// global.css side-effect import
jest.mock('../global.css', () => ({}), { virtual: true })

// ---------------------------------------------------------------------------
// Now load the module-under-test. The Sentry mock must be in place first
// so the side-effect call to Sentry.init at module scope is observable.
// ---------------------------------------------------------------------------
import * as Sentry from '@sentry/react-native'
import { ErrorBoundary } from './_layout'

const sentryMock = Sentry as unknown as {
  init: jest.Mock
  captureException: jest.Mock
}

describe('root ErrorBoundary', () => {
  beforeEach(() => {
    sentryMock.captureException.mockClear()
  })

  it('forwards the error to Sentry.captureException on mount', () => {
    const err = new Error('render boom')
    render(<ErrorBoundary error={err} retry={() => {}} />)
    expect(sentryMock.captureException).toHaveBeenCalledTimes(1)
    expect(sentryMock.captureException).toHaveBeenCalledWith(err)
  })

  it('still renders the fallback UI even when Sentry forwarding happens', () => {
    const err = new Error('shown to user')
    const { getByText } = render(
      <ErrorBoundary error={err} retry={() => {}} />,
    )
    expect(getByText('Something went wrong')).toBeTruthy()
    expect(getByText('shown to user')).toBeTruthy()
    expect(getByText('Try again')).toBeTruthy()
  })
})

// Sentry init wiring (release + dist tagging) is covered in
// `src/lib/sentry.test.ts`. We keep that test out of this file because
// `_layout.test.tsx` mocks `../lib/sentry` to keep the ErrorBoundary
// assertion isolated — that mock would also short-circuit any Sentry.init
// observation we tried to do here.
