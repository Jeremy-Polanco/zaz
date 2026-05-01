import { useEffect, useState } from 'react'
import { View, Text, TextInput, ScrollView, Pressable } from 'react-native'
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
import { Button, Eyebrow, FieldLabel, FieldError, ZazMark, BoltIcon } from '../../components/ui'

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
            <ZazMark size={22} />
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

function PhoneStep({
  onSent,
}: {
  onSent: (phone: string, expiresAt: string) => void
}) {
  const sendOtp = useSendOtp()
  const { control, handleSubmit, formState: { errors } } = useForm<SendOtpInput>({
    resolver: zodResolver(sendOtpSchema),
    defaultValues: { phone: '' },
  })

  const onSubmit = handleSubmit(async (values) => {
    try {
      const res = await sendOtp.mutateAsync(values)
      onSent(values.phone, res.expiresAt)
    } catch {}
  })

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

      {sendOtp.isError && (
        <Text className="mb-4 font-sans text-[11px] uppercase tracking-label text-bad">
          {serverMessage(sendOtp.error, 'No pudimos mandar el código')}
        </Text>
      )}

      <Button
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

  const onResend = async () => {
    try {
      const res = await sendOtp.mutateAsync({ phone })
      onResent(res.expiresAt)
    } catch {}
  }

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
          <BoltIcon size={11} color="#220247" />
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
    </>
  )
}
