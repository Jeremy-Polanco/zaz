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

// The promoter lookup that backs the manual "Tengo un código de promotor"
// field. Tests drive it per-code so we can assert both the valid and the
// invalid status lines.
vi.mock('../lib/queries', () => ({ usePromoterByCode: vi.fn() }))

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

import { usePromoterByCode } from '../lib/queries'
import { PhoneOnlyLogin } from './login'

const mockUsePromoter = vi.mocked(usePromoterByCode)

/** Default: the lookup never resolves to a promoter (nothing typed yet). */
function setPromoterLookup(
  impl: (code: string | undefined) => {
    data?: { fullName: string }
    isError?: boolean
  } = () => ({}),
) {
  mockUsePromoter.mockImplementation(
    (code) =>
      ({
        data: undefined,
        isPending: !code,
        isError: false,
        ...impl(code),
      }) as unknown as ReturnType<typeof usePromoterByCode>,
  )
}

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
    setPromoterLookup()
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

describe('PhoneOnlyLogin — manual promoter code (no ?ref in the URL)', () => {
  beforeEach(() => {
    loginMock = {
      mutateAsync: vi.fn(),
      isPending: false,
      isError: false,
      error: null,
    }
    setPromoterLookup()
  })

  function openToggle() {
    fireEvent.click(
      screen.getByRole('button', { name: /Tengo un código de promotor/i }),
    )
  }

  it('offers the toggle collapsed — no input until the user asks for it', () => {
    renderWithProviders(
      <PhoneOnlyLogin referralCode={undefined} onAuthenticated={vi.fn()} />,
    )
    expect(
      screen.getByRole('button', { name: /Tengo un código de promotor/i }),
    ).toBeInTheDocument()
    expect(
      screen.queryByLabelText(/Código de promotor/i),
    ).not.toBeInTheDocument()
  })

  it('hides the toggle when the code came from the link (?ref)', () => {
    renderWithProviders(
      <PhoneOnlyLogin referralCode="ABCD1234" onAuthenticated={vi.fn()} />,
    )
    expect(
      screen.queryByRole('button', { name: /Tengo un código de promotor/i }),
    ).not.toBeInTheDocument()
    // the read-only badge stays
    expect(screen.getByText(/ABCD1234/)).toBeInTheDocument()
  })

  it('reveals the labelled input and only accepts the code alphabet', () => {
    renderWithProviders(
      <PhoneOnlyLogin referralCode={undefined} onAuthenticated={vi.fn()} />,
    )
    openToggle()
    const input = screen.getByLabelText(/Código de promotor/i)
    expect(input).toHaveAttribute('maxLength', '8')
    expect(
      screen.getByText(/Solo aplica al crear una cuenta nueva/i),
    ).toBeInTheDocument()

    // lowercase is upcased; I/O/0/1 and punctuation are dropped.
    fireEvent.change(input, { target: { value: 'ab-io01cd' } })
    expect(input).toHaveValue('ABCD')
  })

  it('confirms who invited you once 8 valid characters are typed', async () => {
    setPromoterLookup((code) =>
      code === 'ABCD2345' ? { data: { fullName: 'María Luna' } } : {},
    )
    renderWithProviders(
      <PhoneOnlyLogin referralCode={undefined} onAuthenticated={vi.fn()} />,
    )
    openToggle()
    fireEvent.change(screen.getByLabelText(/Código de promotor/i), {
      target: { value: 'abcd2345' },
    })

    await waitFor(() =>
      expect(screen.getByText(/Te invitó María Luna/i)).toBeInTheDocument(),
    )
    expect(screen.getByLabelText(/Código de promotor/i)).toHaveAttribute(
      'aria-invalid',
      'false',
    )
  })

  it('flags an unknown code', async () => {
    setPromoterLookup((code) => (code ? { isError: true } : {}))
    renderWithProviders(
      <PhoneOnlyLogin referralCode={undefined} onAuthenticated={vi.fn()} />,
    )
    openToggle()
    const input = screen.getByLabelText(/Código de promotor/i)
    fireEvent.change(input, { target: { value: 'ZZZZ9999' } })

    await waitFor(() =>
      expect(screen.getByText(/Código no válido/i)).toBeInTheDocument(),
    )
    expect(input).toHaveAttribute('aria-invalid', 'true')
    // the status line is wired to the input for screen readers
    const describedBy = input.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(document.getElementById(describedBy!)).toHaveTextContent(
      /Código no válido/i,
    )
  })

  it('forwards the manually typed code in the login payload', async () => {
    setPromoterLookup((code) =>
      code === 'ABCD2345' ? { data: { fullName: 'María Luna' } } : {},
    )
    loginMock.mutateAsync.mockResolvedValue({
      accessToken: 'a',
      refreshToken: 'r',
      user: { role: 'client' },
      isNewUser: true,
    })

    renderWithProviders(
      <PhoneOnlyLogin referralCode={undefined} onAuthenticated={vi.fn()} />,
    )
    openToggle()
    fireEvent.change(screen.getByLabelText(/Código de promotor/i), {
      target: { value: 'abcd2345' },
    })
    fireEvent.change(screen.getByLabelText(/Teléfono/i), {
      target: { value: '+18095553333' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Entrar/i }))

    await waitFor(() =>
      expect(loginMock.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ referralCode: 'ABCD2345' }),
      ),
    )
  })

  it('sends no code when the field is opened but left empty', async () => {
    loginMock.mutateAsync.mockResolvedValue({
      accessToken: 'a',
      refreshToken: 'r',
      user: { role: 'client' },
      isNewUser: false,
    })

    renderWithProviders(
      <PhoneOnlyLogin referralCode={undefined} onAuthenticated={vi.fn()} />,
    )
    openToggle()
    fireEvent.change(screen.getByLabelText(/Teléfono/i), {
      target: { value: '+18095554444' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Entrar/i }))

    await waitFor(() =>
      expect(loginMock.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ referralCode: undefined }),
      ),
    )
  })
})
