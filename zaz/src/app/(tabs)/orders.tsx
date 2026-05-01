import { View, Text, FlatList, ActivityIndicator, Pressable } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { useOrders } from '../../lib/queries'
import { formatDate, formatMoney } from '../../lib/format'
import type { Order } from '../../lib/types'
import { Eyebrow, Hairline, StatusBadge } from '../../components/ui'

function OrderCard({ order }: { order: Order }) {
  const itemCount = order.items?.length ?? 0
  return (
    <View className="py-5">
      <View className="mb-3 flex-row items-start justify-between">
        <View className="flex-1 pr-3">
          <Text className="font-sans text-[11px] uppercase tracking-label text-ink-muted">
            {formatDate(order.createdAt)}
          </Text>
          <Text className="mt-1 font-sans-semibold text-[20px] leading-[24px] text-ink">
            Pedido · {formatMoney(order.totalAmount)}
          </Text>
          <Text className="mt-0.5 text-[13px] text-ink-soft">
            {order.deliveryAddress.text}
          </Text>
        </View>
        <StatusBadge status={order.status} />
      </View>

      <View className="flex-row items-center justify-between">
        <Text className="font-sans text-[11px] uppercase tracking-label text-ink-muted">
          {itemCount} {itemCount === 1 ? 'producto' : 'productos'} · {order.paymentMethod === 'cash' ? 'Efectivo' : 'Digital'}
        </Text>
        <Text
          className="font-sans-semibold text-[22px] text-brand"
          style={{ fontVariant: ['tabular-nums'] }}
        >
          {formatMoney(order.totalAmount)}
        </Text>
      </View>

      {order.status === 'delivered' && (
        <Pressable
          onPress={() =>
            router.push({
              pathname: '/orders/[orderId]/invoice',
              params: { orderId: order.id },
            })
          }
          className="mt-3"
        >
          <Text className="font-sans text-[11px] uppercase tracking-label text-brand">
            Ver factura →
          </Text>
        </Pressable>
      )}

      <Hairline className="mt-5" />
    </View>
  )
}

export default function OrdersTab() {
  const { data: orders, isPending, refetch, isRefetching } = useOrders()

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
        data={orders ?? []}
        keyExtractor={(o) => o.id}
        contentContainerClassName="px-5 pb-8"
        ListHeaderComponent={
          <View className="pb-2 pt-6">
            <Eyebrow className="mb-3">Historial</Eyebrow>
            <View className="flex-row flex-wrap items-baseline">
              <Text className="font-sans-semibold text-[40px] leading-[44px] text-ink">
                Mis{' '}
              </Text>
              <Text className="font-sans-italic text-[40px] leading-[44px] text-brand">
                pedidos.
              </Text>
            </View>
            <Hairline className="mt-6" />
          </View>
        }
        renderItem={({ item }) => <OrderCard order={item} />}
        ListEmptyComponent={
          <View className="items-center py-20">
            <Eyebrow>Sin pedidos</Eyebrow>
            <Text className="mt-3 text-center text-[15px] text-ink-soft">
              Cuando hagas tu primer pedido{'\n'}lo vas a ver acá.
            </Text>
          </View>
        }
        refreshing={isRefetching}
        onRefresh={refetch}
      />
    </SafeAreaView>
  )
}
