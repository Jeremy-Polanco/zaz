import { useEffect, useRef, useState } from 'react'
import { View, Text, TextInput, ActivityIndicator, ScrollView } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import {
  useCurrentUser,
  useLogout,
  useShippingRate,
  useUpdateShippingRate,
} from '../../lib/queries'
import { Button, Eyebrow, FieldError, Hairline, DashGoMark } from '../../components/ui'

export default function SuperProfileScreen() {
  const { data: user, isPending } = useCurrentUser()
  const logout = useLogout()

  // ── Tarifa de envío ───────────────────────────────────────────────────────
  const { data: shippingRate } = useShippingRate()
  const updateShippingRate = useUpdateShippingRate()
  const [rateInput, setRateInput] = useState('')
  const [rateInitialized, setRateInitialized] = useState(false)
  const [rateError, setRateError] = useState<string | null>(null)
  // "Tarifa actualizada" es efímero — mismo patrón que "Guardado" en
  // (super)/orders/[orderId].tsx.
  const [justSavedRate, setJustSavedRate] = useState(false)
  const savedRateTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    return () => {
      if (savedRateTimeout.current) clearTimeout(savedRateTimeout.current)
    }
  }, [])
  useEffect(() => {
    if (shippingRate && !rateInitialized) {
      setRateInput((shippingRate.shippingCents / 100).toFixed(2))
      setRateInitialized(true)
    }
  }, [shippingRate, rateInitialized])

  const parsedRateDollars = Number(rateInput)
  const rateFormatValid = /^\d+(\.\d{1,2})?$/.test(rateInput)
  const rateValid =
    rateFormatValid &&
    Number.isFinite(parsedRateDollars) &&
    parsedRateDollars >= 0 &&
    parsedRateDollars <= 100
  const rateCents = rateValid ? Math.round(parsedRateDollars * 100) : 0
  const rateUnchanged = rateValid && shippingRate?.shippingCents === rateCents
  const rateValidationError =
    rateInput === '' || rateValid
      ? undefined
      : 'Ingresá un monto entre $0 y $100.'

  const handleSaveRate = async () => {
    setRateError(null)
    if (!rateValid) return
    try {
      await updateShippingRate.mutateAsync({ shippingCents: rateCents })
      setJustSavedRate(true)
      if (savedRateTimeout.current) clearTimeout(savedRateTimeout.current)
      savedRateTimeout.current = setTimeout(() => setJustSavedRate(false), 2000)
    } catch (e) {
      setRateError(
        (e as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? 'No se pudo actualizar la tarifa.',
      )
    }
  }

  if (isPending) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-paper">
        <ActivityIndicator color="#1A1530" size="small" />
      </SafeAreaView>
    )
  }

  const handleLogout = async () => {
    await logout()
    router.replace('/(auth)/login')
  }

  const initial = user?.fullName?.[0]?.toUpperCase() ?? '·'

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-paper">
      <ScrollView contentContainerClassName="pb-10">
        {/* Branded poster header */}
        <View className="relative bg-brand px-6 pb-8 pt-10">
          <View className="absolute right-6 top-5">
            <DashGoMark size={20} />
          </View>
          <View className="mt-2 flex-row items-center gap-2">
            <View className="h-1.5 w-1.5 bg-accent" />
            <Text
              className="font-sans-medium text-[11px] uppercase tracking-eyebrow"
              style={{ color: 'rgba(245,228,71,0.9)' }}
            >
              Agua · New York · Admin
            </Text>
          </View>
          <View className="mt-5 flex-row items-baseline">
            <Text className="font-sans-italic text-[44px] leading-[44px] text-paper">
              Reparto
            </Text>
            <Text className="font-sans-semibold text-[44px] leading-[44px] text-paper">
              .
            </Text>
          </View>
          <Text
            className="mt-3 text-[15px] leading-[20px]"
            style={{ color: 'rgba(255,255,255,0.7)', maxWidth: 280 }}
          >
            Tu sesión, identidad y atajos del panel.
          </Text>
        </View>

        <View className="px-5">
          {/* Identity block */}
          <View className="mt-6 flex-row items-center gap-5">
            <View className="h-16 w-16 items-center justify-center bg-ink">
              <Text className="font-sans-semibold text-3xl text-paper">{initial}</Text>
            </View>
            <View className="flex-1">
              <Text className="font-sans-semibold text-[22px] leading-[26px] text-ink">
                {user?.fullName ?? '—'}
              </Text>
              <Text className="mt-0.5 text-[15px] text-ink-soft">
                {user?.phone ?? ''}
              </Text>
            </View>
          </View>

          <View className="mt-8">
            <Eyebrow>Rol</Eyebrow>
            <Text className="mt-1.5 font-sans-semibold text-[18px] text-ink">
              Super Admin · Reparto
            </Text>
          </View>

          {user?.phone && (
            <View className="mt-6">
              <Eyebrow>Teléfono</Eyebrow>
              <Text
                className="mt-1.5 font-sans-medium text-[16px] text-ink"
                style={{ fontVariant: ['tabular-nums'] }}
              >
                {user.phone}
              </Text>
            </View>
          )}

          {user?.addressDefault?.text && (
            <View className="mt-6">
              <Eyebrow>Origen de reparto</Eyebrow>
              <Text className="mt-1.5 text-[15px] leading-[22px] text-ink">
                {user.addressDefault.text}
              </Text>
              <Text className="mt-1 font-sans text-[11px] uppercase tracking-label text-ink-muted">
                Punto desde el que se calcula el shipping
              </Text>
            </View>
          )}

          <View className="mt-6">
            <View className="flex-row items-baseline justify-between">
              <Eyebrow>Tarifa de envío</Eyebrow>
              {justSavedRate && (
                <Text className="font-sans text-[11px] uppercase tracking-label text-ok">
                  Tarifa actualizada
                </Text>
              )}
            </View>
            <Text className="mt-1.5 font-sans-semibold text-[18px] text-ink">
              {shippingRate
                ? `$${(shippingRate.shippingCents / 100).toFixed(2)} por pedido`
                : '—'}
            </Text>
            <View className="mt-3 flex-row items-center gap-3">
              <TextInput
                className="h-12 flex-1 border-b border-ink/25 pb-1 font-sans text-[18px] text-ink"
                keyboardType="decimal-pad"
                placeholder="5.00"
                placeholderTextColor="#6B6488"
                value={rateInput}
                onChangeText={(t) => {
                  setRateInput(t)
                  setRateError(null)
                  setJustSavedRate(false)
                }}
              />
              <Button
                variant="outline"
                onPress={handleSaveRate}
                loading={updateShippingRate.isPending}
                disabled={!rateValid || rateUnchanged}
              >
                Guardar tarifa
              </Button>
            </View>
            <FieldError message={rateValidationError} />
            {rateError && (
              <Text className="mt-1.5 font-sans text-[13px] text-bad">
                {rateError}
              </Text>
            )}
            <Text className="mt-2 font-sans text-[12px] text-ink-muted">
              Se aplica a todos los pedidos nuevos, suscriptores incluidos.
              Los pedidos ya creados no cambian.
            </Text>
          </View>

          <Hairline className="mt-10" />

          <View className="mt-8">
            <Button variant="outline" size="lg" onPress={handleLogout}>
              Cerrar sesión →
            </Button>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}
