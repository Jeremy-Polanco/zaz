import { useEffect, useRef, useState } from 'react'
import { View, Text, TextInput, ScrollView, Pressable, Linking } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { SafeAreaView } from 'react-native-safe-area-context'
import {
  sendOtpSchema,
  verifyOtpSchema,
  type SendOtpInput,
  type VerifyOtpInput,
} from '../../lib/schemas'
import { useSendOtp, useVerifyOtp } from '../../lib/queries'
import type { UserRole } from '../../lib/types'
import { Button, Eyebrow, FieldLabel, FieldError, DashGoMark, BoltIcon } from '../../components/ui'
import {
  extractWhatsAppErrorCode,
  SUPPORT_PHONE,
  WHATSAPP_ERROR_CODES,
  type WhatsAppErrorCode,
} from '../../lib/whatsapp-error-codes'

// FIX MOBILE-G1 — graceful Twilio / WhatsApp failure UX.
//
// When the backend's POST /auth/otp/send raises ServiceUnavailableException
// with { code: 'WHATSAPP_SEND_FAILED' } (Meta down, rate-limited, user has
// no WhatsApp), we must NOT leave the user with a generic toast. Instead:
//   1. Show a Spanish guidance message + retry button + support links.
//   2. Enforce a 5s client-side cooldown on retry so taps don't hammer Twilio.
//   3. Escalate the copy after 3 consecutive failures so the user knows the
//      outage is real and is steered toward support instead of retrying.
//
// The retry-cooldown ref is intentionally outside form state — it must not
// trigger renders on every tick.
export const WHATSAPP_RETRY_COOLDOWN_SECONDS = 5
export const WHATSAPP_FAILURE_ESCALATION_THRESHOLD = 3
export const SUPPORT_EMAIL = 'support@dashgo.dev'

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

/**
 * Pattern-match a Twilio / WhatsApp delivery failure on the client side.
 *
 * FIX HIGH-G7 — the backend now emits FOUR distinct codes (rate-limited,
 * invalid recipient, not-reachable, generic). For the failure-block visibility
 * decision we treat all four as "this is a WhatsApp failure"; the inner UI
 * then switches on the specific code to pick copy + CTAs.
 *
 * Falls back to "any 503 from /auth/otp/send" because Twilio is the only
 * outbound dependency of that endpoint — a bare 503 with no body is almost
 * certainly Twilio.
 */
export function isWhatsAppSendFailure(err: unknown): boolean {
  return extractWhatsAppErrorCode(err) !== null
}

/**
 * Per-code Spanish copy + CTA matrix. Centralized so the WhatsAppFailureBlock
 * stays mostly presentational and we don't fork the component per code.
 *
 *   • allowRetry — whether the "Reintentar" button is rendered at all.
 *     Permanent codes (invalid number, not on WhatsApp) hide it entirely
 *     because no client-side retry can change the outcome.
 *   • showCallSupport — renders a "Llamar a soporte" tel: link instead of
 *     (or alongside) the email link. Used for the not-reachable case where
 *     the user explicitly cannot receive WhatsApp.
 *   • retryCooldownSeconds — only meaningful when allowRetry is true. The
 *     rate-limited code uses a longer cooldown so we don't immediately
 *     bounce off Twilio's 429.
 */
type WhatsAppFailureCopy = {
  eyebrow: string
  message: string
  bullets: string[]
  allowRetry: boolean
  showCallSupport: boolean
  retryCooldownSeconds: number
}

export const WHATSAPP_RATE_LIMITED_COOLDOWN_SECONDS = 30

