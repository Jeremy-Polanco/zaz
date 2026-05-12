import { useCallback, useState } from 'react'
import { ActivityIndicator, Alert, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect, useLocalSearchParams } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import {
  useMySubscription,
  useSubscriptionPlan,
  useCreateCheckoutSession,
  useCreatePortalSession,
  useCancelSubscription,
  useReactivateSubscription,
} from '../../lib/queries'
import { formatCents, formatDate } from '../../lib/format'
import { Button, Eyebrow, Hairline } from '../../components/ui'

const SUCCESS_URL = 'zaz://subscription?success=1'
const CANCEL_URL = 'zaz://subscription?cancel=1'

export default function SubscriptionTab() {
  const params = useLocalSearchParams<{ success?: string; cancel?: string }>()
  const { data: sub, isPending: subPending, refetch } = useMySubscription()
  const { data: plan, isPending: planPending } = useSubscriptionPlan()
  const checkout = useCreateCheckoutSession()
  const portal = useCreatePortalSession()
  const cancel = useCancelSubscription()
  const reactivate = useReactivateSubscription()
  const [toastVisible, setToastVisible] = useState(false)

  // Refetch on screen focus; show toast on success deep-link return
  useFocusEffect(
    useCallback(() => {
      void refetch()
      if (params.success === '1') {
        setToastVisible(true)
        setTimeout(() => setToastVisible(false), 3000)
      }
    }, [refetch, params.success]),
  )

  const openCheckout = async () => {
    const result = await checkout.mutateAsync({
      successUrl: SUCCESS_URL,
      cancelUrl: CANCEL_URL,
    })
    if (result?.url) {
      await WebBrowser.openAuthSessionAsync(result.url, SUCCESS_URL)
      void refetch()
    }
  }

  const openPortal = async () => {
    const result = await portal.mutateAsync()
    if (result?.url) {
      await WebBrowser.openAuthSessionAsync(result.url, SUCCESS_URL)
      void refetch()
    }
  }

  const handleCancel = async () => {
    Alert.alert(
      'Cancelar suscripción',
      'Tu suscripción seguirá activa hasta el final del período. ¿Quieres cancelar?',
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Sí, cancelar',
          style: 'destructive',
          onPress: () => cancel.mutate(),
        },
      ],
    )
  }

  if (subPending || planPending) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-paper">
        <ActivityIndicator color="#220247" size="small" />
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-paper">
      <ScrollView contentContainerClassName="px-5 pb-8 pt-6">
        <Eyebrow className="mb-3">Mi plan</Eyebrow>
        <View className="flex-row flex-wrap items-baseline">
          <Text className="font-sans-semibold text-[40px] leading-[44px] text-ink">
            Mi{' '}
          </Text>
          <Text className="font-sans-italic text-[40px] leading-[44px] text-brand">
            suscripción.
          </Text>
        </View>
        <Text className="mt-2 text-[13px] text-ink-soft">
          Tu suscripción cubre el alquiler del dispensador.
        </Text>

        {toastVisible && (
          <View className="mt-4 border border-green-200 bg-green-50 px-4 py-3">
            <Text className="font-sans text-[12px] text-green-800">
              ¡Suscripción activada! Tu dispensador ya está en camino.
            </Text>
          </View>
        )}

        <Hairline className="my-6" />

        {sub === null || sub === undefined ? (
          /* No subscription */
          <View className="border border-ink/15 bg-paper p-6">
            <Text className="font-sans-semibold text-[26px] text-ink">
              {plan ? formatCents(plan.priceCents) : '$10.00'} / mes
            </Text>
            <Text className="mt-2 text-[14px] text-ink-soft">
              Alquiler del dispensador incluido. Cancela cuando quieras.
            </Text>
            <View className="mt-5">
              <Button
                onPress={openCheckout}
                disabled={checkout.isPending}
              >
                {checkout.isPending ? 'Redirigiendo…' : 'Suscribirme'}
              </Button>
            </View>
          </View>
        ) : sub.status === 'active' && !sub.cancelAtPeriodEnd ? (
          /* Active, auto-renewing */
          <View className="border border-ink/15 bg-paper p-6">
            <View className="mb-3 flex-row">
              <View className="rounded-full bg-green-100 px-3 py-1">
                <Text className="font-sans text-[10px] uppercase tracking-label text-green-700">
                  Activa
                </Text>
              </View>
            </View>
            <Text className="text-[14px] text-ink-soft">
              Suscripto al plan · Renueva el {formatDate(sub.currentPeriodEnd)}
            </Text>
            <View className="mt-5 gap-3">
              <Button onPress={openPortal} disabled={portal.isPending}>
                {portal.isPending ? 'Redirigiendo…' : 'Gestionar suscripción'}
              </Button>
              <Button
                variant="outline"
                onPress={handleCancel}
                disabled={cancel.isPending}
              >
                {cancel.isPending ? 'Cancelando…' : 'Cancelar'}
              </Button>
            </View>
          </View>
        ) : sub.status === 'active' && sub.cancelAtPeriodEnd ? (
          /* Active, cancel scheduled */
          <View className="border border-yellow-200 bg-yellow-50 p-6">
            <Text className="font-sans-semibold text-[15px] text-yellow-800">
              Activo hasta {formatDate(sub.currentPeriodEnd)}, no se renovará.
            </Text>
            <Text className="mt-1 text-[13px] text-yellow-700">
              El dispensador continúa activo hasta esa fecha.
            </Text>
            <View className="mt-5 gap-3">
              <Button
                onPress={() => reactivate.mutate()}
                disabled={reactivate.isPending}
              >
                {reactivate.isPending ? 'Reactivando…' : 'Reactivar'}
              </Button>
              <Button variant="outline" onPress={openPortal} disabled={portal.isPending}>
                Gestionar suscripción
              </Button>
            </View>
          </View>
        ) : sub.status === 'past_due' ? (
          /* Past due */
          <View className="border border-red-200 bg-red-50 p-6">
            <Text className="font-sans-semibold text-[15px] text-red-800">
              Tu pago está pendiente.
            </Text>
            <Text className="mt-1 text-[13px] text-red-700">
              Actualizá tu medio de pago para mantener el dispensador activo.
            </Text>
            <View className="mt-5">
              <Button onPress={openPortal} disabled={portal.isPending}>
                {portal.isPending ? 'Redirigiendo…' : 'Gestionar suscripción'}
              </Button>
            </View>
          </View>
        ) : sub.status === 'canceled' ? (
          /* Canceled */
          <View className="border border-ink/15 bg-paper p-6">
            <Text className="text-[14px] text-ink-soft">
              Tu suscripción terminó.
            </Text>
            <View className="mt-5">
              <Button onPress={openCheckout} disabled={checkout.isPending}>
                {checkout.isPending ? 'Redirigiendo…' : 'Suscribirme de nuevo'}
              </Button>
            </View>
          </View>
        ) : (
          /* incomplete / incomplete_expired / unpaid */
          <View className="border border-ink/15 bg-paper p-6">
            <Text className="text-[14px] text-ink-soft">
              Tu suscripción no está activa.
            </Text>
            <View className="mt-5">
              <Button variant="outline" onPress={openPortal} disabled={portal.isPending}>
                {portal.isPending ? 'Redirigiendo…' : 'Gestionar suscripción'}
              </Button>
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}
