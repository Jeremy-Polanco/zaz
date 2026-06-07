import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, clearSession, setSession } from './api'
import type { AuthUser, LoginResponse } from './types'
import type { LoginInput, SendOtpInput, VerifyOtpInput } from './schemas'

export function useCurrentUser() {
  return useQuery<AuthUser | null>({
    queryKey: ['auth', 'me'],
    queryFn: async () => {
      const token = localStorage.getItem('dashgo.accessToken')
      if (!token) return null
      const { data } = await api.get<AuthUser>('/auth/me')
      return data
    },
    staleTime: 60_000,
    retry: false,
  })
}

/**
 * Phone-only login (the default flow). Posts phone (+ name on first login) to
 * the same verify endpoint and establishes the IDENTICAL session that OTP
 * verification used to produce: tokens in localStorage + the ['auth','me']
 * cache primed. No code is sent.
 */
export function useLogin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: LoginInput) => {
      const { data } = await api.post<LoginResponse & { isNewUser: boolean }>(
        '/auth/otp/verify',
        input,
      )
      return data
    },
    onSuccess: (data) => {
      setSession(data)
      qc.setQueryData(['auth', 'me'], data.user)
    },
  })
}

// ── Dormant OTP path (re-enabled via VITE_AUTH_OTP_MODE=whatsapp|sandbox) ────

export function useSendOtp() {
  return useMutation({
    mutationFn: async (input: SendOtpInput) => {
      const { data } = await api.post<{ sent: boolean; expiresAt: string }>(
        '/auth/otp/send',
        input,
      )
      return data
    },
  })
}

export function useVerifyOtp() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: VerifyOtpInput) => {
      const { data } = await api.post<LoginResponse & { isNewUser: boolean }>(
        '/auth/otp/verify',
        input,
      )
      return data
    },
    onSuccess: (data) => {
      setSession(data)
      qc.setQueryData(['auth', 'me'], data.user)
    },
  })
}

export function useLogout() {
  const qc = useQueryClient()
  return () => {
    clearSession()
    qc.setQueryData(['auth', 'me'], null)
    qc.invalidateQueries()
  }
}

/**
 * Permanent account deletion (Apple Guideline 5.1.1(v) / privacy parity with
 * mobile). Calls DELETE /auth/me; the server hard-deletes PII and anonymizes
 * retained orders. On success we clear the local session and wipe the cache —
 * the caller handles navigation (→ /login) and any confirmation UX.
 */
export function useDeleteAccount() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      await api.delete('/auth/me')
    },
    onSuccess: () => {
      clearSession()
      qc.setQueryData(['auth', 'me'], null)
      qc.clear()
    },
  })
}
