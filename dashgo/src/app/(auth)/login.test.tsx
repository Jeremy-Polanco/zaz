/**
 * FIX MOBILE-G1 — graceful WhatsApp failure UX on the sign-in screen.
 *
 * The backend's POST /auth/otp/send now throws a Nest ServiceUnavailableException
 * with `{ code: 'WHATSAPP_SEND_FAILED' }` whenever the Meta WhatsApp Cloud API
 * refuses the send (API down, rate-limited, user has no WhatsApp). The mobile
 * client must:
 *
 *   1. Detect the typed error code (or 503 as fallback).
 *   2. Render the graceful failure block in Spanish with:
 *        - the actionable bullet list
 *        - a Retry button that is rate-limited by a 5s cooldown
 *        - a "Contactar soporte" button that opens mailto:support@dashgo.dev
 *   3. After 3 consecutive WhatsApp failures, switch the copy to the
 *      escalated "Seguimos teniendo problemas para llegar a WhatsApp…" text.
 *   4. Successful sendOtp resets the failure counter.
 *
 * Tests mock `useSendOtp` directly so we can drive the mutation state machine
 * without hitting axios / a real network. Cooldown tests use fake timers.
 */

import React from 'react'
import { act, fireEvent, waitFor } from '@testing-library/react-native'
import { Linking } from 'react-native'
import { renderWithProviders } from '../../test/test-utils'

// ── module mocks ──────────────────────────────────────────────────────────────

jest.mock('../../lib/queries', () => ({
  useSendOtp: jest.fn(),
  useVerifyOtp: jest.fn(),
  useLogin: jest.fn(),
}))

jest.mock('expo-router', () => {
  const router = {
    push: jest.fn(),
    back: jest.fn(),
    replace: jest.fn(),
    navigate: jest.fn(),
    dismiss: jest.fn(),
  }
  return {
    router,
    useRouter: () => router,
    useLocalSearchParams: jest.fn(() => ({})),
    Link: 'Link',
    Stack: { Screen: 'Stack.Screen' },
  }
})

jest.mock('../../lib/api', () => ({
  API_URL: 'http://localhost:3000',
  api: {
    get: jest.fn(),
    post: jest.fn(),
    delete: jest.fn(),
    patch: jest.fn(),
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
  },
}))

// Note: react-native-safe-area-context is already mocked by src/test/setup.ts.

// Avoid expo-symbols / native bridges in the unit suite.
jest.mock('expo-symbols', () => ({
  SymbolView: 'SymbolView',
}))

// Stub the visual ui kit — we only need the structural components.
// Use require() inside the factory (not module-level imports) so the
// factory doesn't reference out-of-scope variables.
jest.mock('../../components/ui', () => {
  const RN = require('react-native')
  const ReactInternal = require('react')
  const RHF = require('react-hook-form')
  return {
    Button: ({
      children,
      onPress,
      testID,
      loading,
      disabled,
    }: {
      children: React.ReactNode
      onPress?: () => void
      testID?: string
      loading?: boolean
      disabled?: boolean
    }) =>
      ReactInternal.createElement(
        RN.Pressable,
        { onPress, testID, disabled: disabled || loading },
        ReactInternal.createElement(
          RN.Text,
          null,
          loading ? 'Cargando…' : children,
        ),
      ),
    Eyebrow: ({ children }: { children: React.ReactNode }) =>
      ReactInternal.createElement(RN.Text, null, children),
    FieldLabel: ({ children }: { children: React.ReactNode }) =>
      ReactInternal.createElement(RN.Text, null, children),
    FieldError: ({ message }: { message?: string }) =>
      message ? ReactInternal.createElement(RN.Text, null, message) : null,
    // Mirrors the real PhoneField: hides "+1", takes 10 national digits, stores
    // E.164. Uses the real Controller so the form wiring is exercised.
    PhoneField: ({ control, name, testID, error }: any) =>
      ReactInternal.createElement(ReactInternal.Fragment, null, [
        ReactInternal.createElement(
          RHF.Controller,
          {
            key: 'ctrl',
            control,
            name,
            render: ({ field: { onChange, value } }: any) =>
              ReactInternal.createElement(RN.TextInput, {
                testID,
                value: String(value ?? '').replace(/^\+1/, ''),
                onChangeText: (text: string) => {
                  let digits = text.replace(/\D/g, '')
                  if (digits.length === 11 && digits.startsWith('1'))
                    digits = digits.slice(1)
                  digits = digits.slice(0, 10)
                  onChange(digits ? `+1${digits}` : '')
                },
              }),
          },
        ),
        error
          ? ReactInternal.createElement(RN.Text, { key: 'err' }, error)
          : null,
      ]),
    DashGoMark: () => null,
    BoltIcon: () => null,
  }
})

