import { useEffect, useState } from 'react'
import { createFileRoute, Link, useSearch } from '@tanstack/react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  loginSchema,
  sendOtpSchema,
  verifyOtpSchema,
  type LoginInput,
  type SendOtpInput,
  type VerifyOtpInput,
} from '../lib/schemas'
import { useLogin, useSendOtp, useVerifyOtp } from '../lib/auth'
import { usePromoterByCode } from '../lib/queries'
import { Button, FieldError, Input, Label, PhoneField } from '../components/ui'
import { isStaff } from '../lib/roles'
import type { UserRole } from '../lib/types'

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>) => ({
    next: typeof search.next === 'string' ? search.next : undefined,
    ref:
      typeof search.ref === 'string' && search.ref.length === 8
        ? search.ref.toUpperCase()
        : undefined,
  }),
  component: LoginPage,
})

function serverMessage(err: unknown, fallback: string) {
  return (
    (err as Error & { response?: { data?: { message?: string } } })?.response?.data
      ?.message ?? fallback
  )
}

/** An empty/partial typed code must never reach the API as ''. */
function typedReferralCode(raw: string | undefined): string | undefined {
  const code = normalizeReferralCode(raw?.trim() ?? '')
  return code.length === REFERRAL_CODE_LENGTH ? code : undefined
}

export function isFirstLoginError(err: unknown): boolean {
  const msg = (err as Error & { response?: { data?: { message?: string } } })
    ?.response?.data?.message
  return typeof msg === 'string' && msg.toLowerCase().includes('primer ingreso')
}

export function destForRole(role: string, next?: string): string {
  return (
    next ??
    (isStaff(role as UserRole)
      ? '/super/orders'
      : role === 'promoter'
        ? '/promoter'
        : '/catalog')
  )
}

// Phone-only login is the DEFAULT. OTP is dormant and only renders when an
// operator re-enables it via VITE_AUTH_OTP_MODE=whatsapp|sandbox (build-time so
// Vite tree-shakes the unused branch).
const OTP_ENABLED =
  import.meta.env.VITE_AUTH_OTP_MODE === 'whatsapp' ||
  import.meta.env.VITE_AUTH_OTP_MODE === 'sandbox'

// Promoter codes are 8 chars from an ambiguity-free alphabet (no I/O/0/1) —
// same set the backend validates. Typing is filtered so a mis-keyed "O" never
// becomes a "código no válido".
const REFERRAL_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const REFERRAL_CODE_LENGTH = 8

export function normalizeReferralCode(raw: string): string {
  return raw
    .toUpperCase()
    .split('')
    .filter((c) => REFERRAL_ALPHABET.includes(c))
    .join('')
    .slice(0, REFERRAL_CODE_LENGTH)
}

function ReferralBadge({ code }: { code: string }) {
  return (
    <div className="mt-6 inline-flex items-center gap-2 border border-accent/30 bg-accent/10 px-3 py-1.5">
      <span className="h-1.5 w-1.5 rounded-full bg-accent" />
      <span className="text-[0.7rem] uppercase tracking-[0.2em] text-accent-dark">
        Registrándote con código:{' '}
        <span className="text-brand">{code}</span>
      </span>
    </div>
  )
}

