import { View, Text, FlatList, ActivityIndicator, Pressable } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { useCurrentUser, useOrders } from '../../lib/queries'
import { formatDate, formatMoney } from '../../lib/format'
import type { Order } from '../../lib/types'
import { Button, Eyebrow, Hairline, StatusBadge } from '../../components/ui'

function OrderCard({ order }: { order: Order }) {
  const itemCount = order.items?.length ?? 0
  return (
    <Pressable
      onPress={() =>
        router.push({
          pathname: '/orders/[orderId]',
          params: { orderId: order.id },
        })
      }
      className="py-5 active:opacity-70"
    >
      <View className="mb-3 flex-row items-start justify-between">
        <View className="flex-1 pr-3">
          <Text className="font-sans text-[13px] uppercase tracking-label text-ink-muted">
            {formatDate(order.createdAt)}
          </Text>
          <Text className="mt-1 font-sans-semibold text-[20px] leading-[24px] text-ink">
            Pedido · {formatMoney(order.totalAmount)}
          </Text>
          <Text className="mt-0.5 text-[13px] text-ink-soft">
            {order.deliveryAddress?.text ?? 'A coordinar'}
          </Text>
        </View>
        <StatusBadge status={order.status} />
      </View>

      <View className="flex-row items-center justify-between">
        <Text className="font-sans text-[13px] uppercase tracking-label text-ink-muted">
          {itemCount} {itemCount === 1 ? 'producto' : 'productos'} · {order.paymentMethod === 'cash' ? 'Efectivo' : 'Digital'}
        </Text>
        <Text
          className="font-sans-semibold text-[22px] text-brand"
          style={{ fontVariant: ['tabular-nums'] }}
        >
          {formatMoney(order.totalAmount)}
        </Text>
      </View>

      {order.status === 'delivered' ? (
        <Pressable
          onPress={() =>
            router.push({
              pathname: '/orders/[orderId]/invoice',
              params: { orderId: order.id },
            })
          }
          className="mt-3 min-h-[48px] justify-center"
        >
          <Text className="font-sans text-[13px] uppercase tracking-label text-brand">
            Ver factura →
          </Text>
        </Pressable>
      ) : (
        order.status !== 'cancelled' && (
          <Text className="mt-3 font-sans text-[13px] uppercase tracking-label text-brand">
            Seguir pedido →
          </Text>
        )
      )}

      <Hairline className="mt-5" />
    </Pressable>
  )
}

export default function OrdersTab() {
  const { data: user, isPending: userPending } = useCurrentUser()
  const { data: orders, isPending, refetch, isRefetching } = useOrders()

  if (userPending) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-paper">
        <ActivityIndicator color="#1A1530" size="small" />
      </SafeAreaView>
    )
  }

  // Guest: order history is account-based — invite to log in instead of
  // fetching (useOrders is disabled without a session, so isPending would
  // never resolve here).
  if (!user) {
    return (
      <SafeAreaView edges={['top']} className="flex-1 bg-paper">
        <View className="px-5 pt-6">
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
          <View className="items-center py-20">
            <Eyebrow>Tu cuenta te espera</Eyebrow>
            <Text className="mt-3 text-center text-[15px] text-ink-soft">
              Iniciá sesión para hacer pedidos{'\n'}y ver tu historial acá.
            </Text>
            <Button
              variant="accent"
              size="lg"
              className="mt-6"
              onPress={() => router.push('/(auth)/login')}
            >
              Iniciar sesión →
            </Button>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  if (isPending) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-paper">
        <ActivityIndicator color="#1A1530" size="small" />
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
