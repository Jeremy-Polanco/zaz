import { useEffect, useRef } from 'react'
import { Platform } from 'react-native'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import Constants from 'expo-constants'
import { router } from 'expo-router'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { api } from './api'

/**
 * Push notifications (Expo) — device registration + tap deep-linking.
 *
 * The backend sends order-status updates and the win-back reminder through
 * the Expo Push API; the payload carries `data.orderId` so tapping the
 * notification lands directly on the live tracking screen.
 */

const PUSH_TOKEN_KEY = 'dashgo.pushToken.v1'

// Foreground presentation: show the banner even while the app is open —
// an "en ruta" heads-up is useful mid-browse, and iOS suppresses it otherwise.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
})

function openFromNotification(data: unknown): void {
  const orderId = (data as { orderId?: string } | null)?.orderId
  if (orderId) {
    router.push({ pathname: '/orders/[orderId]', params: { orderId } })
  }
}

/**
 * Ask permission (first run only) and register this device's Expo token with
 * the API. Safe to call repeatedly — registration is an idempotent upsert.
 * No-ops on simulators and when the user denies permission.
 */
export async function registerForPushNotifications(): Promise<void> {
  if (!Device.isDevice) return

  const current = await Notifications.getPermissionsAsync()
  let status = current.status
  if (status === 'undetermined') {
    status = (await Notifications.requestPermissionsAsync()).status
  }
  if (status !== 'granted') return

  const projectId = (
    Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined
  )?.eas?.projectId
  const { data: token } = await Notifications.getExpoPushTokenAsync({
    projectId,
  })

  await api.post('/me/push-tokens', {
    token,
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
  })
  await AsyncStorage.setItem(PUSH_TOKEN_KEY, token)
}

/**
 * Best-effort unregister on logout so the next owner of this session does not
 * receive the previous user's order updates. Runs BEFORE the session clears
 * (the DELETE needs the auth header).
 */
export async function unregisterPushToken(): Promise<void> {
  try {
    const token = await AsyncStorage.getItem(PUSH_TOKEN_KEY)
    if (!token) return
    await api.delete('/me/push-tokens', {
      data: { token, platform: Platform.OS === 'ios' ? 'ios' : 'android' },
    })
    await AsyncStorage.removeItem(PUSH_TOKEN_KEY)
  } catch {
    // Logout must never block on network — the backend prunes dead tokens
    // on its own when Expo reports DeviceNotRegistered.
  }
}

/**
 * Mount once (AppStack). Registers the device whenever a user is logged in
 * and wires notification taps — both warm (listener) and cold start
 * (getLastNotificationResponseAsync) — to the order tracking screen.
 */
export function usePushNotifications(userId: string | undefined): void {
  const registeredFor = useRef<string | null>(null)

  useEffect(() => {
    if (!userId || registeredFor.current === userId) return
    registeredFor.current = userId
    registerForPushNotifications().catch(() => {
      // Permission denied or network hiccup — retried on next login/app start.
      registeredFor.current = null
    })
  }, [userId])

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        openFromNotification(response.notification.request.content.data)
      },
    )
    // Cold start: the tap that LAUNCHED the app never reaches the listener.
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) {
        openFromNotification(response.notification.request.content.data)
      }
    })
    return () => sub.remove()
  }, [])
}