// Manual entry for people who installed the app / opened the web WITHOUT the
// /r/<code> deep link. Collapsed by default so it never distracts the 99% who
// just want to log in. Web ↔ mobile parity: same wording as the app.
function PromoterCodeField({
  value,
  onChange,
  error,
}: {
  value: string
  onChange: (code: string) => void
  error?: string
}) {
  const [open, setOpen] = useState(false)
  const complete = value.length === REFERRAL_CODE_LENGTH
  const lookup = usePromoterByCode(complete ? value : undefined)
  const promoter = complete ? lookup.data : undefined
  const unknown = complete && lookup.isError
  const statusId = 'referralCode-status'

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="referralCode-panel"
        onClick={() => {
          if (open) onChange('')
          setOpen((v) => !v)
        }}
        className="text-[0.72rem] uppercase tracking-[0.18em] text-ink-muted underline-offset-4 hover:text-ink hover:underline"
      >
        Tengo un código de promotor
      </button>

      <div id="referralCode-panel" hidden={!open}>
        {open ? (
          <div className="mt-4">
            <Label htmlFor="referralCode">Código de promotor</Label>
            <Input
              id="referralCode"
              type="text"
              inputMode="text"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={REFERRAL_CODE_LENGTH}
              placeholder="ABCD2345"
              aria-invalid={Boolean(unknown)}
              aria-describedby={statusId}
              className="nums uppercase tracking-[0.3em]"
              value={value}
              onChange={(e) => onChange(normalizeReferralCode(e.target.value))}
            />
            <div id={statusId}>
              {promoter ? (
                <p className="mt-2 text-xs font-medium text-ok">
                  Te invitó {promoter.fullName}
                </p>
              ) : unknown ? (
                <p className="mt-2 text-xs font-medium text-bad">
                  Código no válido
                </p>
              ) : null}
              <p className="mt-2 text-xs text-ink-muted">
                Solo aplica al crear una cuenta nueva.
              </p>
            </div>
            <FieldError message={error} />
          </div>
        ) : null}
      </div>
    </div>
  )
}

function LoginPoster({ tagline }: { tagline: string }) {
  return (
    <div className="relative hidden overflow-hidden border-r border-ink/15 bg-ink p-10 text-paper md:flex md:flex-col md:justify-between">
      <div className="flex items-center justify-between">
        <img
          src="/brand/udash-logo.png"
          alt="Udash logo"
          width={128}
          className="w-32 rounded-xl bg-paper p-3 shadow-lg shadow-black/30 ring-1 ring-black/5"
        />
        <span className="text-[0.7rem] uppercase tracking-[0.24em] text-accent">
          NJ
        </span>
      </div>
      <div>
        <p className="text-[0.7rem] uppercase tracking-[0.24em] text-paper/60">
          Edición diaria
        </p>
        <h2 className="display mt-3 text-6xl font-semibold leading-[0.95] tracking-[-0.02em]">
          Bienvenido
          <br />
          <span className="italic text-accent">de vuelta.</span>
        </h2>
        <p className="mt-6 max-w-md text-base leading-relaxed text-paper/80">
          {tagline}
        </p>
      </div>
      <div className="flex items-end justify-between">
        <span className="text-[0.7rem] uppercase tracking-[0.24em] text-paper/60">
          Vol. 01 / Login
        </span>
        <span className="display text-9xl font-bold leading-none text-accent">
          01
        </span>
      </div>
    </div>
  )
}