// ── imports after mocks ───────────────────────────────────────────────────────

import { useLogin, useSendOtp, useVerifyOtp } from '../../lib/queries'
import LoginScreen, {
  isWhatsAppSendFailure,
  WHATSAPP_RETRY_COOLDOWN_SECONDS,
  WHATSAPP_FAILURE_ESCALATION_THRESHOLD,
  SUPPORT_EMAIL,
} from './login'
import {
  SUPPORT_PHONE,
  WHATSAPP_ERROR_CODES,
} from '../../lib/whatsapp-error-codes'

const mockUseSendOtp = useSendOtp as jest.MockedFunction<typeof useSendOtp>
const mockUseVerifyOtp = useVerifyOtp as jest.MockedFunction<typeof useVerifyOtp>
const mockUseLogin = useLogin as jest.MockedFunction<typeof useLogin>

type SendOtpMutationState = {
  mutateAsync: jest.Mock
  isPending: boolean
  isError: boolean
  error: unknown
}

function makeSendOtpMock(overrides: Partial<SendOtpMutationState> = {}): SendOtpMutationState {
  return {
    mutateAsync: jest.fn().mockResolvedValue({ expiresAt: new Date().toISOString() }),
    isPending: false,
    isError: false,
    error: null,
    ...overrides,
  }
}

function makeVerifyOtpMock() {
  return {
    mutateAsync: jest.fn(),
    isPending: false,
    isError: false,
    error: null,
  }
}

function whatsappFailure() {
  return {
    response: {
      status: 503,
      data: {
        code: 'WHATSAPP_SEND_FAILED',
        message: 'No pudimos enviar el código por WhatsApp.',
      },
    },
  }
}

/**
 * Build a typed-code WhatsApp failure shaped like the backend's
 * BadRequestException / ServiceUnavailableException response. The HTTP
 * status reflects the backend's actual choice (400 for permanent codes,
 * 503 for transient).
 */
function whatsappFailureWithCode(
  code: string,
  message = 'mock message',
  status?: number,
) {
  const inferredStatus =
    status ??
    (code === WHATSAPP_ERROR_CODES.WHATSAPP_RECIPIENT_INVALID ||
    code === WHATSAPP_ERROR_CODES.WHATSAPP_RECIPIENT_NOT_REACHABLE
      ? 400
      : 503)
  return {
    response: {
      status: inferredStatus,
      data: { code, message },
    },
  }
}

// The OTP two-step flow is dormant by default (phone-only login is default).
// These suites exercise the OTP path, so re-enable it for every test. The
// phone-only suite at the bottom disables it again in its own beforeEach.
beforeEach(() => {
  process.env.EXPO_PUBLIC_AUTH_OTP_MODE = 'whatsapp'
})

afterEach(() => {
  jest.clearAllMocks()
  jest.useRealTimers()
  delete process.env.EXPO_PUBLIC_AUTH_OTP_MODE
})

// ── isWhatsAppSendFailure helper ──────────────────────────────────────────────

