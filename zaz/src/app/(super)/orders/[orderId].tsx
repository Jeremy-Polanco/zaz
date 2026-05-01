import { useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  Pressable,
  Linking,
  Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router, useLocalSearchParams } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { SymbolView } from 'expo-symbols'
import { api } from '../../../lib/api'
import { useUpdateOrderStatus } from '../../../lib/queries'
import { formatDate, formatMoney } from '../../../lib/format'
import type { GeoAddress, Order, OrderStatus } from '../../../lib/types'
import {
  BreakdownRow,
  Button,
  Eyebrow,
  Hairline,
  StatusBadge,
  StatusStepper,
} from '../../../components/ui'
import { SuscriptorBadge } from '../../../components/SuscriptorBadge'
import { QuoteBottomSheet } from '../../../components/QuoteBottomSheet'

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
  })
}

function nextStatus(current: OrderStatus): OrderStatus | null {
  if (current === 'pending_validation') return 'confirmed_by_colmado'
  if (current === 'confirmed_by_colmado') return 'in_delivery_route'
  if (current === 'in_delivery_route') return 'delivered'
  return null
}

function nextLabel(status: OrderStatus): string {
  if (status === 'pending_validation') return 'Confirmar pedido'
  if (status === 'confirmed_by_colmado') return 'Salir a entregar'
  if (status === 'in_delivery_route') return 'Marcar entregado'
  return ''
}

function openMaps(addr: GeoAddress) {
  const hasCoords = typeof addr.lat === 'number' && typeof addr.lng === 'number'
  const url = hasCoords
    ? `https://www.google.com/maps/dir/?api=1&destination=${addr.lat},${addr.lng}`
    : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(addr.text)}`
  Linking.openURL(url).catch(() => Alert.alert('No se pudo abrir Maps'))
}

function openWaze(addr: GeoAddress) {
  const hasCoords = typeof addr.lat === 'number' && typeof addr.lng === 'number'
  const url = hasCoords
    ? `https://waze.com/ul?ll=${addr.lat},${addr.lng}&navigate=yes`
    : `https://waze.com/ul?q=${encodeURIComponent(addr.text)}&navigate=yes`
  Linking.openURL(url).catch(() => Alert.alert('No se pudo abrir Waze'))
}

function callCustomer(phone: string | null | undefined) {
  if (!phone) return
  Linking.openURL(`tel:${phone}`).catch(() =>
    Alert.alert('No se pudo iniciar la llamada'),
  )
}