function LoginPage() {
  const { next, ref } = useSearch({ from: '/login' })
  const [step, setStep] = useState<'phone' | 'code'>('phone')
  const [phone, setPhone] = useState('')
  const [expiresAt, setExpiresAt] = useState<string | null>(null)
  // A code typed by hand on the phone step must survive into the OTP step the
  // same way ?ref does — CodeStep only ever sees a single `referralCode` prop.
  const [typedRef, setTypedRef] = useState<string | undefined>(undefined)

  const handleVerified = (role: string) => {
    window.location.assign(destForRole(role, next))
  }

  if (!OTP_ENABLED) {
    return (
      <div className="grid min-h-[calc(100vh-10rem)] grid-cols-1 md:grid-cols-2">
        <LoginPoster tagline="Tu colmado ya te espera. Entrá con tu teléfono." />
        <div className="page-rise flex items-center justify-center px-6 py-16">
          <div className="w-full max-w-md">
            <PhoneOnlyLogin referralCode={ref} onAuthenticated={handleVerified} />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="grid min-h-[calc(100vh-10rem)] grid-cols-1 md:grid-cols-2">
      <LoginPoster tagline="Tu colmado ya te espera. Entra con tu teléfono — te mandamos un código por WhatsApp." />
      <div className="page-rise flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-md">
          {step === 'phone' ? (
            <PhoneStep
              next={next}
              referralCode={ref}
              onSent={(p, exp, code) => {
                setPhone(p)
                setExpiresAt(exp)
                setTypedRef(code)
                setStep('code')
              }}
            />
          ) : (
            <CodeStep
              phone={phone}
              expiresAt={expiresAt}
              referralCode={ref ?? typedRef}
              onBack={() => setStep('phone')}
              onResent={(exp) => setExpiresAt(exp)}
              onVerified={handleVerified}
            />
          )}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// PhoneOnlyLogin — the default, canonical login (no OTP).
//
// The user enters their phone and submits. Existing users are logged in
// immediately; brand-new users get a name field revealed on the spot
// ("primer ingreso") and resubmit with it. This mirrors the mobile flow.
//
// SECURITY CAVEAT: with OTP disabled, anyone who knows a registered phone can
// sign in as that user. This is an accepted product decision — see the backend
// AUTH_OTP_MODE notes (env.schema.ts) for how to re-enable verified login.
// ─────────────────────────────────────────────────────────────────────────
export function PhoneOnlyLogin({
  referralCode,
  onAuthenticated,
}: {
  referralCode: string | undefined
  onAuthenticated: (role: string) => void
}) {
  const login = useLogin()
  const [needsName, setNeedsName] = useState(false)
  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      phone: '',
      fullName: undefined,
      referralCode: referralCode ?? undefined,
    },
  })

  const onSubmit = form.handleSubmit(async (values) => {
    const trimmedName = values.fullName?.trim()
    if (needsName && !trimmedName) {
      form.setError('fullName', {
        type: 'required',
        message: 'Poné tu nombre para crear tu cuenta',
      })
      form.setFocus('fullName')
      return
    }
    try {
      const res = await login.mutateAsync({
        phone: values.phone,
        fullName: trimmedName ? trimmedName : undefined,
        referralCode: referralCode ?? typedReferralCode(values.referralCode),
        dateOfBirth: values.dateOfBirth ? values.dateOfBirth : undefined,
      })
      onAuthenticated(res.user.role)
    } catch (err) {
      // First-ever login for this phone: reveal the name field and let the
      // user resubmit. Any other error surfaces via login.isError below.
      if (isFirstLoginError(err) && !needsName) {
        setNeedsName(true)
        setTimeout(() => form.setFocus('fullName'), 0)
      }
    }
  })

  return (
    <>
      <span className="eyebrow">Entrar</span>
      <h1 className="display mt-3 text-5xl font-semibold leading-[1] tracking-[-0.02em]">
        Iniciar sesión
      </h1>
      <p className="mt-3 text-base text-ink-soft">
        Poné tu teléfono y entrás al toque.
      </p>

      {referralCode ? <ReferralBadge code={referralCode} /> : null}

      <form onSubmit={onSubmit} className="mt-10 flex flex-col gap-6">
        <PhoneField
          control={form.control}
          name="phone"
          error={form.formState.errors.phone?.message}
        />
        {referralCode ? null : (
          <PromoterCodeField
            value={form.watch('referralCode') ?? ''}
            onChange={(code) =>
              form.setValue('referralCode', code, { shouldValidate: false })
            }
            error={form.formState.errors.referralCode?.message}
          />
        )}
        {needsName && (
          <div>
            <p className="mb-2 border-l-2 border-accent pl-3 text-sm font-medium text-ink">
              Primer ingreso detectado — dinos cómo te llamas para crear tu
              cuenta.
            </p>
            <Label htmlFor="fullName">Tu nombre</Label>
            <Input
              id="fullName"
              type="text"
              autoComplete="name"
              placeholder="Juan Pérez"
              className="text-lg"
              {...form.register('fullName')}
            />
            <FieldError message={form.formState.errors.fullName?.message} />
            <div className="mt-4">
              <Label htmlFor="dateOfBirth">
                Fecha de nacimiento{' '}
                <span className="text-ink-muted">(opcional)</span>
              </Label>
              <Input
                id="dateOfBirth"
                type="date"
                autoComplete="bday"
                {...form.register('dateOfBirth')}
              />
              <p className="mt-1 text-xs text-ink-muted">
                Para saludarte en tu cumpleaños 🎂
              </p>
              <FieldError
                message={form.formState.errors.dateOfBirth?.message}
              />
            </div>
          </div>
        )}
        {login.isError && !isFirstLoginError(login.error) && (
          <p className="border-l-2 border-bad pl-3 text-sm font-medium text-bad">
            {serverMessage(login.error, 'No pudimos iniciar sesión')}
          </p>
        )}
        <Button type="submit" size="lg" disabled={login.isPending}>
          {login.isPending ? 'Entrando…' : 'Entrar →'}
        </Button>
        <p className="text-xs text-ink-muted">
          Al continuar aceptás nuestra{' '}
          <Link to="/privacidad" className="underline">
            política de privacidad
          </Link>
          .
        </p>
      </form>
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Dormant OTP flow (PhoneStep + CodeStep) — only rendered when
// VITE_AUTH_OTP_MODE=whatsapp|sandbox. Kept so verified login can be turned
// back on via config without a code revert.
// ─────────────────────────────────────────────────────────────────────────
function PhoneStep({
  next: _next,
  referralCode,
  onSent,
}: {
  next: string | undefined
  referralCode: string | undefined
  onSent: (
    phone: string,
    expiresAt: string,
    referralCode: string | undefined,
  ) => void
}) {
  const sendOtp = useSendOtp()
  // sendOtpSchema carries no referralCode (the backend only reads it on
  // verify), so a manually typed code is held here and handed to CodeStep.
  const [typedRef, setTypedRef] = useState('')
  const form = useForm<SendOtpInput>({
    resolver: zodResolver(sendOtpSchema),
    defaultValues: { phone: '' },
  })

  const onSubmit = form.handleSubmit(async (values) => {
    const res = await sendOtp.mutateAsync(values)
    onSent(values.phone, res.expiresAt, typedReferralCode(typedRef))
  })

  return (
    <>
      <span className="eyebrow">Entrar</span>
      <h1 className="display mt-3 text-5xl font-semibold leading-[1] tracking-[-0.02em]">
        Iniciar sesión
      </h1>
      <p className="mt-3 text-base text-ink-soft">
        Poné tu teléfono y te mandamos un código por WhatsApp.
      </p>

      {referralCode ? <ReferralBadge code={referralCode} /> : null}

      <form onSubmit={onSubmit} className="mt-10 flex flex-col gap-6">
        <PhoneField
          control={form.control}
          name="phone"
          error={form.formState.errors.phone?.message}
        />
        {referralCode ? null : (
          <PromoterCodeField value={typedRef} onChange={setTypedRef} />
        )}
        {sendOtp.isError && (
          <p className="border-l-2 border-bad pl-3 text-sm font-medium text-bad">
            {serverMessage(sendOtp.error, 'No pudimos mandar el código')}
          </p>
        )}
        <Button type="submit" size="lg" disabled={sendOtp.isPending}>
          {sendOtp.isPending ? 'Enviando…' : 'Enviar código →'}
        </Button>
        <p className="text-xs text-ink-muted">
          Al continuar aceptás nuestra{' '}
          <Link to="/privacidad" className="underline">
            política de privacidad
          </Link>
          .
        </p>
      </form>
    </>
  )
}

function CodeStep({
  phone,
  expiresAt,
  referralCode,
  onBack,
  onResent,
  onVerified,
}: {
  phone: string
  expiresAt: string | null
  referralCode: string | undefined
  onBack: () => void
  onResent: (expiresAt: string) => void
  onVerified: (role: string) => void
}) {
  const verifyOtp = useVerifyOtp()
  const sendOtp = useSendOtp()
  const [needsName, setNeedsName] = useState(false)
  const form = useForm<VerifyOtpInput>({
    resolver: zodResolver(verifyOtpSchema),
    defaultValues: {
      phone,
      code: '',
      fullName: undefined,
      referralCode: referralCode ?? undefined,
    },
  })
  // keep phone field in sync if user edits it upstream
  useEffect(() => {
    form.setValue('phone', phone)
  }, [phone, form])

  // resend countdown — backend cooldown is 30s, referenced off expiresAt - 5min (send time)
  const [secondsLeft, setSecondsLeft] = useState(() =>
    computeSecondsLeft(expiresAt),
  )
  useEffect(() => {
    setSecondsLeft(computeSecondsLeft(expiresAt))
    const id = setInterval(() => {
      setSecondsLeft(computeSecondsLeft(expiresAt))
    }, 1000)
    return () => clearInterval(id)
  }, [expiresAt])

  const onSubmit = form.handleSubmit(
    async (values) => {
      const trimmedName = values.fullName?.trim()
      if (needsName && !trimmedName) {
        form.setError('fullName', {
          type: 'required',
          message: 'Poné tu nombre para crear la cuenta',
        })
        form.setFocus('fullName')
        return
      }
      const payload: VerifyOtpInput = {
        phone: values.phone,
        code: values.code,
        fullName: trimmedName ? trimmedName : undefined,
        referralCode: referralCode ?? typedReferralCode(values.referralCode),
      }
      try {
        const res = await verifyOtp.mutateAsync(payload)
        onVerified(res.user.role)
      } catch (err) {
        if (isFirstLoginError(err) && !needsName) {
          setNeedsName(true)
          // focus on next tick so the newly-rendered input is mounted
          setTimeout(() => form.setFocus('fullName'), 0)
          return
        }
        throw err
      }
    },
    (errors) => {
      // diagnostic: surface form-level validation errors that are otherwise
      // hidden because the field isn't rendered (e.g. fullName, referralCode)
      console.error('[verify form] validation failed:', errors)
    },
  )

  const onResend = async () => {
    const res = await sendOtp.mutateAsync({ phone })
    onResent(res.expiresAt)
  }

  return (
    <>
      <span className="eyebrow">Código</span>
      <h1 className="display mt-3 text-5xl font-semibold leading-[1] tracking-[-0.02em]">
        Revisá tu WhatsApp
      </h1>
      <p className="mt-3 text-base text-ink-soft">
        Mandamos un código a{' '}
        <span className="nums font-medium text-ink">{phone}</span>.
      </p>
      <button
        type="button"
        onClick={onBack}
        className="mt-2 text-[0.72rem] uppercase tracking-[0.18em] text-ink-muted hover:text-ink"
      >
        ← Usar otro número
      </button>

      {referralCode ? <ReferralBadge code={referralCode} /> : null}

      <form onSubmit={onSubmit} className="mt-10 flex flex-col gap-6">
        <div>
          <Label htmlFor="code">Código (6 dígitos)</Label>
          <Input
            id="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="000000"
            className="text-center nums text-2xl tracking-[0.4em]"
            {...form.register('code')}
          />
          <FieldError message={form.formState.errors.code?.message} />
        </div>
        {needsName && (
          <div>
            <p className="mb-2 border-l-2 border-accent pl-3 text-sm font-medium text-ink">
              Primer ingreso detectado — dinos cómo te llamas para crear tu
              cuenta.
            </p>
            <Label htmlFor="fullName">Tu nombre</Label>
            <Input
              id="fullName"
              type="text"
              autoComplete="name"
              placeholder="Juan Pérez"
              {...form.register('fullName')}
            />
            <FieldError message={form.formState.errors.fullName?.message} />
          </div>
        )}
        {verifyOtp.isError && !isFirstLoginError(verifyOtp.error) && (
          <p className="border-l-2 border-bad pl-3 text-sm font-medium text-bad">
            {serverMessage(verifyOtp.error, 'Código inválido')}
          </p>
        )}
        <Button type="submit" size="lg" disabled={verifyOtp.isPending}>
          {verifyOtp.isPending ? 'Verificando…' : 'Verificar →'}
        </Button>
        <button
          type="button"
          onClick={onResend}
          disabled={secondsLeft > 0 || sendOtp.isPending}
          className="self-start text-[0.72rem] uppercase tracking-[0.18em] text-ink-muted hover:text-ink disabled:opacity-50"
        >
          {secondsLeft > 0
            ? `Reenviar en ${secondsLeft}s`
            : sendOtp.isPending
              ? 'Reenviando…'
              : 'Reenviar código'}
        </button>
      </form>
    </>
  )
}

function computeSecondsLeft(expiresAt: string | null): number {
  if (!expiresAt) return 0
  // Backend expires codes 5min after creation; cooldown is 30s from creation.
  const expires = new Date(expiresAt).getTime()
  if (Number.isNaN(expires)) return 0
  const createdAt = expires - 5 * 60 * 1000
  const cooldownUntil = createdAt + 30 * 1000
  const diff = Math.ceil((cooldownUntil - Date.now()) / 1000)
  return diff > 0 ? diff : 0
}
