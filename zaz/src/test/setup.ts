/**
 * Jest setup file — runs before each test file via setupFiles.
 * Registers all native and third-party module mocks.
 *
 * NOTE: setupFiles runs BEFORE the test framework (Jest / jasmine) is installed,
 * so jest.mock() is available but expect/describe/it are NOT.
 * Cleanup (afterEach) must be registered inline in each test file.
 */

// ---------------------------------------------------------------------------
// Environment variables needed by api.ts (throws at module-level otherwise)
// ---------------------------------------------------------------------------
process.env.EXPO_PUBLIC_API_URL = 'http://localhost:3000'

// ---------------------------------------------------------------------------
// expo-router
// ---------------------------------------------------------------------------
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
    useFocusEffect: jest.fn((cb: () => (() => void) | void) => {
      // Execute the callback immediately so tests can exercise the effect body
      cb()
    }),
    useLocalSearchParams: jest.fn(() => ({})),
    usePathname: jest.fn(() => '/'),
    useSegments: jest.fn(() => []),
    Link: 'Link',
    Redirect: 'Redirect',
    Stack: { Screen: 'Stack.Screen' },
    Tabs: { Screen: 'Tabs.Screen' },
  }
})

// ---------------------------------------------------------------------------
// expo-secure-store
// ---------------------------------------------------------------------------
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}))

// ---------------------------------------------------------------------------
// expo-web-browser
// ---------------------------------------------------------------------------
jest.mock('expo-web-browser', () => ({
  openBrowserAsync: jest.fn().mockResolvedValue({ type: 'dismiss' }),
  openAuthSessionAsync: jest.fn().mockResolvedValue({ type: 'dismiss' }),
  dismissBrowser: jest.fn(),
}))

// ---------------------------------------------------------------------------
// expo-constants
// ---------------------------------------------------------------------------
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: {
        apiUrl: 'http://localhost:3000',
        stripePublishableKey: 'pk_test_mock',
      },
      name: 'zaz',
      slug: 'zaz',
    },
    manifest: null,
  },
}))

// ---------------------------------------------------------------------------
// @react-native-async-storage/async-storage
// ---------------------------------------------------------------------------
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
    removeItem: jest.fn().mockResolvedValue(undefined),
    clear: jest.fn().mockResolvedValue(undefined),
    getAllKeys: jest.fn().mockResolvedValue([]),
    multiGet: jest.fn().mockResolvedValue([]),
    multiSet: jest.fn().mockResolvedValue(undefined),
    multiRemove: jest.fn().mockResolvedValue(undefined),
  },
}))

// ---------------------------------------------------------------------------
// axios — mock factory so api.ts does not throw when imported
// ---------------------------------------------------------------------------
jest.mock('axios', () => {
  const mockAxiosInstance = {
    get: jest.fn().mockResolvedValue({ data: null }),
    post: jest.fn().mockResolvedValue({ data: null }),
    put: jest.fn().mockResolvedValue({ data: null }),
    patch: jest.fn().mockResolvedValue({ data: null }),
    delete: jest.fn().mockResolvedValue({ data: null }),
    interceptors: {
      request: { use: jest.fn(), eject: jest.fn() },
      response: { use: jest.fn(), eject: jest.fn() },
    },
    defaults: { headers: { common: {} } },
  }
  const mockAxios = {
    create: jest.fn(() => mockAxiosInstance),
    get: jest.fn().mockResolvedValue({ data: null }),
    post: jest.fn().mockResolvedValue({ data: null }),
    put: jest.fn().mockResolvedValue({ data: null }),
    delete: jest.fn().mockResolvedValue({ data: null }),
    interceptors: {
      request: { use: jest.fn(), eject: jest.fn() },
      response: { use: jest.fn(), eject: jest.fn() },
    },
    defaults: { headers: { common: {} } },
    isAxiosError: jest.fn(() => false),
  }
  return { __esModule: true, default: mockAxios, ...mockAxios }
})

// ---------------------------------------------------------------------------
// react-native-safe-area-context — minimal mock
// ---------------------------------------------------------------------------
jest.mock('react-native-safe-area-context', () => {
  const RealModule = jest.requireActual('react-native-safe-area-context')
  const insets = { top: 0, right: 0, bottom: 0, left: 0 }
  return {
    ...RealModule,
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
    SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
    useSafeAreaInsets: () => insets,
  }
})

// ---------------------------------------------------------------------------
// expo-image — use React Native Image as fallback
// ---------------------------------------------------------------------------
jest.mock('expo-image', () => {
  const { Image } = jest.requireActual('react-native')
  return { Image }
})
