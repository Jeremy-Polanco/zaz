import { useCallback, useState } from 'react'
import { ActivityIndicator, Alert, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect, useLocalSearchParams } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import { useTranslation } from 'react-i18next'
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

const SUCCESS_URL = 'dashgo://subscription?success=1'
const CANCEL_URL = 'dashgo://subscription?cancel=1'

/**
 * The subscription perks, in one place (web↔mobile parity — mirrored in
 * dashgo-web/src/routes/subscription.tsx). The free bebedero is a real benefit:
 * the API auto-provisions a $0 order for the product flagged
 * isDefaultSubscriberBebedero when a subscription activates, so we advertise it.
 *
 * i18n: the screen renders t('subscription:perks'); the `es` locale value MUST
 * stay identical to this constant (tests assert both).
 */
export const SUBSCRIPTION_PERKS =
  'Bebedero gratis, envío gratis y mantenimiento sin costo.'

export default function SubscriptionTab() {
  const { t } = useTranslation('subscription')
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
      t('cancelAlert.title'),
      t('cancelAlert.message'),
      [
        { text: t('cancelAlert.no'), style: 'cancel' },
        {
          text: t('cancelAlert.confirm'),
          style: 'destructive',
          onPress: () => cancel.mutate(),
        },
      ],
    )
  }

  if (subPending || planPending) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-paper">
        <ActivityIndicator color="#1A1530" size="small" />
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-paper">
      <ScrollView contentContainerClassName="px-5 pb-8 pt-6">
        <Eyebrow className="mb-3">{t('eyebrow')}</Eyebrow>
        <View className="flex-row flex-wrap items-baseline">
          <Text className="font-sans-semibold text-[40px] leading-[44px] text-ink">
            {t('title.lead')}{' '}
          </Text>
          <Text className="font-sans-italic text-[40px] leading-[44px] text-brand">
            {t('title.accent')}
          </Text>
        </View>
        <Text className="mt-2 text-[15px] text-ink-soft">
          {t('perks')}
        </Text>

        {toastVisible && (
          <View className="mt-4 border border-green-200 bg-green-50 px-4 py-3">
            <Text className="font-sans text-[14px] text-green-800">
              {t('toast.activated', { perks: t('perks') })}
            </Text>
          </View>
        )}

        <Hairline className="my-6" />

        {sub === null || sub === undefined ? (
          /* No subscription */
          <View className="border border-ink/15 bg-paper p-6">
            <Text className="font-sans-semibold text-[26px] text-ink">
              {t('none.pricePerMonth', {
                price: plan ? formatCents(plan.priceCents) : '$10.00',
              })}
            </Text>
            <Text className="mt-2 text-[14px] text-ink-soft">
              {t('none.details', { perks: t('perks') })}
            </Text>
            <View className="mt-5">
              <Button
                onPress={openCheckout}
                disabled={checkout.isPending}
              >
                {checkout.isPending ? t('redirecting') : t('none.subscribe')}
              </Button>
            </View>
          </View>
        ) : sub.status === 'active' && !sub.cancelAtPeriodEnd ? (
          /* Active, auto-renewing */
          <View className="border border-ink/15 bg-paper p-6">
            <View className="mb-3 flex-row">
              <View className="rounded-full bg-green-100 px-3 py-1">
                <Text className="font-sans text-[12px] uppercase tracking-label text-green-700">
                  {t('active.badge')}
                </Text>
              </View>
            </View>
            <Text className="text-[14px] text-ink-soft">
              {t('active.renewsOn', { date: formatDate(sub.currentPeriodEnd) })}
            </Text>
            <View className="mt-5 gap-3">
              <Button onPress={openPortal} disabled={portal.isPending}>
                {portal.isPending ? t('redirecting') : t('managePortal')}
              </Button>
              <Button
                variant="outline"
                onPress={handleCancel}
                disabled={cancel.isPending}
              >
                {cancel.isPending ? t('active.canceling') : t('active.cancel')}
              </Button>
            </View>
          </View>
        ) : sub.status === 'active' && sub.cancelAtPeriodEnd ? (
          /* Active, cancel scheduled */
          <View className="border border-yellow-200 bg-yellow-50 p-6">
            <Text className="font-sans-semibold text-[15px] text-yellow-800">
              {t('cancelPending.title', { date: formatDate(sub.currentPeriodEnd) })}
            </Text>
            <Text className="mt-1 text-[15px] text-yellow-700">
              {t('cancelPending.body')}
            </Text>
            <View className="mt-5 gap-3">
              <Button
                onPress={() => reactivate.mutate()}
                disabled={reactivate.isPending}
              >
                {reactivate.isPending ? t('cancelPending.reactivating') : t('cancelPending.reactivate')}
              </Button>
              <Button variant="outline" onPress={openPortal} disabled={portal.isPending}>
                {t('managePortal')}
              </Button>
            </View>
          </View>
        ) : sub.status === 'past_due' ? (
          /* Past due */
          <View className="border border-red-200 bg-red-50 p-6">
            <Text className="font-sans-semibold text-[15px] text-red-800">
              {t('pastDue.title')}
            </Text>
            <Text className="mt-1 text-[15px] text-red-700">
              {t('pastDue.body')}
            </Text>
            <View className="mt-5">
              <Button onPress={openPortal} disabled={portal.isPending}>
                {portal.isPending ? t('redirecting') : t('managePortal')}
              </Button>
            </View>
          </View>
        ) : sub.status === 'canceled' ? (
          /* Canceled */
          <View className="border border-ink/15 bg-paper p-6">
            <Text className="text-[14px] text-ink-soft">
              {t('canceled.title')}
            </Text>
            <View className="mt-5">
              <Button onPress={openCheckout} disabled={checkout.isPending}>
                {checkout.isPending ? t('redirecting') : t('canceled.resubscribe')}
              </Button>
            </View>
          </View>
        ) : (
          /* incomplete / incomplete_expired / unpaid */
          <View className="border border-ink/15 bg-paper p-6">
            <Text className="text-[14px] text-ink-soft">
              {t('inactive.title')}
            </Text>
            <View className="mt-5">
              <Button variant="outline" onPress={openPortal} disabled={portal.isPending}>
                {portal.isPending ? t('redirecting') : t('managePortal')}
              </Button>
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}
