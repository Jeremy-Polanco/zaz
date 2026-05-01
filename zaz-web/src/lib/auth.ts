import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, clearSession, setSession } from './api'
import type { AuthUser, LoginResponse } from './types'
import type { SendOtpInput, VerifyOtpInput } from './schemas'

export function useCurrentUser() {
  return useQuery<AuthUser | null>({
    queryKey: ['auth', 'me'],
    queryFn: async () => {
      const token = localStorage.getItem('zaz.accessToken')
      if (!token) return null
      const { data } = await api.get<AuthUser>('/auth/me')
      return data
    },
    staleTime: 60_000,
    retry: false,
  })
}

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