describe('isWhatsAppSendFailure', () => {
  it('returns true for backend WHATSAPP_SEND_FAILED code', () => {
    expect(isWhatsAppSendFailure(whatsappFailure())).toBe(true)
  })

  it('returns true for a bare 503 response (fallback path)', () => {
    expect(
      isWhatsAppSendFailure({ response: { status: 503, data: { message: 'oops' } } }),
    ).toBe(true)
  })

  it('returns false for 400 BadRequest (e.g. cooldown error)', () => {
    expect(
      isWhatsAppSendFailure({
        response: { status: 400, data: { message: 'Esperá 25s' } },
      }),
    ).toBe(false)
  })

  it('returns false for a plain Error with no response field', () => {
    expect(isWhatsAppSendFailure(new Error('boom'))).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(isWhatsAppSendFailure(undefined)).toBe(false)
  })
})

// ── WhatsAppFailureBlock rendering on the phone step ──────────────────────────

describe('LoginScreen — WhatsApp failure block on the phone step', () => {
  it('does NOT render the failure block on a clean initial render', () => {
    mockUseSendOtp.mockReturnValue(
      makeSendOtpMock() as unknown as ReturnType<typeof useSendOtp>,
    )
    mockUseVerifyOtp.mockReturnValue(
      makeVerifyOtpMock() as unknown as ReturnType<typeof useVerifyOtp>,
    )
    const { queryByTestId } = renderWithProviders(<LoginScreen />)
    expect(queryByTestId('whatsapp-failure-block')).toBeNull()
  })

  it('renders the failure block with retry + support buttons when sendOtp errored with WHATSAPP_SEND_FAILED', () => {
    mockUseSendOtp.mockReturnValue(
      makeSendOtpMock({ isError: true, error: whatsappFailure() }) as unknown as ReturnType<
        typeof useSendOtp
      >,
    )
    mockUseVerifyOtp.mockReturnValue(
      makeVerifyOtpMock() as unknown as ReturnType<typeof useVerifyOtp>,
    )

    const { getByTestId, getByText } = renderWithProviders(<LoginScreen />)
    expect(getByTestId('whatsapp-failure-block')).toBeTruthy()
    expect(getByTestId('whatsapp-failure-retry-btn')).toBeTruthy()
    expect(getByTestId('whatsapp-failure-support-btn')).toBeTruthy()
    // Spanish guidance copy is present.
    expect(
      getByText(/No pudimos enviarte el código por WhatsApp ahora mismo/i),
    ).toBeTruthy()
    // Bullet hints
    expect(getByText(/Verificá que tenés WhatsApp instalado/i)).toBeTruthy()
    expect(
      getByText(new RegExp(`O escribinos a soporte: ${SUPPORT_EMAIL}`, 'i')),
    ).toBeTruthy()
  })

  it('renders a generic error (not the failure block) when sendOtp errors with something other than WHATSAPP_SEND_FAILED', () => {
    mockUseSendOtp.mockReturnValue(
      makeSendOtpMock({
        isError: true,
        error: {
          response: { status: 400, data: { message: 'Teléfono inválido' } },
        },
      }) as unknown as ReturnType<typeof useSendOtp>,
    )
    mockUseVerifyOtp.mockReturnValue(
      makeVerifyOtpMock() as unknown as ReturnType<typeof useVerifyOtp>,
    )
    const { queryByTestId, getByText } = renderWithProviders(<LoginScreen />)
    expect(queryByTestId('whatsapp-failure-block')).toBeNull()
    expect(getByText('Teléfono inválido')).toBeTruthy()
  })

  it('opens mailto:support@dashgo.dev when "Contactar soporte" is pressed', () => {
    mockUseSendOtp.mockReturnValue(
      makeSendOtpMock({ isError: true, error: whatsappFailure() }) as unknown as ReturnType<
        typeof useSendOtp
      >,
    )
    mockUseVerifyOtp.mockReturnValue(
      makeVerifyOtpMock() as unknown as ReturnType<typeof useVerifyOtp>,
    )
    const openURLSpy = jest
      .spyOn(Linking, 'openURL')
      .mockResolvedValue(true as unknown as void)

    const { getByTestId } = renderWithProviders(<LoginScreen />)
    fireEvent.press(getByTestId('whatsapp-failure-support-btn'))
    expect(openURLSpy).toHaveBeenCalledWith(`mailto:${SUPPORT_EMAIL}`)
  })
})

