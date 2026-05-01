import '../global.css'
import { useEffect, useRef } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { Stack, router, usePathname } from 'expo-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
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

// Sentry hook point — install sentry-expo and replace this block when ready.
if (process.env.EXPO_PUBLIC_SENTRY_DSN) {
  /* TODO: init Sentry when sentry-expo is installed */
}

export function ErrorBoundary({ error, retry }: { error: Error; retry: () => void }) {
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

const LOCATION_ASK_KEY = 'zaz.locationAsked.v1'

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

const queryClient = new QueryClient({
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

export default function RootLayout() {
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

  const stripeKey = Constants.expoConfig?.extra?.stripePublishableKey as
    | string
    | undefined

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <StripeProvider
          publishableKey={stripeKey ?? ''}
          merchantIdentifier="merchant.com.zaz"
          urlScheme="zaz"
        >
          <SafeAreaProvider>
            <StatusBar style="dark" />
            <AppStack />
          </SafeAreaProvider>
        </StripeProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  )
}
