import { Platform } from 'react-native'
import * as SecureStore from 'expo-secure-store'
import AsyncStorage from '@react-native-async-storage/async-storage'

const ACCESS_KEY = 'zaz.access_token'
const REFRESH_KEY = 'zaz.refresh_token'

// Legacy keys used before this migration — kept for one-time migration only.
const LEGACY_ACCESS_KEY = 'zaz.accessToken'
const LEGACY_REFRESH_KEY = 'zaz.refreshToken'

// Web fallback: in-memory storage (web bundles cannot use SecureStore).
// localStorage would persist but is not encrypted; in-memory is safer for tokens.
const webStore: Record<string, string> = {}

function isNative(): boolean {
  return Platform.OS === 'ios' || Platform.OS === 'android'
}

async function secureGet(key: string): Promise<string | null> {
  if (isNative()) {
    return SecureStore.getItemAsync(key)
  }
  return webStore[key] ?? null
}

async function secureSet(key: string, value: string): Promise<void> {
  if (isNative()) {
    await SecureStore.setItemAsync(key, value)
  } else {
    webStore[key] = value
  }
}

async function secureDelete(key: string): Promise<void> {
  if (isNative()) {
    await SecureStore.deleteItemAsync(key)
  } else {
    delete webStore[key]
  }
}

// --- One-time migration from AsyncStorage to SecureStore ---
let migrationRan = false

async function migrateFromAsyncStorage(): Promise<void> {
  if (migrationRan) return
  migrationRan = true
  if (!isNative()) return

  try {
    const [oldAccess, oldRefresh] = await Promise.all([
      AsyncStorage.getItem(LEGACY_ACCESS_KEY),
      AsyncStorage.getItem(LEGACY_REFRESH_KEY),
    ])

    const writes: Promise<unknown>[] = []
    const deletes: Promise<unknown>[] = []

    if (oldAccess) {
      writes.push(SecureStore.setItemAsync(ACCESS_KEY, oldAccess))
      deletes.push(AsyncStorage.removeItem(LEGACY_ACCESS_KEY))
    }
    if (oldRefresh) {
      writes.push(SecureStore.setItemAsync(REFRESH_KEY, oldRefresh))
      deletes.push(AsyncStorage.removeItem(LEGACY_REFRESH_KEY))
    }

    await Promise.all(writes)
    await Promise.all(deletes)
  } catch {
    // Non-fatal: old session will be lost, user will need to log in again.
  }
}

// --- Public API ---

export async function getAccessToken(): Promise<string | null> {
  await migrateFromAsyncStorage()
  return secureGet(ACCESS_KEY)
}

export async function setAccessToken(value: string): Promise<void> {
  await secureSet(ACCESS_KEY, value)
}

export async function getRefreshToken(): Promise<string | null> {
  await migrateFromAsyncStorage()
  return secureGet(REFRESH_KEY)
}

export async function setRefreshToken(value: string): Promise<void> {
  await secureSet(REFRESH_KEY, value)
}

export async function clearTokens(): Promise<void> {
  await Promise.all([secureDelete(ACCESS_KEY), secureDelete(REFRESH_KEY)])
}
