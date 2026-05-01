import { useMemo, useState } from 'react'
import {
  View,
  Text,
  FlatList,
  ActivityIndicator,
  Pressable,
  Linking,
  Alert,
  ScrollView,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { SymbolView } from 'expo-symbols'
import { useOrders, useUpdateOrderStatus } from '../../lib/queries'
import { formatDate, formatMoney } from '../../lib/format'
import type { GeoAddress, Order, OrderStatus } from '../../lib/types'
import { Button, Eyebrow, Hairline, KpiCard, StatusBadge } from '../../components/ui'
import { SuscriptorBadge } from '../../components/SuscriptorBadge'
import { QuoteBottomSheet } from '../../components/QuoteBottomSheet'

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

function OrderCard({
  order,
  onAdvance,
  onCancel,
  onQuote,
  isUpdating,
}: {
  order: Order
  onAdvance: (next: OrderStatus) => void
  onCancel: () => void
  onQuote: () => void
  isUpdating: boolean
}) {
  const next = nextStatus(order.status)
  const itemCount = order.items?.length ?? 0
  const isTerminal = order.status === 'delivered' || order.status === 'cancelled'
  const needsQuote = order.status === 'pending_quote'
  const isQuoted = order.status === 'quoted'

  const openDetail = () =>
    router.navigate({
      pathname: '/(super)/orders/[orderId]',
      params: { orderId: order.id },
    })

  return (
    <View className="py-5">
      <Pressable onPress={openDetail} className="active:opacity-70">
        <View className="mb-3 flex-row items-start justify-between">
          <View className="flex-1 pr-3">
            <Text className="font-sans text-[11px] uppercase tracking-label text-ink-muted">
              {formatDate(order.createdAt)}
            </Text>
            <Text className="mt-1 font-sans-semibold text-[20px] leading-[24px] text-ink">
              {order.customer?.fullName ?? 'Cliente'}
            </Text>
            <Text className="mt-0.5 text-[13px] text-ink-soft">
              {order.deliveryAddress.text}
            </Text>
          </View>
          <View className="items-end gap-2">
            <StatusBadge status={order.status} />
            <View className="flex-row items-center gap-1 opacity-70">
              <Text className="font-sans-medium text-[10px] uppercase tracking-label text-ink-muted">
                Detalle
              </Text>
              <SymbolView
                name={{ ios: 'chevron.right', android: 'chevron_right' }}
                size={10}
                tintColor="#6B6488"
                resizeMode="scaleAspectFit"
                fallback={<Text className="text-ink-muted text-[10px]">›</Text>}
              />
            </View>
          </View>
        </View>
      </Pressable>

      {itemCount > 0 && (
        <View className="mb-4 border-l-2 border-accent/60 pl-3">
          <Text className="mb-2 font-sans text-[10px] uppercase tracking-label text-ink-muted">
            Lista de compra
          </Text>
          {order.items.map((item) => (
            <View
              key={item.id}
              className="flex-row items-baseline gap-2 py-0.5"
            >
              <Text
                className="font-sans-semibold text-[15px] text-ink"
                style={{ fontVariant: ['tabular-nums'] }}
              >
                {item.quantity}×
              </Text>
              <Text className="flex-1 text-[14px] text-ink-soft">
                {item.product?.name ?? 'Producto'}
              </Text>
              <Text
                className="text-[13px] text-ink-muted"
                style={{ fontVariant: ['tabular-nums'] }}
              >
                {formatMoney(item.priceAtOrder)}
              </Text>
            </View>
          ))}
        </View>
      )}

      <View className="mb-4 flex-row items-center justify-between">
        <Text className="font-sans text-[11px] uppercase tracking-label text-ink-muted">
          {itemCount} {itemCount === 1 ? 'producto' : 'productos'} ·{' '}
          {order.paymentMethod === 'cash' ? 'Efectivo' : 'Digital'}
        </Text>
        <View className="flex-row items-center gap-2">
          <SuscriptorBadge wasSubscriber={order.wasSubscriberAtQuote ?? false} />
          <Text
            className="font-sans-semibold text-[22px] text-brand"
            style={{ fontVariant: ['tabular-nums'] }}
          >
            {formatMoney(order.totalAmount)}
          </Text>
        </View>
      </View>

      {!isTerminal && (
        <View className="mb-3 flex-row gap-2">
          <Pressable
            onPress={() => openMaps(order.deliveryAddress)}
            className="flex-1 flex-row items-center justify-center border border-ink/20 bg-paper py-2 active:bg-paper-deep"
          >
            <Text className="font-sans text-[11px] uppercase tracking-label text-ink">
              Maps ↗
            </Text>
          </Pressable>
          <Pressable
            onPress={() => openWaze(order.deliveryAddress)}
            className="flex-1 flex-row items-center justify-center border border-ink/20 bg-paper py-2 active:bg-paper-deep"
          >
            <Text className="font-sans text-[11px] uppercase tracking-label text-ink">
              Waze ↗
            </Text>
          </Pressable>
        </View>
      )}

      {needsQuote && (
        <View className="flex-row gap-2">
          <View className="flex-1">
            <Button variant="accent" onPress={onQuote}>
              Cotizar envío
            </Button>
          </View>
          <Button variant="outline" onPress={onCancel} loading={isUpdating}>
            Cancelar
          </Button>
        </View>
      )}

      {isQuoted && (
        <View>
          <Text className="mb-2 font-sans text-[11px] uppercase tracking-label text-ink-muted">
            Cotizado · esperando al cliente
          </Text>
          <View className="flex-row gap-2">
            <View className="flex-1">
              <Button variant="outline" onPress={onQuote}>
                Ajustar cotización
              </Button>
            </View>
            <Button variant="outline" onPress={onCancel} loading={isUpdating}>
              Cancelar
            </Button>
          </View>
        </View>
      )}

      {next && !needsQuote && !isQuoted && (
        <View className="flex-row gap-2">
          <View className="flex-1">
            <Button
              variant={order.status === 'in_delivery_route' ? 'accent' : 'ink'}
              onPress={() => onAdvance(next)}
              loading={isUpdating}
            >
              {nextLabel(order.status)}
            </Button>
          </View>
          {order.status !== 'in_delivery_route' && (
            <Button variant="outline" onPress={onCancel} loading={isUpdating}>
              Cancelar
            </Button>
          )}
        </View>
      )}

      <Hairline className="mt-5" />
    </View>
  )
}

type RouteFilter =
  | 'all'
  | 'pending_quote'
  | 'quoted'
  | 'pending_validation'
  | 'in_delivery_route'

export default function SuperOrdersScreen() {
  const { data: orders, isPending, refetch, isRefetching } = useOrders()
  const updateStatus = useUpdateOrderStatus()
  const [quotingOrder, setQuotingOrder] = useState<Order | null>(null)
  const [filter, setFilter] = useState<RouteFilter>('all')

  const stats = useMemo(() => {
    const list = orders ?? []
    return {
      pendingQuote: list.filter((o) => o.status === 'pending_quote').length,
      pendingConfirm: list.filter((o) => o.status === 'pending_validation').length,
      readyToGo: list.filter((o) => o.status === 'confirmed_by_colmado').length,
      inRoute: list.filter((o) => o.status === 'in_delivery_route').length,
      delivered: list.filter((o) => o.status === 'delivered').length,
    }
  }, [orders])

  const activeOrders = useMemo(() => {
    const baseActive = (orders ?? []).filter(
      (o) =>
        o.status === 'pending_quote' ||
        o.status === 'quoted' ||
        o.status === 'pending_validation' ||
        o.status === 'confirmed_by_colmado' ||
        o.status === 'in_delivery_route',
    )
    if (filter === 'all') return baseActive
    if (filter === 'in_delivery_route') {
      // "En ruta" agrupa confirmados + en_ruta para no esconder pedidos listos.
      return baseActive.filter(
        (o) => o.status === 'confirmed_by_colmado' || o.status === 'in_delivery_route',
      )
    }
    return baseActive.filter((o) => o.status === filter)
  }, [orders, filter])

  const handleAdvance = (id: string, status: OrderStatus) => {
    updateStatus.mutate(
      { id, status },
      {
        onError: (e) => {
          const msg =
            (e as { response?: { data?: { message?: string } } })?.response?.data
              ?.message ?? 'No se pudo actualizar el pedido'
          Alert.alert('Error', msg)
        },
      },
    )
  }

  const handleCancel = (id: string) => {
    Alert.alert('Cancelar pedido', '¿Seguro que quieres cancelar este pedido?', [
      { text: 'Volver', style: 'cancel' },
      {
        text: 'Cancelar pedido',
        style: 'destructive',
        onPress: () => handleAdvance(id, 'cancelled'),
      },
    ])
  }

  if (isPending) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-paper">
        <ActivityIndicator color="#220247" size="small" />
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-paper">
      <FlatList
        data={activeOrders}
        keyExtractor={(o) => o.id}
        contentContainerClassName="px-5 pb-8"
        ListHeaderComponent={
          <View className="pb-2 pt-6">
            <Eyebrow className="mb-3">Panel · Reparto</Eyebrow>
            <View className="flex-row items-baseline">
              <Text className="font-sans-italic text-[56px] leading-[60px] text-ink">
                Hoy
              </Text>
              <Text className="font-sans-semibold text-[56px] leading-[60px] text-ink">
                .
              </Text>
            </View>
            <Text className="mt-3 text-[15px] leading-[22px] text-ink-soft">
              {stats.pendingQuote} por cotizar ·{' '}
              {stats.inRoute + stats.readyToGo} en ruta ·{' '}
              {stats.delivered} entregados.
            </Text>

            <View className="mt-6 flex-row gap-2">
              <KpiCard label="Cotizar" value={stats.pendingQuote} tone="warn" />
              <KpiCard label="Confirmar" value={stats.pendingConfirm} tone="warn" />
              <KpiCard label="En ruta" value={stats.inRoute + stats.readyToGo} tone="attn" />
              <KpiCard label="Entregados" value={stats.delivered} tone="ok" />
            </View>

            <View className="mt-5">
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 6 }}
              >
                {(
                  [
                    { id: 'all', label: 'Todos' },
                    { id: 'pending_quote', label: 'Por cotizar' },
                    { id: 'quoted', label: 'Cotizados' },
                    { id: 'pending_validation', label: 'Por confirmar' },
                    { id: 'in_delivery_route', label: 'En ruta' },
                  ] as const
                ).map((f) => {
                  const sel = filter === f.id
                  return (
                    <Pressable
                      key={f.id}
                      onPress={() => setFilter(f.id)}
                      className={`px-3 py-1.5 ${
                        sel ? 'bg-ink' : 'border border-ink/15 bg-transparent'
                      }`}
                    >
                      <Text
                        className={`font-sans-medium text-[10px] uppercase tracking-label ${
                          sel ? 'text-paper' : 'text-ink-soft'
                        }`}
                      >
                        {f.label}
                      </Text>
                    </Pressable>
                  )
                })}
              </ScrollView>
            </View>

            <Hairline className="mt-6" />
          </View>
        }
        renderItem={({ item }) => (
          <OrderCard
            order={item}
            onAdvance={(next) => handleAdvance(item.id, next)}
            onCancel={() => handleCancel(item.id)}
            onQuote={() => setQuotingOrder(item)}
            isUpdating={updateStatus.isPending}
          />
        )}
        ListEmptyComponent={
          <View className="items-center py-20">
            <Eyebrow>Sin pedidos</Eyebrow>
            <Text className="mt-3 text-center text-[15px] text-ink-soft">
              Cuando lleguen pedidos{'\n'}los vas a ver acá.
            </Text>
          </View>
        }
        refreshing={isRefetching}
        onRefresh={refetch}
      />

      {quotingOrder && (
        <QuoteBottomSheet
          order={quotingOrder}
          onClose={() => setQuotingOrder(null)}
        />
      )}
    </SafeAreaView>
  )
}
