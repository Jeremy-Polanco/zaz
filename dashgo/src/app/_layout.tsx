// =============================================================================
// MODULE ORDERING — DO NOT REORDER THESE IMPORTS
// =============================================================================
// The VERY FIRST line of this file MUST be the side-effect import of
// `../lib/sentry`. That module calls `Sentry.init()` at top-level so the SDK
// is armed BEFORE any other import evaluates — including `global.css`, axios,
// expo-router, Stripe, AsyncStorage, fonts, queries, geo, and NetworkBanner.
//
// Why this matters:
//   ES module imports are evaluated in source order. Anything imported above
//   `../lib/sentry` would run with Sentry uninitialized, so a boot-time crash
//   in axios/Stripe/expo-router would never be reported. Keep the sentry
//   import at the very top, and add new imports BELOW it, never above.
//
// `../lib/sentry` also re-exports `Sentry`, so this single import handles
// both the side-effect init and the named binding used by ErrorBoundary +
// `Sentry.wrap(RootLayout)` at the bottom of this file.
// =============================================================================
import { Sentry } from '../lib/sentry'

import '../global.css'
import { useEffect, useRef } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { Stack, router, usePathname } from 'expo-router'
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query'
import axios from 'axios'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import * as SplashScreen from 'expo-splash-screen'
import Constants from 'expo-constants'
import { StripeProvider } from '@stripe/stripe-react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  InterTight_400Regular,
  InterTight_500Medium,
  InterTight_600SemiBold,
  InterTight_700Bold,
  InterTight_500Medium_Italic,
} from '@expo-google-fonts/inter-tight'
import { useFonts } from 'expo-font'
import { useCurrentUser, useUpdateMe } from '../lib/queries'
import { requestDeviceLocation, reverseGeocode } from '../lib/geo'
import { NetworkBanner, notifyNetworkError } from '../components/NetworkBanner'

export function ErrorBoundary({ error, retry }: { error: Error; retry: () => void }) {
  // Forward the error to Sentry before rendering the fallback. Expo Router's
  // ErrorBoundary catches render-time errors that escape useEffect / event
  // handlers — exactly the surface that would otherwise crash the app with
  // no breadcrumb. When Sentry isn't initialized (no DSN), captureException
  // is a no-op, so this is safe to call unconditionally.
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <View style={styles.errorContainer}>
      <Text style={styles.errorTitle}>Something went wrong</Text>
      <Text style={styles.errorMessage}>{error.message}</Text>
      <TouchableOpacity style={styles.retryButton} onPress={retry}>
        <Text style={styles.retryText}>Try again</Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  errorContainer: {
    flex: 1,
    backgroundColor: '#FAFAFC',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1A1530',
    marginBottom: 8,
  },
  errorMessage: {
    fontSize: 14,
    color: '#6B6488',
    textAlign: 'center',
    marginBottom: 32,
  },
  retryButton: {
    backgroundColor: '#1A1530',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 12,
  },
  retryText: {
    color: '#FAFAFC',
    fontSize: 16,
    fontWeight: '600',
  },
})

const LOCATION_ASK_KEY = 'dashgo.locationAsked.v1'

function useBootstrapLocation() {
  const { data: user } = useCurrentUser()
  const updateMe = useUpdateMe()
  const attempted = useRef(false)

  useEffect(() => {
    if (!user) return
    if (attempted.current) return
    if (user.addressDefault?.lat && user.addressDefault?.lng) return
    attempted.current = true

    ;(async () => {
      try {
        const asked = await AsyncStorage.getItem(LOCATION_ASK_KEY)
        if (asked) return
        await AsyncStorage.setItem(LOCATION_ASK_KEY, '1')
        const coords = await requestDeviceLocation()
        let text = `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`
        try {
          const rev = await reverseGeocode(coords.lat, coords.lng)
          text = rev.text
        } catch {
          // silent
        }
        updateMe.mutate({
          addressDefault: { text, lat: coords.lat, lng: coords.lng },
        })
      } catch {
        // user denied or unavailable — silent
      }
    })()
  }, [user, updateMe])
}

const LOCKOUT_ALLOWLIST = new Set<string>(['/credit-pay', '/login'])

function useCreditLockoutGate() {
  const { data: user } = useCurrentUser()
  const pathname = usePathname()

  useEffect(() => {
    if (!user?.creditLocked) return
    if (!pathname) return
    if (LOCKOUT_ALLOWLIST.has(pathname)) return
    router.replace('/credit-pay')
  }, [user?.creditLocked, pathname])
}

SplashScreen.preventAutoHideAsync().catch(() => {})

/**
 * Detect axios-reported network failures so we can surface a friendly toast
 * via NetworkBanner instead of bubbling up a generic error.
 */
