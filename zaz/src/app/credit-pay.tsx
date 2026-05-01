import { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { useStripe } from '@stripe/stripe-react-native'
import { useQueryClient } from '@tanstack/react-query'
import {
  useCreateCreditPaymentIntent,
  useCurrentUser,
  useMyCredit,
} from '../lib/queries'
import { formatCents, formatDate } from '../lib/format'
import { Button, Eyebrow, Hairline } from '../components/ui'

export default function CreditPayScreen() {
  const qc = useQueryClient()
  const { data: user } = useCurrentUser()
  const { data: credit, isPending } = useMyCredit()
  const createIntent = useCreateCreditPaymentIntent()
  const { initPaymentSheet, presentPaymentSheet } = useStripe()

  const [paying, setPaying] = useState(false)
  const [done, setDone] = useState(false)
  const amountOwedCents = credit?.amountOwedCents ?? 0
  const locked = !!user?.creditLocked

  useEffect(() => {
    if (done) {
      const t = setTimeout(() => {
        router.replace('/(tabs)/credit')
      }, 1500)
      return () => clearTimeout(t)
    }
  }, [done])

  const onPay = async () => {
    if (amountOwedCents <= 0) return
    setPaying(true)
    try {
      const intent = await createIntent.mutateAsync()
      const initResult = await initPaymentSheet({
        merchantDisplayName: 'Zaz',
        paymentIntentClientSecret: intent.clientSecret,
        allowsDelayedPaymentMethods: false,
        returnURL: 'zaz://stripe-redirect',
        defaultBillingDetails: user?.fullName ? { name: user.fullName } : undefined,
      })
      if (initResult.error) {
        setPaying(false)
        Alert.alert('Error', initResult.error.message)
        return
      }
      const sheetResult = await presentPaymentSheet()
      setPaying(false)
      if (sheetResult.error) {
        if (sheetResult.error.code !== 'Canceled') {
          Alert.alert('Error', sheetResult.error.message)
        }
        return
      }
      qc.invalidateQueries({ queryKey: ['credit', 'me'] })
      qc.invalidateQueries({ queryKey: ['auth', 'me'] })
      setDone(true)
    } catch (e) {
      setPaying(false)
      Alert.alert(
        'Error',
        (e as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? 'No pudimos iniciar el pago',
      )
    }
  }

  if (isPending) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-paper">
        <ActivityIndicator color="#220247" size="small" />
      </SafeAreaView>
    )
  }

  if (amountOwedCents <= 0 && !done) {
    return (
      <SafeAreaView edges={['top']} className="flex-1 bg-paper">
        <View className="flex-1 items-center justify-center px-6">
          <Eyebrow>Sin saldo pendiente</Eyebrow>
          <Text className="mt-4 text-center font-sans-semibold text-[28px] leading-[34px] text-ink">
            No tienes deuda{'\n'}para pagar.
          </Text>
          <Text className="mt-3 text-center text-[14px] text-ink-soft">
            Tu cuenta de crédito está al día.
          </Text>
          <View className="mt-8 w-full max-w-[260px]">
            <Button variant="ink" size="lg" onPress={() => router.replace('/(tabs)/credit')}>
              Volver al crédito →
            </Button>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-paper">
      <ScrollView contentContainerClassName="px-5 pt-6 pb-8">
        <Eyebrow className="mb-3">Pago de crédito</Eyebrow>
        <View className="flex-row flex-wrap items-baseline">
          <Text className="font-sans-semibold text-[40px] leading-[44px] text-ink">
            Saldar mi{' '}
          </Text>
          <Text className="font-sans-italic text-[40px] leading-[44px] text-brand">
            deuda.
          </Text>
        </View>
        <Text className="mt-2 text-[13px] text-ink-soft">
          Paga tu balance pendiente con tarjeta. Una vez confirmado, tu crédito se libera al instante.
        </Text>

        {locked && (
          <View className="mt-6 border border-red-200 bg-red-50 px-4 py-3">
            <Text className="font-sans text-[10px] uppercase tracking-label text-red-700">
              Cuenta bloqueada
            </Text>
            <Text className="mt-1 font-sans text-[13px] text-red-700">
              Tu cuenta está vencida. Salda tu deuda para volver a usar la app.
            </Text>
          </View>
        )}

        <Hairline className="my-8" />

        <View className="border border-ink/15 bg-paper p-5">
          <Text className="font-sans text-[10px] uppercase tracking-label text-ink-muted">
            Monto a pagar
          </Text>
          <Text
            className="mt-2 font-sans-semibold text-[40px] leading-[44px] text-ink"
            style={{ fontVariant: ['tabular-nums'] }}
          >
            {formatCents(amountOwedCents)}
          </Text>
          {credit?.dueDate ? (
            <Text className="mt-2 font-sans text-[12px] text-ink-soft">
              Vencimiento: {formatDate(credit.dueDate)}
            </Text>
          ) : null}
        </View>

        {done ? (
          <View className="mt-8 border border-green-300 bg-green-50 px-4 py-4">
            <Text className="font-sans text-[10px] uppercase tracking-label text-green-700">
              Pago recibido
            </Text>
            <Text className="mt-1 font-sans-semibold text-[16px] text-green-800">
              Gracias. Te llevamos al crédito…
            </Text>
          </View>
        ) : (
          <View className="mt-8">
            <Button
              variant="accent"
              size="lg"
              loading={paying || createIntent.isPending}
              onPress={onPay}
            >
              Pagar {formatCents(amountOwedCents)} →
            </Button>
            <Text className="mt-3 text-center font-sans text-[11px] text-ink-muted">
              Procesado por Stripe. Tus datos no se guardan en nuestros servidores.
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}