export default function SuperOrderDetailScreen() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>()
  const { data: order, isPending, error } = useOrder(orderId)
  const updateStatus = useUpdateOrderStatus()
  const [quoting, setQuoting] = useState(false)

  if (isPending) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-paper">
        <ActivityIndicator color="#220247" size="small" />
      </SafeAreaView>
    )
  }

  if (error || !order) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-paper px-6">
        <Eyebrow>Error</Eyebrow>
        <Text className="mt-3 text-center font-sans text-[15px] text-ink-soft">
          No pudimos cargar este pedido.
        </Text>
        <View className="mt-6">
          <Button variant="outline" onPress={() => router.back()}>
            ← Volver
          </Button>
        </View>
      </SafeAreaView>
    )
  }

  const customerName = order.customer?.fullName ?? 'Cliente'
  const customerPhone = order.customer?.phone ?? null
  const isQuoted = order.status !== 'pending_quote'
  const isTerminal =
    order.status === 'delivered' || order.status === 'cancelled'
  const next = nextStatus(order.status)
  const canCancel =
    order.status === 'pending_quote' ||
    order.status === 'quoted' ||
    order.status === 'pending_validation' ||
    order.status === 'confirmed_by_colmado'

  const handleAdvance = (status: OrderStatus) => {
    updateStatus.mutate(
      { id: order.id, status },
      {
        onError: (e) => {
          const msg =
            (e as { response?: { data?: { message?: string } } })?.response
              ?.data?.message ?? 'No se pudo actualizar el pedido'
          Alert.alert('Error', msg)
        },
      },
    )
  }

  const handleCancel = () => {
    Alert.alert('Cancelar pedido', '¿Seguro que quieres cancelar este pedido?', [
      { text: 'Volver', style: 'cancel' },
      {
        text: 'Cancelar pedido',
        style: 'destructive',
        onPress: () => handleAdvance('cancelled'),
      },
    ])
  }

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-paper">
      {/* Top bar */}
      <View className="flex-row items-center justify-between border-b border-ink/10 px-5 py-3">
        <Pressable
          onPress={() => router.back()}
          className="-ml-1 flex-row items-center gap-1 px-1 py-1 active:opacity-60"
        >
          <SymbolView
            name={{ ios: 'chevron.left', android: 'chevron_left' }}
            size={14}
            tintColor="#1A1530"
            resizeMode="scaleAspectFit"
            fallback={<Text className="text-ink">←</Text>}
          />
          <Text className="font-sans-medium text-[13px] text-ink">Ruta</Text>
        </Pressable>
        <Text
          className="font-sans-medium text-[12px] uppercase tracking-label text-ink-muted"
          numberOfLines={1}
        >
          {order.id.slice(0, 8)}
        </Text>
      </View>

      <ScrollView
        contentContainerClassName="pb-32"
        showsVerticalScrollIndicator={false}
      >
        {/* Magazine header */}
        <View className="px-5 pb-4 pt-6">
          <View className="flex-row items-start justify-between gap-3">
            <View className="flex-1">
              <Eyebrow className="mb-3">
                Pedido · {formatDate(order.createdAt)}
              </Eyebrow>
              <View className="flex-row items-baseline">
                <Text
                  className="font-sans-italic text-[36px] leading-[40px] text-ink"
                  numberOfLines={2}
                >
                  {customerName}
                </Text>
                <Text className="font-sans-semibold text-[36px] leading-[40px] text-ink">
                  .
                </Text>
              </View>
            </View>
            <View className="pt-1">
              <StatusBadge status={order.status} />
            </View>
          </View>
        </View>

        {/* Status stepper */}
        {order.status !== 'cancelled' && (
          <View className="px-5 pb-2">
            <StatusStepper status={order.status} />
          </View>
        )}

        {/* Customer + address card */}
        <View className="mt-4 px-5">
          <Eyebrow className="mb-3">Cliente</Eyebrow>
          <View className="flex-row items-center gap-4 border-b border-ink/10 pb-4">
            <View className="h-12 w-12 items-center justify-center bg-ink">
              <Text className="font-sans-semibold text-[18px] text-paper">
                {customerName?.[0]?.toUpperCase() ?? '·'}
              </Text>
            </View>
            <View className="flex-1">
              <Text className="font-sans-semibold text-[16px] text-ink">
                {customerName}
              </Text>
              {customerPhone && (
                <Text
                  className="mt-0.5 font-sans text-[13px] text-ink-muted"
                  style={{ fontVariant: ['tabular-nums'] }}
                >
                  {customerPhone}
                </Text>
              )}
            </View>
            {customerPhone && (
              <Pressable
                onPress={() => callCustomer(customerPhone)}
                className="h-9 items-center justify-center border border-ink/40 px-3 active:bg-ink/5"
              >
                <Text className="font-sans-medium text-[10px] uppercase tracking-label text-ink">
                  Llamar
                </Text>
              </Pressable>
            )}
          </View>
        </View>

        <View className="mt-5 px-5">
          <Eyebrow className="mb-3">Entrega</Eyebrow>
          <Text className="text-[15px] leading-[22px] text-ink">
            {order.deliveryAddress.text}
          </Text>
          {typeof order.deliveryAddress.lat === 'number' &&
            typeof order.deliveryAddress.lng === 'number' && (
              <Text
                className="mt-1 font-sans text-[11px] uppercase tracking-label text-ink-muted"
                style={{ fontVariant: ['tabular-nums'] }}
              >
                {order.deliveryAddress.lat.toFixed(5)},{' '}
                {order.deliveryAddress.lng.toFixed(5)}
              </Text>
            )}
          {!isTerminal && (
            <View className="mt-3 flex-row gap-2">
              <Pressable
                onPress={() => openMaps(order.deliveryAddress)}
                className="flex-1 items-center justify-center border border-ink/15 py-2.5 active:bg-paper-deep"
              >
                <Text className="font-sans-medium text-[11px] uppercase tracking-label text-ink">
                  Maps ↗
                </Text>
              </Pressable>
              <Pressable
                onPress={() => openWaze(order.deliveryAddress)}
                className="flex-1 items-center justify-center border border-ink/15 py-2.5 active:bg-paper-deep"
              >
                <Text className="font-sans-medium text-[11px] uppercase tracking-label text-ink">
                  Waze ↗
                </Text>
              </Pressable>
            </View>
          )}
        </View>

        <Hairline className="mx-5 mt-7" />

        {/* Items list */}
        <View className="mt-6 px-5">
          <View className="mb-3 flex-row items-baseline justify-between">
            <Eyebrow>Lista de compra</Eyebrow>
            <Text className="font-sans text-[11px] uppercase tracking-label text-ink-muted">
              {order.items.length}{' '}
              {order.items.length === 1 ? 'producto' : 'productos'}
            </Text>
          </View>
          {order.items.map((item) => (
            <View
              key={item.id}
              className="flex-row items-baseline gap-3 border-b border-ink/10 py-3"
            >
              <Text
                className="w-8 font-sans-semibold text-[15px] text-ink"
                style={{ fontVariant: ['tabular-nums'] }}
              >
                {item.quantity}×
              </Text>
              <View className="flex-1">
                <Text className="font-sans-semibold text-[14px] text-ink">
                  {item.product?.name ?? 'Producto'}
                </Text>
                <Text
                  className="mt-0.5 font-sans text-[11px] text-ink-muted"
                  style={{ fontVariant: ['tabular-nums'] }}
                >
                  {formatMoney(item.priceAtOrder)} c/u
                </Text>
              </View>
              <Text
                className="font-sans-semibold text-[14px] text-ink"
                style={{ fontVariant: ['tabular-nums'] }}
              >
                {formatMoney(
                  Number(item.priceAtOrder) * item.quantity || 0,
                )}
              </Text>
            </View>
          ))}
        </View>

        {/* Money breakdown */}
        <View className="mt-6 px-5">
          <Eyebrow className="mb-2">Resumen</Eyebrow>
          <BreakdownRow label="Subtotal" value={formatMoney(order.subtotal)} />
          {Number(order.pointsRedeemed) > 0 && (
            <BreakdownRow
              label="Puntos"
              value={`−${formatMoney(order.pointsRedeemed)}`}
              emphasis="positive"
            />
          )}
          {order.creditApplied && Number(order.creditApplied) > 0 && (
            <BreakdownRow
              label="Crédito"
              value={`−${formatMoney(order.creditApplied)}`}
              emphasis="positive"
            />
          )}
          {order.wasSubscriberAtQuote && isQuoted && (
            <View className="my-1 flex-row items-center gap-2">
              <SuscriptorBadge wasSubscriber />
              <Text className="font-sans text-[11px] text-ink-muted">
                Envío gratis aplicado
              </Text>
            </View>
          )}
          {isQuoted ? (
            <>
              <BreakdownRow
                label="Envío"
                value={formatMoney(order.shipping)}
              />
              <BreakdownRow
                label={`Tax (${(Number(order.taxRate) * 100).toFixed(3)}%)`}
                value={formatMoney(order.tax)}
              />
            </>
          ) : (
            <>
              <BreakdownRow
                label="Envío"
                value="A cotizar"
                emphasis="muted"
                italic
              />
              <BreakdownRow
                label="Tax"
                value="A calcular"
                emphasis="muted"
                italic
              />
            </>
          )}
          <Hairline className="my-3" />
          <View className="flex-row items-baseline justify-between">
            <View>
              <Text className="font-sans text-[10px] uppercase tracking-label text-ink-muted">
                {order.paymentMethod === 'cash' ? 'A cobrar · Efectivo' : 'Total · Digital'}
              </Text>
              <Text
                className="mt-1 font-sans-semibold text-[32px] leading-[36px] text-brand"
                style={{ fontVariant: ['tabular-nums'] }}
              >
                {isQuoted ? formatMoney(order.totalAmount) : '—'}
              </Text>
            </View>
            {order.paidAt && (
              <View className="items-end">
                <Text className="font-sans text-[10px] uppercase tracking-label text-ok">
                  Cobrado
                </Text>
                <Text className="font-sans text-[11px] text-ink-muted">
                  {formatDate(order.paidAt)}
                </Text>
              </View>
            )}
          </View>
        </View>
      </ScrollView>

      {/* Sticky action footer */}
      {!isTerminal && (
        <View
          className="border-t border-ink/10 bg-paper px-5 pb-6 pt-3"
          style={{ position: 'absolute', bottom: 0, left: 0, right: 0 }}
        >
          {order.status === 'pending_quote' && (
            <View className="flex-row gap-2">
              <View className="flex-1">
                <Button variant="accent" onPress={() => setQuoting(true)}>
                  Cotizar envío →
                </Button>
              </View>
              {canCancel && (
                <Button
                  variant="outline"
                  onPress={handleCancel}
                  loading={updateStatus.isPending}
                >
                  Cancelar
                </Button>
              )}
            </View>
          )}

          {order.status === 'quoted' && (
            <View>
              <Text className="mb-2 font-sans text-[11px] uppercase tracking-label text-ink-muted">
                Esperando autorización del cliente
              </Text>
              <View className="flex-row gap-2">
                <View className="flex-1">
                  <Button variant="outline" onPress={() => setQuoting(true)}>
                    Ajustar cotización
                  </Button>
                </View>
                {canCancel && (
                  <Button
                    variant="ghost"
                    onPress={handleCancel}
                    loading={updateStatus.isPending}
                  >
                    Cancelar
                  </Button>
                )}
              </View>
            </View>
          )}

          {next && order.status !== 'pending_quote' && order.status !== 'quoted' && (
            <View className="flex-row gap-2">
              <View className="flex-1">
                <Button
                  variant={
                    order.status === 'in_delivery_route' ? 'accent' : 'ink'
                  }
                  onPress={() => handleAdvance(next)}
                  loading={updateStatus.isPending}
                >
                  {nextLabel(order.status)} →
                </Button>
              </View>
              {canCancel && (
                <Button
                  variant="ghost"
                  onPress={handleCancel}
                  loading={updateStatus.isPending}
                >
                  Cancelar
                </Button>
              )}
            </View>
          )}
        </View>
      )}

      {quoting && (
        <QuoteBottomSheet
          order={order}
          onClose={() => setQuoting(false)}
        />
      )}
    </SafeAreaView>
  )
}
