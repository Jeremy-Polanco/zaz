/**
 * Tests for the canonical `lib/sentry` module and its ordering invariants.
 *
 * Two surfaces are covered:
 *
 *   1. `scrubObject` — pure function, deterministic PII redaction. Verified
 *      across primitives, nested structures, arrays, and circular refs.
 *
 *   2. Module ordering — the contract is that `Sentry.init` MUST be invoked
 *      at module LOAD TIME (top-level side effect), NOT inside any function
 *      called from `_layout.tsx`'s component body. We verify this by
 *      importing `lib/sentry` in isolation and asserting `init` was already
 *      called before any other module had a chance to run.
 *
 *   3. `Sentry.wrap` — `_layout.tsx`'s default export must be the wrapped
 *      root component, not the raw function.
 *
 * The Sentry SDK is mocked at the module boundary so we can observe the
 * `init` / `wrap` calls without booting the real native bridge.
 */

// ---------------------------------------------------------------------------
// IMPORTANT: jest.mock calls are hoisted ABOVE imports — we use that hoisting
// to intercept @sentry/react-native and expo-constants before `lib/sentry`
// (the module under test) evaluates its top-level Sentry.init call.
// ---------------------------------------------------------------------------
jest.mock('@sentry/react-native', () => ({
  init: jest.fn(),
  captureException: jest.fn(),
  // Tag the returned value so we can distinguish "wrap was applied" from
  // "wrap returned the original component". The real Sentry.wrap also
  // returns a new component, never the input by reference.
  wrap: jest.fn((Component) => {
    const Wrapped = function SentryWrapped() {
      return null
    }
    Wrapped.__sentryWrapped = true
    Wrapped.__inner = Component
    return Wrapped
  }),
  reactNavigationIntegration: jest.fn(() => ({ name: 'ReactNavigation' })),
}))

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      name: 'dashgo',
      version: '1.0.0',
      ios: { buildNumber: '42' },
      extra: {},
    },
  },
}))

// ---------------------------------------------------------------------------
// scrubObject unit tests — these don't depend on init having run, so they
// can live in the same describe-tree as the ordering test.
// ---------------------------------------------------------------------------
describe('scrubObject', () => {
  // Re-import inside the describe block to keep the import after the mocks
  // are registered. Use a fresh module instance so DSN-dependent setup
  // doesn't pollute the assertions below.
  let scrubObject: <T>(input: T) => T

  beforeAll(() => {
    // The DSN-gated init runs only when EXPO_PUBLIC_SENTRY_DSN is set. We
    // leave it unset here so the module loads cleanly without calling init.
    delete process.env.EXPO_PUBLIC_SENTRY_DSN
    jest.isolateModules(() => {
      scrubObject = require('./sentry').scrubObject
    })
  })

  it('passes primitives through unchanged', () => {
    expect(scrubObject(null)).toBeNull()
    expect(scrubObject(undefined)).toBeUndefined()
    expect(scrubObject(42 as unknown as object)).toBe(42)
    expect(scrubObject('plain' as unknown as object)).toBe('plain')
    expect(scrubObject(true as unknown as object)).toBe(true)
  })

  it('redacts well-known PII keys at the top level', () => {
    const input = {
      name: 'Jeremy',
      phone: '+541112345678',
      email: 'a@b.com',
      password: 'hunter2',
      token: 'jwt.xxx',
      safe: 'keep-me',
    }
    const out = scrubObject(input)
    expect(out.name).toBe('Jeremy')
    expect(out.safe).toBe('keep-me')
    expect(out.phone).toBe('[REDACTED]')
    expect(out.email).toBe('[REDACTED]')
    expect(out.password).toBe('[REDACTED]')
    expect(out.token).toBe('[REDACTED]')
  })

  it('matches PII keys case-insensitively and as substrings', () => {
    const out = scrubObject({
      Authorization: 'Bearer abc',
      Cookie: 'session=xyz',
      whatsappNumber: '+54',
      otp_code: '123456',
    })
    expect(out.Authorization).toBe('[REDACTED]')
    expect(out.Cookie).toBe('[REDACTED]')
    expect(out.whatsappNumber).toBe('[REDACTED]')
    expect(out.otp_code).toBe('[REDACTED]')
  })

  it('recurses into nested objects and arrays', () => {
    const input = {
      user: {
        profile: {
          email: 'nested@x.com',
          name: 'OK',
        },
      },
      events: [
        { phone: '+54', kind: 'login' },
        { phone: '+55', kind: 'logout' },
      ],
    }
    const out = scrubObject(input) as typeof input
    expect(out.user.profile.email).toBe('[REDACTED]')
    expect(out.user.profile.name).toBe('OK')
    expect(out.events[0].phone).toBe('[REDACTED]')
    expect(out.events[0].kind).toBe('login')
    expect(out.events[1].phone).toBe('[REDACTED]')
  })

  it('does not mutate the input object', () => {
    const input = { email: 'leak@x.com', name: 'Stay' }
    const snapshot = JSON.stringify(input)
    scrubObject(input)
    expect(JSON.stringify(input)).toBe(snapshot)
  })

  it('handles circular references without infinite recursion', () => {
    type Node = { name: string; self?: Node; token?: string }
    const a: Node = { name: 'A', token: 'secret' }
    a.self = a
    expect(() => scrubObject(a)).not.toThrow()
    const out = scrubObject(a)
    expect(out.name).toBe('A')
    expect(out.token).toBe('[REDACTED]')
    // The self-reference is replaced with the redaction placeholder rather
    // than copied — this prevents the unscrubbed sub-tree from leaking.
    expect(out.self).toBe('[REDACTED]')
  })
})

