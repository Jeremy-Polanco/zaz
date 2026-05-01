import { useEffect, useState } from 'react'
import { createFileRoute, useSearch } from '@tanstack/react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  sendOtpSchema,
  verifyOtpSchema,
  type SendOtpInput,
  type VerifyOtpInput,
} from '../lib/schemas'
import { useSendOtp, useVerifyOtp } from '../lib/auth'
import { Button, FieldError, Input, Label } from '../components/ui'

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

function isFirstLoginError(err: unknown): boolean {
  const msg = (err as Error & { response?: { data?: { message?: string } } })
    ?.response?.data?.message
  return typeof msg === 'string' && msg.toLowerCase().includes('primer ingreso')
}

function LoginPage() {
  const { next, ref } = useSearch({ from: '/login' })
  const [step, setStep] = useState<'phone' | 'code'>('phone')
  const [phone, setPhone] = useState('')
  const [expiresAt, setExpiresAt] = useState<string | null>(null)

  return (
    <div className="grid min-h-[calc(100vh-10rem)] grid-cols-1 md:grid-cols-2">
      {/* left — poster */}
      <div className="relative hidden overflow-hidden border-r border-ink/15 bg-ink p-10 text-paper md:flex md:flex-col md:justify-between">
        <div className="flex items-center justify-between">
          <span className="text-[0.7rem] uppercase tracking-[0.24em] text-paper/70">
            Zaz / Entrar
          </span>
          <span className="text-[0.7rem] uppercase tracking-[0.24em] text-brand">
            NYC
          </span>
        </div>

        <div>
          <p className="text-[0.7rem] uppercase tracking-[0.24em] text-paper/60">
            Edición diaria
          </p>
          <h2 className="display mt-3 text-6xl font-semibold leading-[0.95] tracking-[-0.02em]">
            Bienvenido
            <br />
            <span className="italic text-brand">de vuelta.</span>
          </h2>
          <p className="mt-6 max-w-md text-base leading-relaxed text-paper/80">
            Tu colmado ya te espera. Entra con tu teléfono — te mandamos un
            código por SMS.
          </p>
        </div>

        <div className="flex items-end justify-between">
          <span className="text-[0.7rem] uppercase tracking-[0.24em] text-paper/60">
            Vol. 01 / Login
          </span>
          <span className="display text-9xl font-bold leading-none text-brand">
            01
          </span>
        </div>
      </div>

      {/* right — form */}
      <div className="page-rise flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-md">
          {step === 'phone' ? (
            <PhoneStep
              next={next}
              onSent={(p, exp) => {
                setPhone(p)
                setExpiresAt(exp)
                setStep('code')
              }}
            />
          ) : (
            <CodeStep
              phone={phone}
              expiresAt={expiresAt}
              referralCode={ref}
              onBack={() => setStep('phone')}
              onResent={(exp) => setExpiresAt(exp)}
              onVerified={(role) => {
                const dest =
                  next ??
                  (role === 'super_admin_delivery'
                    ? '/super/orders'
                    : role === 'promoter'
                      ? '/promoter'
                      : '/catalog')
                window.location.assign(dest)
              }}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function PhoneStep({
  next: _next,
  onSent,
}: {
  next: string | undefined
  onSent: (phone: string, expiresAt: string) => void
}) {
  const sendOtp = useSendOtp()
  const form = useForm<SendOtpInput>({
    resolver: zodResolver(sendOtpSchema),
    defaultValues: { phone: '' },
  })

  const onSubmit = form.handleSubmit(async (values) => {
    const res = await sendOtp.mutateAsync(values)
    onSent(values.phone, res.expiresAt)
  })

  return (
    <>
      <span className="eyebrow">Entrar</span>
      <h1 className="display mt-3 text-5xl font-semibold leading-[1] tracking-[-0.02em]">
        Iniciar sesión
      </h1>
      <p className="mt-3 text-base text-ink-soft">
        Poné tu teléfono y te mandamos un código por SMS.
      </p>

      <form onSubmit={onSubmit} className="mt-10 flex flex-col gap-6">
        <div>
          <Label htmlFor="phone">Teléfono</Label>
          <Input
            id="phone"
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            placeholder="+18091234567"
            className="text-lg"
            {...form.register('phone')}
          />
          <FieldError message={form.formState.errors.phone?.message} />
        </div>
        {sendOtp.isError && (
          <p className="border-l-2 border-bad pl-3 text-sm font-medium text-bad">
            {serverMessage(sendOtp.error, 'No pudimos mandar el código')}
          </p>
        )}
        <Button type="submit" size="lg" disabled={sendOtp.isPending}>
          {sendOtp.isPending ? 'Enviando…' : 'Enviar código →'}
        </Button>
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
        referralCode: referralCode ?? values.referralCode ?? undefined,
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
        Revisá tu SMS
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

      {referralCode ? (
        <div className="mt-6 inline-flex items-center gap-2 border border-accent/30 bg-accent/10 px-3 py-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          <span className="text-[0.7rem] uppercase tracking-[0.2em] text-accent-dark">
            Registrándote con código:{' '}
            <span className="text-brand">{referralCode}</span>
          </span>
        </div>
      ) : null}

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
