import { View, Text, FlatList, ActivityIndicator } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Stack } from 'expo-router'
import { Image } from 'expo-image'
import { useMyRentals } from '../../lib/queries'
import { formatCents, formatDate } from '../../lib/format'
import { productImageUrl } from '../../lib/api'
import type { Rental, RentalStatus } from '../../lib/types'

// ─── Status badge config ──────────────────────────────────────────────────────

type BadgeConfig = {
  label: string
  bgClass: string
  textClass: string
}

const STATUS_BADGE: Record<RentalStatus, BadgeConfig> = {
  active: {
    label: 'Activo',
    bgClass: 'bg-green-100',
    textClass: 'text-green-800',
  },
  past_due: {
    label: 'Atrasado',
    bgClass: 'bg-orange-100',
    textClass: 'text-orange-800',
  },
  unpaid: {
    label: 'Sin pagar',
    bgClass: 'bg-red-100',
    textClass: 'text-red-800',
  },
  canceled: {
    label: 'Cancelado',
    bgClass: 'bg-stone-100',
    textClass: 'text-stone-500',
  },
  pending_setup: {
    label: 'Pendiente',
    bgClass: 'bg-blue-100',
    textClass: 'text-blue-800',
  },
}

// ─── Rental card ─────────────────────────────────────────────────────────────

function RentalCard({ rental }: { rental: Rental }) {
  const badge = STATUS_BADGE[rental.status]
  const hasImage = !!rental.productImageUrl

  return (
    <View className="border-b border-ink/10 py-4">
      <View className="flex-row items-start gap-4">
        {/* Product image */}
        <View className="h-16 w-16 overflow-hidden border border-ink/15 bg-paper-deep">
          {hasImage ? (
            <Image
              source={{ uri: rental.productImageUrl! }}
              style={{ width: '100%', height: '100%' }}
              contentFit="cover"
            />
          ) : (
            <View className="flex-1 items-center justify-center">
              <Text className="font-sans-semibold text-[11px] uppercase tracking-label text-ink-muted">
                {rental.productName.slice(0, 3)}
              </Text>
            </View>
          )}
        </View>

        {/* Details */}
        <View className="flex-1">
          <View className="flex-row items-start justify-between gap-2">
            <Text
              className="flex-1 font-sans-semibold text-[16px] leading-[20px] text-ink"
              numberOfLines={2}
            >
              {rental.productName}
            </Text>
            {/* Status badge */}
            <View className={`rounded-sm px-2 py-0.5 ${badge.bgClass}`}>
              <Text className={`font-sans-medium text-[11px] ${badge.textClass}`}>
                {badge.label}
              </Text>
            </View>
          </View>

          <Text
            className="mt-1 font-sans-semibold text-[15px] text-brand"
            style={{ fontVariant: ['tabular-nums'] }}
          >
            {formatCents(rental.monthlyRentCents)}/mes
          </Text>

          {rental.nextChargeAt && (
            <Text className="mt-1 font-sans text-[12px] text-ink-soft">
              Próximo cargo: {formatDate(rental.nextChargeAt)}
            </Text>
          )}
        </View>
      </View>
    </View>
  )
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function RentalsIndex() {
  const { data: rentals, isPending } = useMyRentals()

  if (isPending) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-paper">
        <Stack.Screen options={{ title: 'Mis alquileres' }} />
        <ActivityIndicator color="#220247" size="small" />
      </SafeAreaView>
    )
  }

  const list = rentals ?? []

  return (
    <SafeAreaView edges={['bottom']} className="flex-1 bg-paper">
      <Stack.Screen options={{ title: 'Mis alquileres' }} />

      {list.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="font-sans text-[10px] uppercase tracking-eyebrow text-ink-muted">
            Sin alquileres
          </Text>
          <Text className="mt-3 text-center text-[16px] text-ink-soft">
            No tienes alquileres activos.
          </Text>
          <Text className="mt-1 text-center text-[13px] text-ink-muted">
            Cuando alquiles un producto, lo verás aquí.
          </Text>
        </View>
      ) : (
        <FlatList
          data={list}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <RentalCard rental={item} />}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
        />
      )}
    </SafeAreaView>
  )
}
