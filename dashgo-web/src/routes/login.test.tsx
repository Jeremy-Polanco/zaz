import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { renderWithProviders } from '../test/test-utils'

// ── Mocks ─────────────────────────────────────────────────────────────────────
// useLogin is the only auth hook the phone-only flow uses; the OTP hooks are
// stubbed so login.tsx imports resolve.
type LoginMock = {
  mutateAsync: ReturnType<typeof vi.fn>
  isPending: boolean
  isError: boolean
  error: unknown
}
let loginMock: LoginMock

vi.mock('../lib/auth', () => ({
  useLogin: () => loginMock,
  useSendOtp: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false }),
  useVerifyOtp: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
  }),
}))

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@tanstack/react-router')>()
  return {
    ...original,
    createFileRoute: () => () => ({}),
    useSearch: () => ({ next: undefined, ref: undefined }),
    Link: ({
      children,
      ...props
    }: {
      children: React.ReactNode
      to?: string
    }) => <a {...props}>{children}</a>,
  }
})

import { PhoneOnlyLogin } from './login'

function firstLoginError() {
  return Object.assign(new Error('bad request'), {
    response: { data: { message: 'Es tu primer ingreso — mandá también tu nombre' } },
  })
}

describe('PhoneOnlyLogin (phone-only default flow)', () => {
  beforeEach(() => {
    loginMock = {
      mutateAsync: vi.fn(),
      isPending: false,
      isError: false,
      error: null,
    }
  })

  it('renders a phone field and NO OTP code field', () => {
    renderWithProviders(
      <PhoneOnlyLogin referralCode={undefined} onAuthenticated={vi.fn()} />,
    )
    expect(screen.getByLabelText(/Teléfono/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/Código/i)).not.toBeInTheDocument()
    // No "send code" button — there is no OTP step.
    expect(
      screen.queryByRole('button', { name: /Enviar código/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Entrar/i }),
    ).toBeInTheDocument()
  })

  it('logs in an existing user with phone alone (no code in payload)', async () => {
    loginMock.mutateAsync.mockResolvedValue({
      accessToken: 'a',
      refreshToken: 'r',
      user: { role: 'client' },
      isNewUser: false,
    })
    const onAuthenticated = vi.fn()

    renderWithProviders(
      <PhoneOnlyLogin referralCode={undefined} onAuthenticated={onAuthenticated} />,
    )

    fireEvent.change(screen.getByLabelText(/Teléfono/i), {
      target: { value: '+18095550000' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Entrar/i }))

    await waitFor(() => expect(loginMock.mutateAsync).toHaveBeenCalledTimes(1))
    expect(loginMock.mutateAsync).toHaveBeenCalledWith({
      phone: '+18095550000',
      fullName: undefined,
      referralCode: undefined,
    })
    await waitFor(() =>
      expect(onAuthenticated).toHaveBeenCalledWith('client'),
    )
  })

  it('reveals a name field on first login and resubmits with the name', async () => {
    // First submit rejects with "primer ingreso"; second resolves.
    loginMock.mutateAsync
      .mockRejectedValueOnce(firstLoginError())
      .mockResolvedValueOnce({
        accessToken: 'a',
        refreshToken: 'r',
        user: { role: 'client' },
        isNewUser: true,
      })
    const onAuthenticated = vi.fn()

    renderWithProviders(
      <PhoneOnlyLogin referralCode={undefined} onAuthenticated={onAuthenticated} />,
    )

    fireEvent.change(screen.getByLabelText(/Teléfono/i), {
      target: { value: '+18095551111' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Entrar/i }))

    // Name field appears after the first-login error.
    await waitFor(() =>
      expect(screen.getByLabelText(/Tu nombre/i)).toBeInTheDocument(),
    )

    fireEvent.change(screen.getByLabelText(/Tu nombre/i), {
      target: { value: 'Juan Pérez' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Entrar/i }))

    await waitFor(() => expect(loginMock.mutateAsync).toHaveBeenCalledTimes(2))
    expect(loginMock.mutateAsync).toHaveBeenLastCalledWith({
      phone: '+18095551111',
      fullName: 'Juan Pérez',
      referralCode: undefined,
    })
    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledWith('client'))
  })

  it('forwards a deep-link referral code in the login payload', async () => {
    loginMock.mutateAsync.mockResolvedValue({
      accessToken: 'a',
      refreshToken: 'r',
      user: { role: 'client' },
      isNewUser: true,
    })

    renderWithProviders(
      <PhoneOnlyLogin referralCode="ABCD1234" onAuthenticated={vi.fn()} />,
    )

    // The referral badge is shown read-only.
    expect(screen.getByText(/ABCD1234/)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/Teléfono/i), {
      target: { value: '+18095552222' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Entrar/i }))

    await waitFor(() =>
      expect(loginMock.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ referralCode: 'ABCD1234' }),
      ),
    )
  })

  it('shows a server error message when login fails (non first-login)', () => {
    loginMock.isError = true
    loginMock.error = Object.assign(new Error('boom'), {
      response: { data: { message: 'Teléfono inválido' } },
    })

    renderWithProviders(
      <PhoneOnlyLogin referralCode={undefined} onAuthenticated={vi.fn()} />,
    )

    expect(screen.getByText('Teléfono inválido')).toBeInTheDocument()
  })
})