const WHATSAPP_FAILURE_COPY: Record<WhatsAppErrorCode, WhatsAppFailureCopy> = {
  [WHATSAPP_ERROR_CODES.WHATSAPP_SEND_FAILED]: {
    eyebrow: 'WhatsApp no disponible',
    message:
      'No pudimos enviarte el código por WhatsApp ahora mismo. Por favor:',
    bullets: [
      'Verificá que tenés WhatsApp instalado',
      'Probá de nuevo en unos minutos',
    ],
    allowRetry: true,
    showCallSupport: false,
    retryCooldownSeconds: 5,
  },
  [WHATSAPP_ERROR_CODES.WHATSAPP_RATE_LIMITED]: {
    eyebrow: 'Mucho tráfico',
    message: 'Hay alto tráfico ahora. Probá en 30 segundos.',
    bullets: [],
    allowRetry: true,
    showCallSupport: false,
    retryCooldownSeconds: WHATSAPP_RATE_LIMITED_COOLDOWN_SECONDS,
  },
  [WHATSAPP_ERROR_CODES.WHATSAPP_RECIPIENT_INVALID]: {
    eyebrow: 'Número inválido',
    message: 'El número no parece válido. Revisalo y probá de nuevo.',
    bullets: [],
    // No retry button — the user must edit the phone field and submit again.
    // Re-pinging Twilio with the same bad number will just fail identically.
    allowRetry: false,
    showCallSupport: false,
    retryCooldownSeconds: 0,
  },
  [WHATSAPP_ERROR_CODES.WHATSAPP_RECIPIENT_NOT_REACHABLE]: {
    eyebrow: 'Sin WhatsApp',
    message: 'No detectamos WhatsApp en este número. ¿Querés que te llamemos?',
    bullets: [],
    // Hard "no" on retry — the recipient does not have WhatsApp. The
    // actionable path is a voice call to support.
    allowRetry: false,
    showCallSupport: true,
    retryCooldownSeconds: 0,
  },
}

const ESCALATED_COPY: WhatsAppFailureCopy = {
  eyebrow: 'WhatsApp no disponible',
  message:
    'Seguimos teniendo problemas para llegar a WhatsApp. Probá de nuevo más tarde o escribinos a soporte.',
  bullets: [],
  allowRetry: true,
  showCallSupport: false,
  retryCooldownSeconds: 5,
}

function computeSecondsLeft(expiresAt: string | null): number {
  if (!expiresAt) return 0
  const expires = new Date(expiresAt).getTime()
  if (Number.isNaN(expires)) return 0
  const createdAt = expires - 5 * 60 * 1000
  const cooldownUntil = createdAt + 30 * 1000
  const diff = Math.ceil((cooldownUntil - Date.now()) / 1000)
  return diff > 0 ? diff : 0
}