// ── Retry cooldown ────────────────────────────────────────────────────────────

describe('LoginScreen — retry cooldown', () => {
  it('shows the cooldown countdown initially and disables retry, then enables after the cooldown elapses', async () => {
    // Fake both timers AND Date so the cooldown anchor stays anchored at
    // t=0 until we advance the clock explicitly.
    jest.useFakeTimers({ now: 0 })

    // First call rejects (so we stay on PhoneStep and `lastPhone` gets set);
    // second call resolves so the retry-after-cooldown step can verify it
    // was invoked.
    const mutateAsync = jest
      .fn()
      .mockRejectedValueOnce(whatsappFailure())
      .mockResolvedValueOnce({ expiresAt: new Date().toISOString() })
    mockUseSendOtp.mockReturnValue(
      makeSendOtpMock({
        isError: true,
        error: whatsappFailure(),
        mutateAsync,
      }) as unknown as ReturnType<typeof useSendOtp>,
    )
    mockUseVerifyOtp.mockReturnValue(
      makeVerifyOtpMock() as unknown as ReturnType<typeof useVerifyOtp>,
    )

    const { getByTestId, queryByText } = renderWithProviders(<LoginScreen />)

    // Initial submit so `lastPhone` is populated. The rejection keeps us on
    // PhoneStep with the failure block visible.
    await act(async () => {
      fireEvent.changeText(getByTestId('login-phone-input'), '+18095550000')
      fireEvent.press(getByTestId('login-send-code-btn'))
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    // Reset call count so the cooldown assertions are measured from zero.
    mutateAsync.mockClear()

    // Initial render — the cooldown is still pending. We don't pin the exact
    // remaining seconds because the inline tick() can run a microtask before
    // the first paint; instead we assert the user-visible contract: the
    // label contains "Reintentar en Ns" with N within [1, COOLDOWN_SECONDS]
    // and the button is NOT yet showing the unlocked "Reintentar" label.
    const cooldownLabel = (() => {
      for (let n = WHATSAPP_RETRY_COOLDOWN_SECONDS; n >= 1; n--) {
        if (queryByText(`Reintentar en ${n}s`)) return n
      }
      return null
    })()
    expect(cooldownLabel).not.toBeNull()
    expect(queryByText('Reintentar')).toBeNull()

    // Tapping during the cooldown must NOT trigger sendOtp.
    fireEvent.press(getByTestId('whatsapp-failure-retry-btn'))
    expect(mutateAsync).not.toHaveBeenCalled()

    // Advance time past the cooldown and ensure the label flips to "Reintentar".
    await act(async () => {
      jest.advanceTimersByTime(WHATSAPP_RETRY_COOLDOWN_SECONDS * 1000 + 500)
    })
    await waitFor(() => {
      // The label changes from "Reintentar en Ns" to plain "Reintentar"
      // once cooldownLeft hits 0. queryByText with an exact string is the
      // most reliable check.
      expect(queryByText('Reintentar')).toBeTruthy()
    })

    // Re-query the button so we get the fresh element (its accessibilityState
    // changes between renders).
    const enabledBtn = getByTestId('whatsapp-failure-retry-btn')
    expect(enabledBtn.props.accessibilityState?.disabled).toBe(false)

    // Now the retry tap goes through.
    await act(async () => {
      fireEvent.press(enabledBtn)
    })
    expect(mutateAsync).toHaveBeenCalledTimes(1)
  })
})

// ── Escalation copy after 3 consecutive failures ──────────────────────────────

describe('LoginScreen — escalation copy', () => {
  it('switches to the long-term copy after WHATSAPP_FAILURE_ESCALATION_THRESHOLD consecutive failures', async () => {
    jest.useFakeTimers({ now: 0 })

    // Each retry rejects with the WhatsApp failure shape so the in-component
    // `whatsappFailures` counter increments by one.
    const mutateAsync = jest.fn().mockRejectedValue(whatsappFailure())
    mockUseSendOtp.mockReturnValue(
      makeSendOtpMock({
        isError: true,
        error: whatsappFailure(),
        mutateAsync,
      }) as unknown as ReturnType<typeof useSendOtp>,
    )
    mockUseVerifyOtp.mockReturnValue(
      makeVerifyOtpMock() as unknown as ReturnType<typeof useVerifyOtp>,
    )

    const { getByTestId, queryByText, getByText } = renderWithProviders(
      <LoginScreen />,
    )

    // Enter a phone and submit once so `lastPhone` is populated. The retry
    // handler reuses this value — without it, retries are no-ops.
    await act(async () => {
      fireEvent.changeText(getByTestId('login-phone-input'), '+18095550000')
      fireEvent.press(getByTestId('login-send-code-btn'))
    })
    // The first submit also counts as a failure (mutateAsync rejects),
    // so the in-component counter starts at 1 after this.

    // Before any retry click, the failure block is the first-time copy.
    expect(
      getByText(/No pudimos enviarte el código por WhatsApp ahora mismo/i),
    ).toBeTruthy()

    // The initial submit was failure #1. We need to drive the counter past
    // WHATSAPP_FAILURE_ESCALATION_THRESHOLD via retries from the failure block.
    // We need (threshold - 1) more retries to reach the threshold.
    const additionalRetries = WHATSAPP_FAILURE_ESCALATION_THRESHOLD - 1
    for (let i = 0; i < additionalRetries; i++) {
      // Advance past the cooldown so the retry button accepts the press.
      await act(async () => {
        jest.advanceTimersByTime(WHATSAPP_RETRY_COOLDOWN_SECONDS * 1000 + 500)
      })
      // Press the retry button and flush the rejected mutateAsync.
      await act(async () => {
        fireEvent.press(getByTestId('whatsapp-failure-retry-btn'))
      })
      // Flush microtasks so the catch handler's setWhatsappFailures lands
      // before the next iteration reads the rendered copy.
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })
    }

    // 1 initial submit + (threshold - 1) retries = threshold failures.
    expect(mutateAsync).toHaveBeenCalledTimes(
      WHATSAPP_FAILURE_ESCALATION_THRESHOLD,
    )
    expect(
      getByText(/Seguimos teniendo problemas para llegar a WhatsApp/i),
    ).toBeTruthy()
    // First-time copy is gone.
    expect(
      queryByText(/No pudimos enviarte el código por WhatsApp ahora mismo/i),
    ).toBeNull()
  })
})

