import { useState } from 'react'
import { View, Text, ScrollView, Alert } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { useStripe } from '@stripe/stripe-react-native'
import { api } from '../../../lib/api'
import {
  useAuthorizeOrder,
  useConfirmCashOrder,
  useConfirmNonStripeOrder,
} from '../../../lib/queries'
import type { Order } from '../../../lib/types'
import { formatCents } from '../../../lib/format'
import { BreakdownRow, Button, Eyebrow, Hairline, StatusStepper } from '../../../components/ui'
import { SuscriptorBadge } from '../../../components/SuscriptorBadge'
import { ScreenHeader } from '../../../components/ScreenHeader'

const LIVE_STATUSES = [
  'pending_quote',
  'quoted',
  'pending_validation',
  'confirmed_by_colmado',
  'in_delivery_route',
] as const

function useOrder(orderId: string | undefined) {
  return useQuery<Order>({
    queryKey: ['order', orderId],
    queryFn: async () => (await api.get<Order>(`/orders/${orderId}`)).data,
    enabled: !!orderId,
    refetchInterval: (q) => {
      const status = q.state.data?.status
      if (!status) return 10_000
      return (LIVE_STATUSES as readonly string[]).includes(status)
        ? 10_000
        : false
    },
    retry: false,
  })
}

function StatusLabel({
  status,
  paymentMethod,
}: {
  status: Order['status']
  paymentMethod?: Order['paymentMethod']
}) {
  const { t } = useTranslation('orders')
  const label =
    status === 'pending_quote'
      ? t('status.pendingQuote')
      : status === 'quoted'
        ? // Customer-facing: a quoted order just needs payment/confirmation —
          // skip the internal "Cotizado" wording.
          paymentMethod === 'digital'
          ? t('status.toPay')
          : t('status.toConfirm')
        : status === 'pending_validation'
          ? t('status.pending')
          : status === 'confirmed_by_colmado'
            ? t('status.confirmed')
            : status === 'in_delivery_route'
              ? t('status.inRoute')
              : status === 'delivered'
                ? t('status.delivered')
                : t('status.cancelled')
  return (
    <View className="self-start border border-ink/20 bg-paper-deep/40 px-3 py-1">
      <Text className="font-sans text-[11px] uppercase tracking-label text-ink">
        {label}
      </Text>
    </View>
  )
}