export default function LoginScreen() {
  const params = useLocalSearchParams<{ ref?: string }>()
  const referralCode =
    typeof params.ref === 'string' && params.ref.length === 8
      ? params.ref.toUpperCase()
      : undefined
  const [step, setStep] = useState<'phone' | 'code'>('phone')
  const [phone, setPhone] = useState('')
  const [expiresAt, setExpiresAt] = useState<string | null>(null)

  return (
    <SafeAreaView className="flex-1 bg-paper">
      <ScrollView contentContainerClassName="grow" keyboardShouldPersistTaps="handled">
        {/* Poster header */}
        <View className="relative bg-brand px-7 pb-10 pt-12">
          <View className="absolute right-7 top-6">
            <DashGoMark size={22} />
          </View>
          <View className="mt-7 flex-row items-start justify-between">
            <View className="flex-1 pr-4">
              <Text
                className="font-sans-medium text-[11px] uppercase tracking-eyebrow"
                style={{ color: 'rgba(245,228,71,0.9)' }}
              >
                {step === 'phone' ? 'Ingresar · Agua · NY' : 'Código'}
              </Text>
              <View className="mt-3">
                {step === 'phone' ? (
                  <>
                    <Text className="font-sans-semibold text-[44px] leading-[44px] text-paper">
                      Bienvenido
                    </Text>
                    <View className="flex-row items-baseline">
                      <Text className="font-sans-semibold text-[44px] leading-[44px] text-paper">
                        de{' '}
                      </Text>
                      <Text className="font-sans-italic text-[44px] leading-[44px] text-accent">
                        vuelta
                      </Text>
                      <Text className="font-sans-semibold text-[44px] leading-[44px] text-paper">
                        .
                      </Text>
                    </View>
                  </>
                ) : (
                  <>
                    <Text className="font-sans-semibold text-[44px] leading-[44px] text-paper">
                      Mandamos
                    </Text>
                    <View className="flex-row items-baseline">
                      <Text className="font-sans-semibold text-[44px] leading-[44px] text-paper">
                        tu{' '}
                      </Text>
                      <Text className="font-sans-italic text-[44px] leading-[44px] text-accent">
                        código
                      </Text>
                      <Text className="font-sans-semibold text-[44px] leading-[44px] text-paper">
                        .
                      </Text>
                    </View>
                  </>
                )}
              </View>
            </View>
            <Text
              className="font-sans-italic text-[64px] leading-[64px]"
              style={{
                color: 'rgba(245,228,71,0.85)',
                fontVariant: ['tabular-nums'],
              }}
            >
              {step === 'phone' ? '01' : '02'}
            </Text>
          </View>
          <Text
            className="mt-6 text-[14px] leading-[20px]"
            style={{ color: 'rgba(255,255,255,0.7)', maxWidth: 280 }}
          >
            {step === 'phone'
              ? 'Entrega ultrarrápida, directo a tu puerta. Empieza con tu número de teléfono.'
              : `Mandamos un código de 6 dígitos a ${phone || 'tu teléfono'}. Dímelo cuando llegue.`}
          </Text>
        </View>

        {/* Form */}
        <View className="flex-1 bg-paper-deep px-6 pb-8 pt-10">
          {step === 'phone' ? (
            <PhoneStep
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
              referralCode={referralCode}
              onBack={() => setStep('phone')}
              onResent={(exp) => setExpiresAt(exp)}
              onVerified={(role: UserRole) => {
                if (role === 'super_admin_delivery') {
                  router.replace('/(super)')
                } else if (role === 'promoter') {
                  router.replace('/(promoter)')
                } else {
                  router.replace('/(tabs)')
                }
              }}
            />
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

/**
 * FIX HIGH-G7 — graceful WhatsApp-failure block, now code-aware.
 *
 * Driven by the `code` extracted from the most recent /auth/otp/send error:
 *   • WHATSAPP_SEND_FAILED         → generic retry + escalation after 3 fails
 *   • WHATSAPP_RATE_LIMITED        → "alto tráfico" + 30s retry cooldown
 *   • WHATSAPP_RECIPIENT_INVALID   → "número inválido" + NO retry button
 *                                    (the user must edit the phone field)
 *   • WHATSAPP_RECIPIENT_NOT_REACHABLE → "sin WhatsApp" + NO retry + tel:
 *                                        "Llamar a soporte" CTA
 *
 * The per-code policy lives in WHATSAPP_FAILURE_COPY above; this component
 * just renders it. The escalation copy still applies but only to the
 * catch-all WHATSAPP_SEND_FAILED — the other codes don't escalate because
 * the resolution is deterministic (fix number, call us, wait 30s).
 */
function WhatsAppFailureBlock({
  code,
  failureCount,
  onRetry,
  isPending,
}: {
  code: WhatsAppErrorCode
  failureCount: number
  onRetry: () => void
  isPending: boolean
}) {
  const [cooldownLeft, setCooldownLeft] = useState(0)
  const cooldownAnchorRef = useRef<number | null>(null)

  // Escalation only applies to the generic catch-all. Other codes have a
  // single canonical message — escalating them would just confuse the user
  // ("the number is still invalid, sorry"). For the rate-limited code we
  // ALSO keep the original copy because "wait 30s" is already actionable.
  const escalated =
    code === WHATSAPP_ERROR_CODES.WHATSAPP_SEND_FAILED &&
    failureCount >= WHATSAPP_FAILURE_ESCALATION_THRESHOLD
  const copy = escalated ? ESCALATED_COPY : WHATSAPP_FAILURE_COPY[code]
  const retryCooldownSeconds = copy.retryCooldownSeconds

  // Reset the cooldown anchor whenever the code changes — switching from
  // "rate limited" (30s) to "generic" (5s) should restart the clock with
  // the new window, not keep the old one.
  useEffect(() => {
    cooldownAnchorRef.current = null
  }, [code])

  // Start the cooldown clock the moment this block first mounts after a
  // failure. Each new render with the same anchor keeps ticking; once we
  // hit zero we let the user retry. If allowRetry is false we don't even
  // bother running the interval — there's no button to enable.
  useEffect(() => {
    if (!copy.allowRetry) {
      setCooldownLeft(0)
      return
    }
    if (cooldownAnchorRef.current === null) {
      cooldownAnchorRef.current = Date.now() + retryCooldownSeconds * 1000
    }
    const tick = () => {
      const anchor = cooldownAnchorRef.current
      if (anchor === null) {
        setCooldownLeft(0)
        return
      }
      const left = Math.max(0, Math.ceil((anchor - Date.now()) / 1000))
      setCooldownLeft(left)
    }
    tick()
    const id = setInterval(tick, 250)
    return () => clearInterval(id)
  }, [failureCount, copy.allowRetry, retryCooldownSeconds])

  const handleRetry = () => {
    if (cooldownLeft > 0 || isPending) return
    // Reset the cooldown anchor so the NEXT failure (if any) restarts the
    // window from "now", not from the original timestamp.
    cooldownAnchorRef.current = Date.now() + retryCooldownSeconds * 1000
    onRetry()
  }

  const handleSupportEmail = () => {
    Linking.openURL(`mailto:${SUPPORT_EMAIL}`).catch(() => {
      // Silently ignore — there's no useful recovery if mailto fails.
    })
  }

  const handleCallSupport = () => {
    Linking.openURL(`tel:${SUPPORT_PHONE}`).catch(() => {
      // Silently ignore — same rationale as mailto above.
    })
  }

  return (
    <View
      testID="whatsapp-failure-block"
      accessibilityLabel={`whatsapp-failure-${code}`}
      className="mb-6 border-l-2 border-bad bg-bad/10 p-4"
    >
      <Text
        testID="whatsapp-failure-eyebrow"
        className="mb-2 font-sans-medium text-[11px] uppercase tracking-label text-bad"
      >
        {copy.eyebrow}
      </Text>
      <Text
        testID="whatsapp-failure-message"
        className="mb-3 font-sans text-[14px] leading-[20px] text-ink"
      >
        {copy.message}
      </Text>
      {copy.bullets.map((bullet, i) => (
        <Text
          key={i}
          className="mb-1 font-sans text-[13px] leading-[18px] text-ink-soft"
        >
          • {bullet}
        </Text>
      ))}
      {/* Generic catch-all keeps the "escribinos a soporte" hint that the
          old single-code copy used to render. */}
      {!escalated &&
        code === WHATSAPP_ERROR_CODES.WHATSAPP_SEND_FAILED &&
        copy.bullets.length > 0 && (
          <Text className="mb-3 font-sans text-[13px] leading-[18px] text-ink-soft">
            • O escribinos a soporte: {SUPPORT_EMAIL}
          </Text>
        )}

      <View className="mt-2 flex-row items-center gap-3">
        {copy.allowRetry && (
          <Pressable
            testID="whatsapp-failure-retry-btn"
            disabled={cooldownLeft > 0 || isPending}
            onPress={handleRetry}
            className={`border border-ink px-4 py-2 ${
              cooldownLeft > 0 || isPending ? 'opacity-50' : ''
            }`}
          >
            <Text className="font-sans-medium text-[12px] uppercase tracking-label text-ink">
              {isPending
                ? 'Reintentando…'
                : cooldownLeft > 0
                  ? `Reintentar en ${cooldownLeft}s`
                  : 'Reintentar'}
            </Text>
          </Pressable>
        )}
        {copy.showCallSupport && (
          <Pressable
            testID="whatsapp-failure-call-support-btn"
            onPress={handleCallSupport}
            className="border border-ink px-4 py-2"
          >
            <Text className="font-sans-medium text-[12px] uppercase tracking-label text-ink">
              Llamar a soporte
            </Text>
          </Pressable>
        )}
        <Pressable
          testID="whatsapp-failure-support-btn"
          onPress={handleSupportEmail}
          className="px-2 py-2"
        >
          <Text className="font-sans text-[12px] uppercase tracking-label text-ink-muted underline">
            Contactar soporte
          </Text>
        </Pressable>
      </View>
    </View>
  )
}

function PhoneStep({
  onSent,
}: {
  onSent: (phone: string, expiresAt: string) => void
}) {
  const sendOtp = useSendOtp()
  // FIX MOBILE-G1 — count CONSECUTIVE WhatsApp failures (reset on success).
  // Drives both the escalated copy and the "contact support" emphasis.
  const [whatsappFailures, setWhatsappFailures] = useState(0)
  const [lastPhone, setLastPhone] = useState<string | null>(null)
  const { control, handleSubmit, getValues, formState: { errors } } =
    useForm<SendOtpInput>({
      resolver: zodResolver(sendOtpSchema),
      defaultValues: { phone: '' },
    })

  const onSubmit = handleSubmit(async (values) => {
    setLastPhone(values.phone)
    try {
      const res = await sendOtp.mutateAsync(values)
      // Success — clear the failure streak so the next outage starts fresh.
      setWhatsappFailures(0)
      onSent(values.phone, res.expiresAt)
    } catch (err) {
      if (isWhatsAppSendFailure(err)) {
        setWhatsappFailures((n) => n + 1)
      }
      // Other errors fall through to the inline error text below.
    }
  })

  const onRetryWhatsApp = async () => {
    // Re-submit the last entered phone. Use getValues so the user doesn't
    // need to re-type if they navigated away and came back.
    const phone = lastPhone ?? getValues('phone')
    if (!phone) return
    try {
      const res = await sendOtp.mutateAsync({ phone })
      setWhatsappFailures(0)
      onSent(phone, res.expiresAt)
    } catch (err) {
      if (isWhatsAppSendFailure(err)) {
        setWhatsappFailures((n) => n + 1)
      }
    }
  }

  const whatsappFailureCode = sendOtp.isError
    ? extractWhatsAppErrorCode(sendOtp.error)
    : null
  const showWhatsAppFailure = whatsappFailureCode !== null

  return (
    <>
      <Eyebrow className="mb-6">Ingresar</Eyebrow>

      <View className="mb-8">
        <FieldLabel>Teléfono</FieldLabel>
        <Controller
          control={control}
          name="phone"
          render={({ field: { onChange, value } }) => (
            <TextInput
              testID="login-phone-input"
              className="h-11 border-b border-ink/25 pb-1 font-sans text-[18px] text-ink"
              autoCapitalize="none"
              keyboardType="phone-pad"
              autoComplete="tel"
              textContentType="telephoneNumber"
              placeholder="+18091234567"
              placeholderTextColor="#6B6488"
              value={value}
              onChangeText={onChange}
            />
          )}
        />
        <FieldError message={errors.phone?.message} />
      </View>

      {showWhatsAppFailure ? (
        <WhatsAppFailureBlock
          code={whatsappFailureCode}
          failureCount={whatsappFailures}
          onRetry={onRetryWhatsApp}
          isPending={sendOtp.isPending}
        />
      ) : sendOtp.isError ? (
        <Text className="mb-4 font-sans text-[11px] uppercase tracking-label text-bad">
          {serverMessage(sendOtp.error, 'No pudimos mandar el código')}
        </Text>
      ) : null}

      <Button
        testID="login-send-code-btn"
        variant="accent"
        size="lg"
        loading={sendOtp.isPending}
        onPress={onSubmit}
      >
        Enviar código →
      </Button>
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
  onVerified: (role: UserRole) => void
}) {
  const verifyOtp = useVerifyOtp()
  const sendOtp = useSendOtp()
  const [needsName, setNeedsName] = useState(false)
  const {
    control,
    handleSubmit,
    setError,
    setFocus,
    formState: { errors },
  } = useForm<VerifyOtpInput>({
    resolver: zodResolver(verifyOtpSchema),
    defaultValues: { phone, code: '', fullName: undefined, referralCode },
  })

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

  const onSubmit = handleSubmit(async (values) => {
    const trimmedName = values.fullName?.trim()
    if (needsName && !trimmedName) {
      setError('fullName', {
        type: 'required',
        message: 'Poné tu nombre para crear la cuenta',
      })
      setFocus('fullName')
      return
    }
    const payload: VerifyOtpInput = {
      phone: values.phone,
      code: values.code,
      fullName: trimmedName ? trimmedName : undefined,
      referralCode: referralCode ?? undefined,
    }
    try {
      const res = await verifyOtp.mutateAsync(payload)
      onVerified(res.user.role)
    } catch (err) {
      if (isFirstLoginError(err) && !needsName) {
        setNeedsName(true)
        setTimeout(() => setFocus('fullName'), 0)
      }
      // otherwise, let the error banner (via verifyOtp.isError) render
    }
  })

  // FIX MOBILE-G1 — track WhatsApp resend failures so the user sees the
  // graceful failure block on the code step too, not just on the phone step.
  const [whatsappFailures, setWhatsappFailures] = useState(0)
  const onResend = async () => {
    try {
      const res = await sendOtp.mutateAsync({ phone })
      setWhatsappFailures(0)
      onResent(res.expiresAt)
    } catch (err) {
      if (isWhatsAppSendFailure(err)) {
        setWhatsappFailures((n) => n + 1)
      }
    }
  }
  const onRetryWhatsApp = async () => {
    try {
      const res = await sendOtp.mutateAsync({ phone })
      setWhatsappFailures(0)
      onResent(res.expiresAt)
    } catch (err) {
      if (isWhatsAppSendFailure(err)) {
        setWhatsappFailures((n) => n + 1)
      }
    }
  }
  const resendWhatsAppFailureCode = sendOtp.isError
    ? extractWhatsAppErrorCode(sendOtp.error)
    : null
  const showResendWhatsAppFailure = resendWhatsAppFailureCode !== null

  return (
    <>
      <Eyebrow className="mb-3">Código</Eyebrow>
      <Text className="mb-1 font-sans text-[14px] text-ink-soft">
        Mandamos un código a{' '}
        <Text className="font-sans text-ink">{phone}</Text>.
      </Text>
      <Pressable onPress={onBack} className="mb-6">
        <Text className="font-sans text-[11px] uppercase tracking-label text-ink-muted">
          ← Usar otro número
        </Text>
      </Pressable>

      {referralCode ? (
        <View className="mb-6 flex-row items-center gap-2 self-start bg-brand-light px-2.5 py-1.5">
          <BoltIcon size={11} color="#1A1530" />
          <Text className="font-sans-medium text-[11px] uppercase tracking-label text-brand">
            Registrándote con:{' '}
            <Text className="text-brand">{referralCode}</Text>
          </Text>
        </View>
      ) : null}

      <View className="mb-6">
        <FieldLabel>Código (6 dígitos)</FieldLabel>
        <Controller
          control={control}
          name="code"
          render={({ field: { onChange, value } }) => (
            <TextInput
              testID="login-code-input"
              className="h-14 border-b border-ink/25 pb-1 text-center font-sans text-[28px] tracking-[8px] text-ink"
              keyboardType="number-pad"
              autoComplete="sms-otp"
              textContentType="oneTimeCode"
              maxLength={6}
              placeholder="000000"
              placeholderTextColor="#6B6488"
              value={value}
              onChangeText={onChange}
            />
          )}
        />
        <FieldError message={errors.code?.message} />
      </View>

      {needsName && (
        <View className="mb-8">
          <Text className="mb-3 border-l-2 border-accent pl-3 font-sans text-[13px] text-ink">
            Primer ingreso detectado — dinos cómo te llamas para crear tu
            cuenta.
          </Text>
          <FieldLabel>Tu nombre</FieldLabel>
          <Controller
            control={control}
            name="fullName"
            render={({ field: { onChange, onBlur, value, ref } }) => (
              <TextInput
                ref={ref}
                className="h-11 border-b border-ink/25 pb-1 font-sans text-[16px] text-ink"
                autoComplete="name"
                textContentType="name"
                placeholder="Juan Pérez"
                placeholderTextColor="#6B6488"
                value={value ?? ''}
                onChangeText={onChange}
                onBlur={onBlur}
              />
            )}
          />
          <FieldError message={errors.fullName?.message} />
        </View>
      )}

      {verifyOtp.isError && !isFirstLoginError(verifyOtp.error) && (
        <Text className="mb-4 font-sans text-[11px] uppercase tracking-label text-bad">
          {serverMessage(verifyOtp.error, 'Código inválido')}
        </Text>
      )}

      <Button
        testID="login-verify-btn"
        variant="accent"
        size="lg"
        loading={verifyOtp.isPending}
        onPress={onSubmit}
      >
        Verificar →
      </Button>

      <Pressable
        onPress={onResend}
        disabled={secondsLeft > 0 || sendOtp.isPending}
        className={`mt-5 self-start ${secondsLeft > 0 || sendOtp.isPending ? 'opacity-50' : ''}`}
      >
        <Text className="font-sans text-[11px] uppercase tracking-label text-ink-muted">
          {secondsLeft > 0
            ? `Reenviar en ${secondsLeft}s`
            : sendOtp.isPending
              ? 'Reenviando…'
              : 'Reenviar código'}
        </Text>
      </Pressable>

      {showResendWhatsAppFailure && resendWhatsAppFailureCode && (
        <View className="mt-5">
          <WhatsAppFailureBlock
            code={resendWhatsAppFailureCode}
            failureCount={whatsappFailures}
            onRetry={onRetryWhatsApp}
            isPending={sendOtp.isPending}
          />
        </View>
      )}
    </>
  )
}