// ── FIX HIGH-G7 — Per-code rendering on the phone step ────────────────────────
//
// Each WhatsApp failure code maps to a distinct UX. These tests guarantee the
// switch in WhatsAppFailureBlock stays honest: copy + CTAs must change per code.

describe('LoginScreen — per-code WhatsApp failure UX (FIX HIGH-G7)', () => {
  function setupWithError(error: unknown) {
    mockUseSendOtp.mockReturnValue(
      makeSendOtpMock({ isError: true, error }) as unknown as ReturnType<
        typeof useSendOtp
      >,
    )
    mockUseVerifyOtp.mockReturnValue(
      makeVerifyOtpMock() as unknown as ReturnType<typeof useVerifyOtp>,
    )
  }

  it('renders the "alto tráfico" copy and keeps the Retry button for WHATSAPP_RATE_LIMITED', () => {
    setupWithError(
      whatsappFailureWithCode(WHATSAPP_ERROR_CODES.WHATSAPP_RATE_LIMITED),
    )
    const { getByTestId, queryByTestId, getByText } =
      renderWithProviders(<LoginScreen />)

    expect(getByTestId('whatsapp-failure-block')).toBeTruthy()
    expect(getByText(/Hay alto tráfico ahora/i)).toBeTruthy()
    // Retry stays available — the user just needs to wait the longer cooldown.
    expect(getByTestId('whatsapp-failure-retry-btn')).toBeTruthy()
    expect(queryByTestId('whatsapp-failure-call-support-btn')).toBeNull()
  })

  it('renders the "número inválido" copy and HIDES Retry for WHATSAPP_RECIPIENT_INVALID', () => {
    setupWithError(
      whatsappFailureWithCode(
        WHATSAPP_ERROR_CODES.WHATSAPP_RECIPIENT_INVALID,
      ),
    )
    const { getByTestId, queryByTestId, getByText } =
      renderWithProviders(<LoginScreen />)

    expect(getByTestId('whatsapp-failure-block')).toBeTruthy()
    expect(getByText(/El número no parece válido/i)).toBeTruthy()
    // Permanent failure — no retry. User must fix the input.
    expect(queryByTestId('whatsapp-failure-retry-btn')).toBeNull()
    expect(queryByTestId('whatsapp-failure-call-support-btn')).toBeNull()
  })

  it('renders the "sin WhatsApp" copy and a "Llamar a soporte" CTA for WHATSAPP_RECIPIENT_NOT_REACHABLE', () => {
    setupWithError(
      whatsappFailureWithCode(
        WHATSAPP_ERROR_CODES.WHATSAPP_RECIPIENT_NOT_REACHABLE,
      ),
    )
    const { getByTestId, queryByTestId, getByText } =
      renderWithProviders(<LoginScreen />)

    expect(getByTestId('whatsapp-failure-block')).toBeTruthy()
    expect(
      getByText(/No detectamos WhatsApp en este número/i),
    ).toBeTruthy()
    // No retry button — the recipient does not have WhatsApp.
    expect(queryByTestId('whatsapp-failure-retry-btn')).toBeNull()
    // "Llamar a soporte" is the actionable path.
    expect(getByTestId('whatsapp-failure-call-support-btn')).toBeTruthy()
  })

  it('opens tel:SUPPORT_PHONE when "Llamar a soporte" is pressed', () => {
    setupWithError(
      whatsappFailureWithCode(
        WHATSAPP_ERROR_CODES.WHATSAPP_RECIPIENT_NOT_REACHABLE,
      ),
    )
    const openURLSpy = jest
      .spyOn(Linking, 'openURL')
      .mockResolvedValue(true as unknown as void)

    const { getByTestId } = renderWithProviders(<LoginScreen />)
    fireEvent.press(getByTestId('whatsapp-failure-call-support-btn'))
    expect(openURLSpy).toHaveBeenCalledWith(`tel:${SUPPORT_PHONE}`)
  })

  it('still renders the generic flow + bullets for the catch-all WHATSAPP_SEND_FAILED', () => {
    setupWithError(
      whatsappFailureWithCode(WHATSAPP_ERROR_CODES.WHATSAPP_SEND_FAILED),
    )
    const { getByTestId, getByText } = renderWithProviders(<LoginScreen />)

    expect(getByTestId('whatsapp-failure-block')).toBeTruthy()
    expect(
      getByText(/No pudimos enviarte el código por WhatsApp ahora mismo/i),
    ).toBeTruthy()
    expect(getByText(/Verificá que tenés WhatsApp instalado/i)).toBeTruthy()
    expect(getByTestId('whatsapp-failure-retry-btn')).toBeTruthy()
  })
})

