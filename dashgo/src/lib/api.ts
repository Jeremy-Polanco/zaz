import axios from 'axios'
import Constants from 'expo-constants'
import type { LoginResponse } from './types'
import { getAccessToken, setAccessToken, setRefreshToken, getRefreshToken, clearTokens } from './token-storage'

const _apiUrl =
  (Constants.expoConfig?.extra?.apiUrl as string | undefined) ??
  process.env.EXPO_PUBLIC_API_URL

if (!_apiUrl) {
  throw new Error('API_URL is not configured. Set EXPO_PUBLIC_API_URL.')
}

const API_URL: string = _apiUrl

export { API_URL }

export const api = axios.create({ baseURL: API_URL, timeout: 15_000 })

export function productImageUrl(productId: string, version?: string | null) {
  const base = `${API_URL}/products/${productId}/image`
  return version ? `${base}?v=${encodeURIComponent(version)}` : base
}

api.interceptors.request.use(async (config) => {
  const token = await getAccessToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

let refreshing: Promise<string | null> | null = null

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = await getRefreshToken()
  if (!refreshToken) return null
  try {
    const { data } = await axios.post<LoginResponse>(`${API_URL}/auth/refresh`, {
      refreshToken,
    })
    await setAccessToken(data.accessToken)
    await setRefreshToken(data.refreshToken)
    return data.accessToken
  } catch {
    await clearTokens()
    return null
  }
}

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true
      if (!refreshing) refreshing = refreshAccessToken().finally(() => { refreshing = null })
      const token = await refreshing
      if (!token) throw error
      original.headers.Authorization = `Bearer ${token}`
      return api(original)
    }
    if (error.code === 'ECONNABORTED') {
      const timeoutError = new Error('Request timed out. Please check your connection and try again.')
      ;(timeoutError as NodeJS.ErrnoException).code = 'ECONNABORTED'
      throw timeoutError
    }
    throw error
  },
)

export async function setSession(data: LoginResponse): Promise<void> {
  await setAccessToken(data.accessToken)
  await setRefreshToken(data.refreshToken)
}

export async function clearSession(): Promise<void> {
  await clearTokens()
}
