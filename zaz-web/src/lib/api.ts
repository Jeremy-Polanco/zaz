import axios, { AxiosError, type AxiosRequestConfig } from 'axios'
import type { LoginResponse } from './types'

const API_URL: string = import.meta.env.VITE_API_URL
if (!API_URL) throw new Error('VITE_API_URL is required')

// SECURITY NOTE: JWTs are stored in localStorage which is accessible to any
// JS running on the page (XSS risk). The proper fix is httpOnly cookies managed
// by the backend, but that requires a coordinated backend change. Migrating to
// httpOnly cookies is a post-MVP item tracked separately.
export const TOKEN_KEY = 'zaz.accessToken'
export const REFRESH_KEY = 'zaz.refreshToken'

export function productImageUrl(productId: string, version?: string | null) {
  const base = `${API_URL}/products/${productId}/image`
  return version ? `${base}?v=${encodeURIComponent(version)}` : base
}

export const api = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY)
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`)
  }
  return config
})

let refreshing: Promise<string | null> | null = null

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = localStorage.getItem(REFRESH_KEY)
  if (!refreshToken) return null
  try {
    const { data } = await axios.post<LoginResponse>(`${API_URL}/auth/refresh`, {
      refreshToken,
    })
    localStorage.setItem(TOKEN_KEY, data.accessToken)
    localStorage.setItem(REFRESH_KEY, data.refreshToken)
    return data.accessToken
  } catch {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(REFRESH_KEY)
    return null
  }
}

api.interceptors.response.use(
  (r) => r,
  async (error: AxiosError) => {
    const original = error.config as (AxiosRequestConfig & { _retry?: boolean }) | undefined
    if (error.response?.status === 401 && original && !original._retry) {
      original._retry = true
      refreshing = refreshing ?? refreshAccessToken()
      const newToken = await refreshing
      refreshing = null
      if (newToken) {
        original.headers = { ...original.headers, Authorization: `Bearer ${newToken}` }
        return api.request(original)
      }
    }
    return Promise.reject(error)
  },
)

export function setSession(tokens: { accessToken: string; refreshToken: string }) {
  localStorage.setItem(TOKEN_KEY, tokens.accessToken)
  localStorage.setItem(REFRESH_KEY, tokens.refreshToken)
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(REFRESH_KEY)
}