// ---------------------------------------------------------------------------
// Module-ordering invariant. This is the load-bearing assertion: when
// `lib/sentry` is imported, `Sentry.init` has ALREADY been called by the
// time the import statement returns. If a future refactor moves init into a
// function or a useEffect, this test fails loud.
// ---------------------------------------------------------------------------
describe('Sentry init ordering', () => {
  beforeEach(() => {
    jest.resetModules()
    const sentryMock = require('@sentry/react-native')
    ;(sentryMock.init as jest.Mock).mockClear()
    ;(sentryMock.wrap as jest.Mock).mockClear()
    ;(sentryMock.reactNavigationIntegration as jest.Mock).mockClear()
  })

  it('calls Sentry.init at module load time when DSN is set', () => {
    process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://example@sentry.io/1'
    const sentryMock = require('@sentry/react-native')

    // BEFORE requiring lib/sentry — init must not have been called yet.
    expect(sentryMock.init).not.toHaveBeenCalled()

    // The require() itself must trigger init synchronously.
    jest.isolateModules(() => {
      require('./sentry')
    })

    expect(sentryMock.init).toHaveBeenCalledTimes(1)
    const args = (sentryMock.init as jest.Mock).mock.calls[0][0]
    expect(args.dsn).toBe('https://example@sentry.io/1')
    expect(args.sendDefaultPii).toBe(false)
    expect(typeof args.beforeSend).toBe('function')
    expect(typeof args.beforeBreadcrumb).toBe('function')
    // The reactNavigationIntegration is in the integrations array.
    expect(Array.isArray(args.integrations)).toBe(true)
    expect(sentryMock.reactNavigationIntegration).toHaveBeenCalled()
  })

  it('skips Sentry.init silently when DSN is unset', () => {
    delete process.env.EXPO_PUBLIC_SENTRY_DSN
    const sentryMock = require('@sentry/react-native')

    jest.isolateModules(() => {
      require('./sentry')
    })

    expect(sentryMock.init).not.toHaveBeenCalled()
  })

  it('tags the event with release + dist from expo-constants', () => {
    process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://example@sentry.io/1'
    const sentryMock = require('@sentry/react-native')

    jest.isolateModules(() => {
      require('./sentry')
    })

    const args = (sentryMock.init as jest.Mock).mock.calls[0][0]
    expect(args.release).toBe('dashgo@1.0.0+42')
    expect(args.dist).toBe('42')
  })

  it('beforeSend scrubs PII from outgoing events', () => {
    process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://example@sentry.io/1'
    const sentryMock = require('@sentry/react-native')

    jest.isolateModules(() => {
      require('./sentry')
    })

    const { beforeSend } = (sentryMock.init as jest.Mock).mock.calls[0][0] as {
      beforeSend: (event: unknown) => unknown
    }
    const scrubbed = beforeSend({
      message: 'boom',
      extra: { email: 'leak@x.com', userId: 'keep' },
    }) as { extra: { email: string; userId: string } }
    expect(scrubbed.extra.email).toBe('[REDACTED]')
    expect(scrubbed.extra.userId).toBe('keep')
  })

  it('beforeSend strips query strings from event.request.url (NC1 fix)', () => {
    // The OTP verify endpoint is the canonical leak path:
    //   /api/auth/verify-otp?phone=%2B...&code=123456
    // sendDefaultPii:false doesn't help here — the URL is in a VALUE, not a
    // sensitive KEY. The hook strips everything after the first `?`.
    process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://example@sentry.io/1'
    const sentryMock = require('@sentry/react-native')

    jest.isolateModules(() => {
      require('./sentry')
    })

    const { beforeSend } = (sentryMock.init as jest.Mock).mock.calls[0][0] as {
      beforeSend: (event: unknown) => unknown
    }
    const scrubbed = beforeSend({
      request: { url: '/api/auth/verify-otp?phone=%2B&code=123456' },
    }) as { request: { url: string } }
    expect(scrubbed.request.url).toBe('/api/auth/verify-otp')
    // Defensive: no fragment of the query slips through anywhere.
    expect(JSON.stringify(scrubbed)).not.toContain('code=123456')
    expect(JSON.stringify(scrubbed)).not.toContain('phone=')
  })

  it('beforeBreadcrumb strips query strings from data.url (NC1 fix)', () => {
    // Breadcrumbs auto-recorded by the http integration capture full URLs
    // verbatim — including the OTP query string. This pins the path-only
    // behavior.
    process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://example@sentry.io/1'
    const sentryMock = require('@sentry/react-native')

    jest.isolateModules(() => {
      require('./sentry')
    })

    const { beforeBreadcrumb } = (sentryMock.init as jest.Mock).mock
      .calls[0][0] as {
      beforeBreadcrumb: (b: unknown) => unknown
    }
    const out = beforeBreadcrumb({
      category: 'http',
      data: { url: '/api/auth/verify-otp?phone=%2B&code=123456', method: 'POST' },
    }) as { data: { url: string; method: string } }
    expect(out.data.url).toBe('/api/auth/verify-otp')
    expect(out.data.method).toBe('POST')
  })

  it('stripQueryString helper handles malformed input without throwing', () => {
    // The helper runs inside Sentry hooks — a throw would lose the event.
    let stripQueryString: (s: string) => string = (s) => s
    jest.isolateModules(() => {
      stripQueryString = require('./sentry').stripQueryString
    })
    expect(stripQueryString('not-a-url')).toBe('not-a-url')
    expect(stripQueryString('')).toBe('')
    expect(stripQueryString('/x?y=1')).toBe('/x')
    expect(stripQueryString('/x')).toBe('/x')
  })
})