function isNetworkError(err: unknown): boolean {
  if (!axios.isAxiosError(err)) return false
  return err.code === 'ERR_NETWORK'
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (err) => {
      if (isNetworkError(err)) {
        notifyNetworkError()
        return
      }
      console.error('[query]', err)
    },
  }),
  mutationCache: new MutationCache({
    onError: (err) => {
      if (isNetworkError(err)) {
        notifyNetworkError()
        return
      }
      console.error('[mutation]', err)
    },
  }),
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
})

function AppStack() {
  useBootstrapLocation()
  useCreditLockoutGate()
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#FAFAFC' },
      }}
    >
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="(super)" />
      <Stack.Screen name="(promoter)" />
      <Stack.Screen name="r/[code]" />
      <Stack.Screen
        name="checkout"
        options={{
          headerShown: true,
          title: '',
          headerStyle: { backgroundColor: '#FAFAFC' },
          headerShadowVisible: false,
          headerTintColor: '#1A1530',
          headerBackTitle: 'Atrás',
        }}
      />
      <Stack.Screen
        name="credit-pay"
        options={{
          headerShown: true,
          title: 'Pagar crédito',
          headerStyle: { backgroundColor: '#FAFAFC' },
          headerShadowVisible: false,
          headerTintColor: '#1A1530',
          headerBackTitle: 'Atrás',
        }}
      />
    </Stack>
  )
}

/**
 * Resolve the Stripe publishable key from expo-constants (preferred — set
 * via app.config.ts `extra.stripePublishableKey`) with a fallback to the
 * raw env var. EAS injects EXPO_PUBLIC_* at build time, but if a future
 * OTA update mutates `extra` without rebuilding native, the env fallback
 * keeps us covered.
 */
function resolveStripeKey(): string | undefined {
  const fromExtra = Constants.expoConfig?.extra?.stripePublishableKey as
    | string
    | undefined
  const fromEnv = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY
  return fromExtra || fromEnv
}

/**
 * Runtime guard mirror of app.config.ts assertProductionStripeKey().
 *
 * Build-time guard can be bypassed if an EAS secret is revoked between
 * build and the user actually launching the app, or if an OTA update
 * accidentally drops the key from `extra`. In production, refuse to mount
 * StripeProvider when the key is missing/empty/test — instead render a
 * support-contact error screen so the user is never silently routed into
 * a checkout that will fail to tokenize.
 */
function isProductionStripeKeyInvalid(key: string | undefined): boolean {
  // Only enforce in production builds. Dev/preview keep using pk_test_.
  if (process.env.NODE_ENV !== 'production') return false
  if (!key || key === '') return true
  if (key.startsWith('pk_test_')) return true
  if (!key.startsWith('pk_live_')) return true
  return false
}

function StripeUnavailableScreen() {
  return (
    <View style={styles.errorContainer}>
      <Text style={styles.errorTitle}>DashGo</Text>
      <Text style={styles.errorMessage}>
        No se pudo iniciar el pago. Por favor, contactá soporte.
      </Text>
    </View>
  )
}

function RootLayout() {
  const [loaded] = useFonts({
    InterTight_400Regular,
    InterTight_500Medium,
    InterTight_600SemiBold,
    InterTight_700Bold,
    InterTight_500Medium_Italic,
  })

  useEffect(() => {
    if (loaded) SplashScreen.hideAsync().catch(() => {})
  }, [loaded])

  if (!loaded) return null

  const stripeKey = resolveStripeKey()

  // Production-only fail-safe: never mount StripeProvider with a bad key.
  if (isProductionStripeKeyInvalid(stripeKey)) {
    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <StatusBar style="dark" />
          <StripeUnavailableScreen />
        </SafeAreaProvider>
      </GestureHandlerRootView>
    )
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <StripeProvider
          publishableKey={stripeKey ?? ''}
          merchantIdentifier="merchant.com.dashgo"
          urlScheme="dashgo"
        >
          <SafeAreaProvider>
            <StatusBar style="dark" />
            <AppStack />
            <NetworkBanner />
          </SafeAreaProvider>
        </StripeProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  )
}

/**
 * Wrap the root component with `Sentry.wrap()` per @sentry/react-native v8.
 *
 * `Sentry.wrap` installs the touch-event breadcrumb integration and the
 * automatic component-tree error boundary (separate from Expo Router's
 * `ErrorBoundary` export above — the two layer cleanly). Per the SDK docs,
 * this MUST be applied to the default export of the root layout. If
 * `Sentry.init` was skipped (no DSN), `Sentry.wrap` is a passthrough.
 */
export default Sentry.wrap(RootLayout)
