import { useState } from 'react'
import { View, Text, ScrollView, Alert } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, router } from 'expo-router'
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

function StatusLabel({ status }: { status: Order['status'] }) {
  const label =
    status === 'pending_quote'
      ? 'Por cotizar'
      : status === 'quoted'
        ? 'Cotizado'
        : status === 'pending_validation'
          ? 'Pendiente'
          : status === 'confirmed_by_colmado'
            ? 'Confirmado'
            : status === 'in_delivery_route'
              ? 'En ruta'
              : status === 'delivered'
                ? 'Entregado'
                : 'Cancelado'
  return (
    <View className="self-start border border-ink/20 bg-paper-deep/40 px-3 py-1">
      <Text className="font-sans text-[11px] uppercase tracking-label text-ink">
        {label}
      </Text>
    </View>
  )
}

export default function OrderDetailScreen() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>()
  const { data: order, isPending, error } = useOrder(orderId)
  const confirmCash = useConfirmCashOrder()
  const confirmNonStripe = useConfirmNonStripeOrder()
  const authorize = useAuthorizeOrder()
  const { initPaymentSheet, presentPaymentSheet } = useStripe()
  const [paying, setPaying] = useState(false)

  if (isPending) {
    return (
      <SafeAreaView className="flex-1 bg-paper">
        <View className="flex-1 items-center justify-center">
          <Text className="font-sans text-[13px] uppercase tracking-label text-ink-muted">
            Cargando pedido…
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
            No pudimos cargar el pedido.
          </Text>
          <Button
            variant="secondary"
            size="md"
            onPress={() => router.replace('/(tabs)/orders')}
            className="mt-4"
          >
            Ver mis pedidos
          </Button>
        </View>
      </SafeAreaView>
    )
  }

  const subtotalCents = Math.round(parseFloat(order.subtotal) * 100)
  const shippingCents = Math.round(parseFloat(order.shipping) * 100)
  const taxCents = Math.round(parseFloat(order.tax) * 100)
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
        'Error',
        (e as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? 'No pudimos confirmar',
      )
    }
  }

  const onConfirmFullCredit = async () => {
    try {
      await confirmNonStripe.mutateAsync(order.id)
    } catch (e) {
      Alert.alert(
        'Error',
        (e as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? 'No pudimos confirmar',
      )
    }
  }

  const onAuthorize = async () => {
    setPaying(true)
    try {
      const intent = await authorize.mutateAsync(order.id)
      const initResult = await initPaymentSheet({
        merchantDisplayName: 'Zaz',
        paymentIntentClientSecret: intent.clientSecret,
        allowsDelayedPaymentMethods: false,
        returnURL: 'zaz://stripe-redirect',
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
      // Success — Stripe fires amount_capturable_updated, webhook moves order
      // to PENDING_VALIDATION. The query refetch picks it up.
    } catch (e) {
      setPaying(false)
      Alert.alert(
        'Error',
        (e as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? 'No pudimos iniciar el pago',
      )
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-paper">
      <ScrollView contentContainerClassName="grow">
        <View className="px-6 pt-6">
          <Eyebrow>Pedido · {order.id.slice(0, 8)}</Eyebrow>
          <View className="mt-3">
            <StatusLabel status={order.status} />
          </View>
          {order.status !== 'cancelled' && (
            <View className="mb-6 mt-5">
              <StatusStepper status={order.status} />
            </View>
          )}

          {order.status === 'pending_quote' && (
            <View className="mb-6 border-l-4 border-accent bg-accent/10 p-4">
              <Text className="font-sans-semibold text-[18px] text-ink">
                Esperando cotización
              </Text>
              <Text className="mt-2 font-sans text-[13px] text-ink-soft">
                En breve el repartidor te manda el costo del envío. Esta
                pantalla se actualiza sola.
              </Text>
            </View>
          )}

          {order.status === 'quoted' && order.paymentMethod === 'cash' && (
            <View className="mb-6 border-l-4 border-accent bg-accent/10 p-4">
              <Text className="font-sans-semibold text-[18px] text-ink">
                Total {formatCents(totalCents)}
              </Text>
              <Text className="mt-2 font-sans text-[13px] text-ink-soft">
                Confirma para que salga a entregar. Pagas en efectivo al
                recibir.
              </Text>
              <Button
                variant="accent"
                size="lg"
                onPress={onConfirmCash}
                loading={confirmCash.isPending}
                className="mt-4"
              >
                Confirmar · {formatCents(totalCents)} →
              </Button>
            </View>
          )}

          {order.status === 'quoted' &&
            order.paymentMethod === 'digital' &&
            isFullCredit && (
              <View className="mb-6 border-l-4 border-accent bg-accent/10 p-4">
                <Text className="font-sans-semibold text-[18px] text-ink">
                  Total {formatCents(totalCents)}
                </Text>
                <Text className="mt-2 font-sans text-[13px] text-ink-soft">
                  Este pedido se cubre 100% con tu crédito —{' '}
                  {formatCents(creditAppliedCents)}. No requiere pago con
                  tarjeta.
                </Text>
                <Button
                  variant="accent"
                  size="lg"
                  onPress={onConfirmFullCredit}
                  loading={confirmNonStripe.isPending}
                  className="mt-4"
                >
                  Confirmar · {formatCents(totalCents)} →
                </Button>
              </View>
            )}

          {order.status === 'quoted' &&
            order.paymentMethod === 'digital' &&
            !isFullCredit && (
              <View className="mb-6 border-l-4 border-accent bg-accent/10 p-4">
                <Text className="font-sans-semibold text-[18px] text-ink">
                  Total {formatCents(totalCents)}
                </Text>
                {creditAppliedCents > 0 && (
                  <Text className="mt-2 font-sans text-[13px] text-brand">
                    Crédito aplicado: −{formatCents(creditAppliedCents)} · Pago
                    con tarjeta: {formatCents(stripeAmountCents)}
                  </Text>
                )}
                <Text className="mt-2 font-sans text-[13px] text-ink-soft">
                  Autorizá el cobro. Retenemos el monto y lo cobramos solo cuando
                  te entreguemos.
                </Text>
                <Button
                  variant="accent"
                  size="lg"
                  onPress={onAuthorize}
                  loading={paying || authorize.isPending}
                  className="mt-4"
                >
                  Autorizar pago · {formatCents(stripeAmountCents)} →
                </Button>
              </View>
            )}

          {(order.status === 'pending_validation' ||
            order.status === 'confirmed_by_colmado' ||
            order.status === 'in_delivery_route') && (
            <View className="mb-6 border-l-4 border-ink bg-paper-deep/40 p-4">
              <Text className="font-sans-semibold text-[16px] text-ink">
                {order.status === 'pending_validation' &&
                  'Pedido confirmado — el colmado lo prepara.'}
                {order.status === 'confirmed_by_colmado' &&
                  'Listo para salir a entregar.'}
                {order.status === 'in_delivery_route' && 'En camino a tu puerta.'}
              </Text>
            </View>
          )}

          {/* Lista de compra */}
          <View className="mb-2 flex-row items-baseline justify-between">
            <Eyebrow>Lista de compra</Eyebrow>
            <Text className="font-sans text-[11px] uppercase tracking-label text-ink-muted">
              {order.items.length}{' '}
              {order.items.length === 1 ? 'producto' : 'productos'}
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
                  <Text className="font-sans-semibold text-[14px] text-ink">
                    {it.product?.name ?? it.productId.slice(0, 8)}
                  </Text>
                  <Text
                    className="mt-0.5 font-sans text-[11px] text-ink-muted"
                    style={{ fontVariant: ['tabular-nums'] }}
                  >
                    {formatCents(unitCents)} c/u
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
            <Eyebrow className="mb-2">Resumen</Eyebrow>
            <BreakdownRow label="Subtotal" value={formatCents(subtotalCents)} />
            {pointsCents > 0 && (
              <BreakdownRow
                label="Puntos"
                value={`−${formatCents(pointsCents)}`}
                emphasis="positive"
              />
            )}
            {creditAppliedCents > 0 && (
              <BreakdownRow
                label="Crédito"
                value={`−${formatCents(creditAppliedCents)}`}
                emphasis="positive"
              />
            )}
            {order.wasSubscriberAtQuote && order.status !== 'pending_quote' && (
              <View className="my-1 flex-row items-center gap-2">
                <SuscriptorBadge wasSubscriber />
                <Text className="font-sans text-[11px] text-ink-muted">
                  Envío gratis aplicado
                </Text>
              </View>
            )}
            {order.status === 'pending_quote' ? (
              <>
                <BreakdownRow
                  label="Envío"
                  value="A cotizar"
                  emphasis="muted"
                  italic
                />
                <BreakdownRow
                  label="Impuestos"
                  value="Al cotizar"
                  emphasis="muted"
                  italic
                />
              </>
            ) : (
              <>
                <BreakdownRow
                  label="Envío"
                  value={formatCents(shippingCents)}
                />
                <BreakdownRow
                  label={`Impuestos (${(Number(order.taxRate) * 100).toFixed(3)}%)`}
                  value={formatCents(taxCents)}
                />
              </>
            )}
            <Hairline className="my-3" />
            <View className="flex-row items-baseline justify-between">
              <View>
                <Text className="font-sans text-[10px] uppercase tracking-label text-ink-muted">
                  {order.paymentMethod === 'cash'
                    ? 'A pagar · Efectivo'
                    : 'Total · Digital'}
                </Text>
                <Text
                  className="mt-1 font-sans-semibold text-[32px] leading-[36px] text-brand"
                  style={{ fontVariant: ['tabular-nums'] }}
                >
                  {order.status === 'pending_quote'
                    ? 'A cotizar'
                    : formatCents(totalCents)}
                </Text>
              </View>
              {order.paidAt && (
                <View className="items-end">
                  <Text className="font-sans text-[10px] uppercase tracking-label text-ok">
                    Pagado
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
                  Crédito aplicado · pago con tarjeta:{' '}
                  {formatCents(stripeAmountCents)}
                </Text>
              )}
          </View>
        </View>
        <View className="h-8" />
      </ScrollView>
    </SafeAreaView>
  )
}