// ---------------------------------------------------------------------------
// _layout.tsx ordering + Sentry.wrap. Importing _layout.tsx in isolation
// triggers the side-effect import of `lib/sentry`, which MUST call init
// BEFORE _layout's component code (including RootLayout body, queryClient
// construction, or any other module-level evaluation) executes.
// ---------------------------------------------------------------------------
describe('_layout module-load ordering', () => {
  beforeEach(() => {
    jest.resetModules()
  })

  it('Sentry.init has been called by the time _layout.tsx finishes loading', () => {
    process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://example@sentry.io/1'

    // We re-register the heavy mocks inside this isolated module scope.
    jest.isolateModules(() => {
      jest.doMock('expo-router', () => ({
        Stack: Object.assign(({ children }: { children?: unknown }) => children, {
          Screen: () => null,
        }),
        router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
        usePathname: () => '/',
      }))
      jest.doMock('expo-splash-screen', () => ({
        preventAutoHideAsync: jest.fn().mockResolvedValue(undefined),
        hideAsync: jest.fn().mockResolvedValue(undefined),
      }))
      jest.doMock('@stripe/stripe-react-native', () => ({
        StripeProvider: ({ children }: { children?: unknown }) => children,
      }))
      jest.doMock('@react-native-async-storage/async-storage', () => ({
        __esModule: true,
        default: { getItem: jest.fn(), setItem: jest.fn() },
      }))
      jest.doMock('react-native-gesture-handler', () => ({
        GestureHandlerRootView: ({ children }: { children?: unknown }) => children,
      }))
      jest.doMock('react-native-safe-area-context', () => ({
        SafeAreaProvider: ({ children }: { children?: unknown }) => children,
        SafeAreaView: ({ children }: { children?: unknown }) => children,
        useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
      }))
      jest.doMock('@tanstack/react-query', () => ({
        QueryClient: jest.fn().mockImplementation(() => ({})),
        QueryClientProvider: ({ children }: { children?: unknown }) => children,
        QueryCache: jest.fn().mockImplementation(() => ({})),
        MutationCache: jest.fn().mockImplementation(() => ({})),
      }))
      jest.doMock('axios', () => ({
        __esModule: true,
        default: { isAxiosError: () => false, create: () => ({}) },
        isAxiosError: () => false,
      }))
      jest.doMock('expo-status-bar', () => ({ StatusBar: () => null }))
      jest.doMock('expo-font', () => ({ useFonts: () => [true] }))
      jest.doMock('@expo-google-fonts/inter-tight', () => ({
        InterTight_400Regular: 'r',
        InterTight_500Medium: 'm',
        InterTight_600SemiBold: 's',
        InterTight_700Bold: 'b',
        InterTight_500Medium_Italic: 'i',
      }))
      jest.doMock('../lib/queries', () => ({
        useCurrentUser: () => ({ data: null }),
        useUpdateMe: () => ({ mutate: jest.fn() }),
      }))
      jest.doMock('../lib/geo', () => ({
        requestDeviceLocation: jest.fn(),
        reverseGeocode: jest.fn(),
      }))
      jest.doMock('../lib/push', () => ({
        usePushNotifications: jest.fn(),
        registerForPushNotifications: jest.fn(),
        unregisterPushToken: jest.fn(),
      }))
      jest.doMock('../components/NetworkBanner', () => ({
        NetworkBanner: () => null,
        notifyNetworkError: jest.fn(),
      }))
      jest.doMock('../global.css', () => ({}), { virtual: true })

      const sentryMock = require('@sentry/react-native')
      // Sanity: nothing has triggered init yet.
      expect(sentryMock.init).not.toHaveBeenCalled()

      // Load the layout module — this should trigger init via the
      // side-effect import of ../lib/sentry, BEFORE evaluating any of the
      // other heavy imports.
      const layoutModule = require('../app/_layout')

      // The init call must have happened during module load.
      expect(sentryMock.init).toHaveBeenCalled()
      // The default export must be the Sentry.wrap-wrapped version.
      expect(sentryMock.wrap).toHaveBeenCalledTimes(1)
      const wrapped = layoutModule.default as { __sentryWrapped?: boolean }
      expect(wrapped.__sentryWrapped).toBe(true)
    })
  })
})