// ── Phone-only login (the DEFAULT flow — no OTP) ──────────────────────────────
//
// With EXPO_PUBLIC_AUTH_OTP_MODE unset (the default), LoginScreen renders the
// single-screen phone-only flow: phone → in, no code step, name revealed only
// on first login. These tests drive useLogin directly.

describe('LoginScreen — phone-only default flow', () => {
  type LoginMutationState = {
    mutateAsync: jest.Mock
    isPending: boolean
    isError: boolean
    error: unknown
  }
  function makeLoginMock(
    overrides: Partial<LoginMutationState> = {},
  ): LoginMutationState {
    return {
      mutateAsync: jest.fn(),
      isPending: false,
      isError: false,
      error: null,
      ...overrides,
    }
  }

  beforeEach(() => {
    // Phone-only is the default — make sure OTP is OFF for this suite even
    // though the top-level beforeEach turned it on.
    delete process.env.EXPO_PUBLIC_AUTH_OTP_MODE
    mockUseSendOtp.mockReturnValue(
      makeSendOtpMock() as unknown as ReturnType<typeof useSendOtp>,
    )
    mockUseVerifyOtp.mockReturnValue(
      makeVerifyOtpMock() as unknown as ReturnType<typeof useVerifyOtp>,
    )
  })

  it('renders a phone field and NO OTP code field', () => {
    mockUseLogin.mockReturnValue(
      makeLoginMock() as unknown as ReturnType<typeof useLogin>,
    )
    const { getByTestId, queryByTestId } = renderWithProviders(<LoginScreen />)
    expect(getByTestId('login-phone-input')).toBeTruthy()
    expect(getByTestId('login-submit-btn')).toBeTruthy()
    // The OTP code field and "send code" button do not exist in this flow.
    expect(queryByTestId('login-code-input')).toBeNull()
    expect(queryByTestId('login-send-code-btn')).toBeNull()
  })

  it('logs in an existing user with phone alone (no code in payload)', async () => {
    const mutateAsync = jest.fn().mockResolvedValue({
      accessToken: 'a',
      refreshToken: 'r',
      user: { role: 'client' },
      isNewUser: false,
    })
    mockUseLogin.mockReturnValue(
      makeLoginMock({ mutateAsync }) as unknown as ReturnType<typeof useLogin>,
    )

    const { getByTestId } = renderWithProviders(<LoginScreen />)
    await act(async () => {
      fireEvent.changeText(getByTestId('login-phone-input'), '+18095550000')
      fireEvent.press(getByTestId('login-submit-btn'))
    })

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1))
    expect(mutateAsync).toHaveBeenCalledWith({
      phone: '+18095550000',
      fullName: undefined,
      referralCode: undefined,
    })
  })

  it('reveals a name field on first login and resubmits with the name', async () => {
    const mutateAsync = jest
      .fn()
      .mockRejectedValueOnce({
        response: {
          status: 400,
          data: { message: 'Es tu primer ingreso — mandá también tu nombre' },
        },
      })
      .mockResolvedValueOnce({
        accessToken: 'a',
        refreshToken: 'r',
        user: { role: 'client' },
        isNewUser: true,
      })
    mockUseLogin.mockReturnValue(
      makeLoginMock({ mutateAsync }) as unknown as ReturnType<typeof useLogin>,
    )

    const { getByTestId, queryByTestId } = renderWithProviders(<LoginScreen />)

    await act(async () => {
      fireEvent.changeText(getByTestId('login-phone-input'), '+18095551111')
      fireEvent.press(getByTestId('login-submit-btn'))
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    // The name field appears after the first-login error.
    await waitFor(() => expect(queryByTestId('login-name-input')).toBeTruthy())

    await act(async () => {
      fireEvent.changeText(getByTestId('login-name-input'), 'Juan Pérez')
      fireEvent.press(getByTestId('login-submit-btn'))
    })

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(2))
    expect(mutateAsync).toHaveBeenLastCalledWith({
      phone: '+18095551111',
      fullName: 'Juan Pérez',
      referralCode: undefined,
    })
  })
})