export default function OrderDetailScreen() {
  const { t } = useTranslation('orders')
  const { orderId, paid } = useLocalSearchParams<{
    orderId: string
    paid?: string
  }>()
  const { data: order, isPending, error } = useOrder(orderId)
  const confirmCash = useConfirmCashOrder()
  const confirmNonStripe = useConfirmNonStripeOrder()
  const authorize = useAuthorizeOrder()
  const { initPaymentSheet, presentPaymentSheet } = useStripe()
  const [paying, setPaying] = useState(false)
  // Bridges the gap between a successful card authorization and the webhook
  // setting authorizedAt. Set by checkout (paid=1 param after a successful
  // PaymentSheet) and by the on-screen "Pagar" button below.
  const [justPaid, setJustPaid] = useState(paid === '1')

  if (isPending) {
    return (
      <SafeAreaView className="flex-1 bg-paper">
        <View className="flex-1 items-center justify-center">
          <Text className="font-sans text-[13px] uppercase tracking-label text-ink-muted">
            {t('detail.loading')}
          </Text>
        </View>
      </SafeAreaView>
    )
  }
  if (error || !order) {
    return (
      <SafeAreaView className="flex-1 bg-paper">
        <View className="flex-1 items-center justify-center px-6">
          <Text className="font-sans text-[14px] text-bad">
            {t('detail.loadError')}
          </Text>
          <Button
            variant="outline"
            size="md"
            onPress={() => router.replace('/(tabs)/orders')}
            className="mt-4"
          >
            {t('detail.viewMyOrders')}
          </Button>
        </View>
      </SafeAreaView>
    )
  }

  const subtotalCents = Math.round(parseFloat(order.subtotal) * 100)
  const shippingCents = Math.round(parseFloat(order.shipping) * 100)
  const taxCents = Math.round(parseFloat(order.tax) * 100)
  const tipCents = Math.round(parseFloat(order.tip ?? '0') * 100)
  const pointsCents = Math.round(parseFloat(order.pointsRedeemed) * 100)
  const totalCents = Math.round(parseFloat(order.totalAmount) * 100)
  const creditAppliedCents = Math.round(
    parseFloat(order.creditApplied ?? '0') * 100,
  )
  // CRIT-2: full-credit digital orders must skip Stripe and go through
  // /confirm-non-stripe instead. Use >= to absorb any rounding.
  const isFullCredit =
    creditAppliedCents > 0 && creditAppliedCents >= totalCents
  const stripeAmountCents = Math.max(0, totalCents - creditAppliedCents)

  const onConfirmCash = async () => {
    try {
      await confirmCash.mutateAsync(order.id)
    } catch (e) {
      Alert.alert(
        t('alerts.errorTitle'),
        (e as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? t('alerts.confirmFailed'),
      )
    }
  }

  const onConfirmFullCredit = async () => {
    try {
      await confirmNonStripe.mutateAsync(order.id)
    } catch (e) {
      Alert.alert(
        t('alerts.errorTitle'),
        (e as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? t('alerts.confirmFailed'),
      )
    }
  }

  const onAuthorize = async () => {
    setPaying(true)
    try {
      const intent = await authorize.mutateAsync(order.id)
      const initResult = await initPaymentSheet({
        merchantDisplayName: 'Udash',
        paymentIntentClientSecret: intent.clientSecret,
        allowsDelayedPaymentMethods: false,
        returnURL: 'dashgo://stripe-redirect',
      })
      if (initResult.error) {
        setPaying(false)
        Alert.alert(t('alerts.errorTitle'), initResult.error.message)
        return
      }
      const sheetResult = await presentPaymentSheet()
      setPaying(false)
      if (sheetResult.error) {
        if (sheetResult.error.code !== 'Canceled') {
          Alert.alert(t('alerts.errorTitle'), sheetResult.error.message)
        }
        return
      }
      // Success — show the processing state right away while the webhook
      // (amount_capturable_updated → PENDING_VALIDATION) catches up.
      setJustPaid(true)
    } catch (e) {
      setPaying(false)
      Alert.alert(
        t('alerts.errorTitle'),
        (e as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? t('alerts.paymentStartFailed'),
      )
    }
  }

  return (
    <View className="flex-1 bg-paper">
      <ScreenHeader title={t('detail.headerTitle')} />
      <ScrollView contentContainerClassName="grow">
        <View className="px-6 pt-2">
          <Eyebrow>{t('detail.eyebrow', { id: order.id.slice(0, 8) })}</Eyebrow>
          <View className="mt-3">
            <StatusLabel
              status={order.status}
              paymentMethod={order.paymentMethod}
            />
          </View>
          {order.status !== 'cancelled' && (
            <View className="mb-6 mt-5">
              <StatusStepper status={order.status} variant="customer" />
            </View>
          )}

          {order.status === 'pending_quote' && (
            <View className="mb-6 border-l-4 border-accent bg-accent/10 p-4">
              <Text className="font-sans-semibold text-[18px] text-ink">
                {t('banner.awaitingQuote.title')}
              </Text>
              <Text className="mt-2 font-sans text-[15px] text-ink-soft">
                {t('banner.awaitingQuote.body')}
              </Text>
            </View>
          )}

          {order.status === 'quoted' && order.paymentMethod === 'cash' && (
            <View className="mb-6 border-l-4 border-accent bg-accent/10 p-4">
              <Text className="font-sans-semibold text-[18px] text-ink">
                {t('banner.totalTitle', { amount: formatCents(totalCents) })}
              </Text>
              <Text className="mt-2 font-sans text-[15px] text-ink-soft">
                {t('banner.cashQuoted.body')}
              </Text>
              <Button
                variant="accent"
                size="lg"
                onPress={onConfirmCash}
                loading={confirmCash.isPending}
                className="mt-4"
              >
                {t('banner.confirmCta', { amount: formatCents(totalCents) })}
              </Button>
            </View>
          )}

          {order.status === 'quoted' &&
            order.paymentMethod === 'digital' &&
            isFullCredit && (
              <View className="mb-6 border-l-4 border-accent bg-accent/10 p-4">
                <Text className="font-sans-semibold text-[18px] text-ink">
                  {t('banner.totalTitle', { amount: formatCents(totalCents) })}
                </Text>
                <Text className="mt-2 font-sans text-[15px] text-ink-soft">
                  {t('banner.fullCredit.body', {
                    amount: formatCents(creditAppliedCents),
                  })}
                </Text>
                <Button
                  variant="accent"
                  size="lg"
                  onPress={onConfirmFullCredit}
                  loading={confirmNonStripe.isPending}
                  className="mt-4"
                >
                  {t('banner.confirmCta', { amount: formatCents(totalCents) })}
                </Button>
              </View>
            )}

          {/*
            Skip-cotización digital order whose card WAS authorized — show a
            processing state (no button) while the webhook advances quoted →
            pending_validation. Gated on REAL authorization (authorizedAt) or
            justPaid (the window right after a successful PaymentSheet), NOT on
            stripePaymentIntentId — that's set the moment we prepare payment,
            BEFORE the customer authorizes, so cancelling the sheet used to
            leave the order stuck on "procesando" with no way out.
          */}
          {(order.status === 'quoted' ||
            order.status === 'pending_validation') &&
            order.paymentMethod === 'digital' &&
            !isFullCredit &&
            order.skipQuote &&
            (order.authorizedAt || justPaid) && (
              <View className="mb-6 border-l-4 border-accent bg-accent/10 p-4">
                <Text className="font-sans-semibold text-[18px] text-ink">
                  {t('banner.processing.title')}
                </Text>
                <Text className="mt-2 font-sans text-[15px] text-ink-soft">
                  {t('banner.processing.body')}
                </Text>
              </View>
            )}

          {/*
            Recovery: a skip-cotización order that is NOT authorized yet — the
            customer dismissed the PaymentSheet (with or without an intent
            already prepared). Let them retry here instead of getting stuck.
            Re-paying is safe: the intent uses a stable idempotency key, so it
            reuses the same PaymentIntent rather than charging twice.
          */}
          {order.status === 'quoted' &&
            order.paymentMethod === 'digital' &&
            !isFullCredit &&
            order.skipQuote &&
            !order.authorizedAt &&
            !justPaid && (
              <View className="mb-6 border-l-4 border-accent bg-accent/10 p-4">
                <Text className="font-sans-semibold text-[18px] text-ink">
                  {t('banner.completePayment.title', {
                    amount: formatCents(totalCents),
                  })}
                </Text>
                {creditAppliedCents > 0 && (
                  <Text className="mt-2 font-sans text-[15px] text-brand">
                    {t('banner.creditApplied', {
                      credit: formatCents(creditAppliedCents),
                      card: formatCents(stripeAmountCents),
                    })}
                  </Text>
                )}
                <Text className="mt-2 font-sans text-[15px] text-ink-soft">
                  {t('banner.retryAuthorize.body')}
                </Text>
                <Button
                  variant="accent"
                  size="lg"
                  onPress={onAuthorize}
                  loading={paying || authorize.isPending}
                  className="mt-4"
                >
                  {t('banner.payCta', { amount: formatCents(stripeAmountCents) })}
                </Button>
              </View>
            )}

          {/*
            Normal (quote-required) digital orders: shipping is quoted by the
            admin AFTER the order is placed, so the customer authorizes payment
            here once the quote lands. Intended flow for these orders.
          */}
          {order.status === 'quoted' &&
            order.paymentMethod === 'digital' &&
            !isFullCredit &&
            !order.skipQuote && (
              <View className="mb-6 border-l-4 border-accent bg-accent/10 p-4">
                <Text className="font-sans-semibold text-[18px] text-ink">
                  {t('banner.totalTitle', { amount: formatCents(totalCents) })}
                </Text>
                {creditAppliedCents > 0 && (
                  <Text className="mt-2 font-sans text-[15px] text-brand">
                    {t('banner.creditApplied', {
                      credit: formatCents(creditAppliedCents),
                      card: formatCents(stripeAmountCents),
                    })}
                  </Text>
                )}
                <Text className="mt-2 font-sans text-[15px] text-ink-soft">
                  {t('banner.authorize.body')}
                </Text>
                <Button
                  variant="accent"
                  size="lg"
                  onPress={onAuthorize}
                  loading={paying || authorize.isPending}
                  className="mt-4"
                >
                  {t('banner.payCta', { amount: formatCents(stripeAmountCents) })}
                </Button>
              </View>
            )}

          {(order.status === 'confirmed_by_colmado' ||
            order.status === 'in_delivery_route') && (
            <View className="mb-6 border-l-4 border-ink bg-paper-deep/40 p-4">
              <Text className="font-sans-semibold text-[16px] text-ink">
                {order.status === 'confirmed_by_colmado' &&
                  t('banner.readyToDeliver')}
                {order.status === 'in_delivery_route' && t('banner.onTheWay')}
              </Text>
            </View>
          )}

          {/* Lista de compra */}
          <View className="mb-2 flex-row items-baseline justify-between">
            <Eyebrow>{t('detail.itemsEyebrow')}</Eyebrow>
            <Text className="font-sans text-[11px] uppercase tracking-label text-ink-muted">
              {t('items', { count: order.items.length })}
            </Text>
          </View>
          {order.items.map((it) => {
            const lineCents = Math.round(
              parseFloat(it.priceAtOrder) * 100 * it.quantity,
            )
            const unitCents = Math.round(parseFloat(it.priceAtOrder) * 100)
            return (
              <View
                key={it.id}
                className="flex-row items-baseline gap-3 border-b border-ink/10 py-3"
              >
                <Text
                  className="w-8 font-sans-semibold text-[15px] text-ink"
                  style={{ fontVariant: ['tabular-nums'] }}
                >
                  {it.quantity}×
                </Text>
                <View className="flex-1">
                  <Text className="font-sans-semibold text-[15px] text-ink">
                    {it.product?.name ?? it.productId.slice(0, 8)}
                  </Text>
                  <Text
                    className="mt-0.5 font-sans text-[11px] text-ink-muted"
                    style={{ fontVariant: ['tabular-nums'] }}
                  >
                    {t('detail.unitPrice', { price: formatCents(unitCents) })}
                  </Text>
                </View>
                <Text
                  className="font-sans-semibold text-[14px] text-ink"
                  style={{ fontVariant: ['tabular-nums'] }}
                >
                  {formatCents(lineCents)}
                </Text>
              </View>
            )
          })}

          {/* Resumen */}
          <View className="mt-6">
            <Eyebrow className="mb-2">{t('summary.eyebrow')}</Eyebrow>
            <BreakdownRow
              label={t('summary.subtotal')}
              value={formatCents(subtotalCents)}
            />
            {pointsCents > 0 && (
              <BreakdownRow
                label={t('summary.points')}
                value={`−${formatCents(pointsCents)}`}
                emphasis="positive"
              />
            )}
            {creditAppliedCents > 0 && (
              <BreakdownRow
                label={t('summary.credit')}
                value={`−${formatCents(creditAppliedCents)}`}
                emphasis="positive"
              />
            )}
            {order.wasSubscriberAtQuote && order.status !== 'pending_quote' && (
              <View className="my-1 flex-row items-center gap-2">
                <SuscriptorBadge wasSubscriber />
                <Text className="font-sans text-[11px] text-ink-muted">
                  {t('summary.freeShippingApplied')}
                </Text>
              </View>
            )}
            {order.status === 'pending_quote' ? (
              <>
                <BreakdownRow
                  label={t('summary.shipping')}
                  value={t('summary.toQuote')}
                  emphasis="muted"
                  italic
                />
                <BreakdownRow
                  label={t('summary.taxes')}
                  value={t('summary.uponQuote')}
                  emphasis="muted"
                  italic
                />
              </>
            ) : (
              <>
                <BreakdownRow
                  label={t('summary.shipping')}
                  value={formatCents(shippingCents)}
                />
                <BreakdownRow
                  label={t('summary.taxesWithRate', {
                    rate: (Number(order.taxRate) * 100).toFixed(3),
                  })}
                  value={formatCents(taxCents)}
                />
              </>
            )}
            {tipCents > 0 && (
              <BreakdownRow
                label={t('summary.tip')}
                value={formatCents(tipCents)}
              />
            )}
            <Hairline className="my-3" />
            <View className="flex-row items-baseline justify-between">
              <View>
                <Text className="font-sans text-[10px] uppercase tracking-label text-ink-muted">
                  {order.paymentMethod === 'cash'
                    ? t('summary.cashTotalLabel')
                    : t('summary.digitalTotalLabel')}
                </Text>
                <Text
                  className="mt-1 font-sans-semibold text-[32px] leading-[36px] text-brand"
                  style={{ fontVariant: ['tabular-nums'] }}
                >
                  {order.status === 'pending_quote'
                    ? t('summary.toQuote')
                    : formatCents(totalCents)}
                </Text>
              </View>
              {order.paidAt && (
                <View className="items-end">
                  <Text className="font-sans text-[10px] uppercase tracking-label text-ok">
                    {t('summary.paid')}
                  </Text>
                  <Text className="font-sans text-[11px] text-ink-muted">
                    {new Date(order.paidAt).toLocaleDateString('es-AR')}
                  </Text>
                </View>
              )}
            </View>
            {creditAppliedCents > 0 &&
              order.status !== 'pending_quote' &&
              !isFullCredit && (
                <Text className="mt-2 font-sans text-[11px] text-ink-muted">
                  {t('summary.creditCardNote', {
                    amount: formatCents(stripeAmountCents),
                  })}
                </Text>
              )}
          </View>
        </View>
        <View className="h-8" />
      </ScrollView>
    </View>
  )
}
