import { ActivityIndicator, FlatList, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Image } from 'expo-image'
import { router } from 'expo-router'
import { useMyRentals } from '../../lib/queries'
import { formatCents, formatDate } from '../../lib/format'
import { API_URL } from '../../lib/api'
import type { Rental, RentalStatus } from '../../lib/types'
import { Button, Eyebrow, SectionHead } from '../../components/ui'

const STATUS_META: Record<
  RentalStatus,
  { label: string; box: string; text: string }
> = {
  active: { label: 'Activo', box: 'border-ok/40 bg-ok/10', text: 'text-ok' },
  past_due: { label: 'Atrasado', box: 'border-warn/40 bg-warn/10', text: 'text-warn' },
  unpaid: { label: 'Sin pagar', box: 'border-bad/40 bg-bad/10', text: 'text-bad' },
  canceled: { label: 'Cancelado', box: 'border-ink/15 bg-paper-deep', text: 'text-ink-muted' },
  pending_setup: { label: 'Pendiente', box: 'border-ink/20 bg-ink/5', text: 'text-ink-muted' },
}

function resolveImageUri(url: string | null): string | null {
  if (!url) return null
  return url.startsWith('http') ? url : `${API_URL}${url}`
}

function RentalCard({ rental }: { rental: Rental }) {
  const meta = STATUS_META[rental.status]
  const imageUri = resolveImageUri(rental.productImageUrl)
  return (
    <View className="flex-row gap-4 border border-ink/15 bg-paper p-4">
      <View className="h-16 w-16 shrink-0 overflow-hidden border border-ink/10 bg-paper-deep">
        {imageUri ? (
          <Image
            source={{ uri: imageUri }}
            style={{ width: '100%', height: '100%' }}
            contentFit="cover"
          />
        ) : (
          <View className="h-full w-full items-center justify-center px-1">
            <Text
              className="text-center font-sans text-[9px] uppercase tracking-label text-ink-muted"
              numberOfLines={3}
            >
              {rental.productName.slice(0, 18)}
            </Text>
          </View>
        )}
      </View>
      <View className="min-w-0 flex-1">
        <View className="flex-row items-start justify-between gap-3">
          <Text className="flex-1 font-sans-medium text-[16px] leading-[20px] text-ink" numberOfLines={2}>
            {rental.productName}
          </Text>
          <View className={`shrink-0 border px-2 py-1 ${meta.box}`}>
            <Text className={`font-sans text-[10px] uppercase tracking-label ${meta.text}`}>
              {meta.label}
            </Text>
          </View>
        </View>
        <Text
          className="mt-1 font-sans-semibold text-[18px] text-brand"
          style={{ fontVariant: ['tabular-nums'] }}
        >
          {formatCents(rental.monthlyRentCents)}
          <Text className="font-sans text-[13px] text-ink-muted">/mes</Text>
        </Text>
        {rental.nextChargeAt ? (
          <Text className="mt-1 font-sans text-[10px] uppercase tracking-label text-ink-muted">
            Próximo cargo: {formatDate(rental.nextChargeAt)}
          </Text>
        ) : null}
        {rental.status === 'pending_setup' ? (
          <Text className="mt-2 border-l-2 border-accent pl-3 font-sans text-[13px] text-ink-soft">
            Estamos terminando de configurar tu alquiler. Te avisamos cuando esté
            activo.
          </Text>
        ) : null}
      </View>
    </View>
  )
}

export default function RentalsTab() {
  const { data: rentals, isPending, refetch, isRefetching } = useMyRentals()

  if (isPending) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-paper">
        <ActivityIndicator color="#1A1530" size="small" />
      </SafeAreaView>
    )
  }

  const list = rentals ?? []

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-paper">
      <FlatList
        data={list}
        keyExtractor={(r) => r.id}
        contentContainerClassName="px-5 pb-12"
        ItemSeparatorComponent={() => <View className="h-3" />}
        refreshing={isRefetching}
        onRefresh={refetch}
        ListHeaderComponent={
          <View className="pb-4 pt-6">
            <SectionHead
              eyebrow="Mi cuenta"
              title="Mis"
              italicTail="alquileres."
              subtitle="Equipos que alquilás mes a mes."
            />
          </View>
        }
        renderItem={({ item }) => <RentalCard rental={item} />}
        ListEmptyComponent={
          <View className="items-center py-16">
            <Eyebrow>Sin alquileres</Eyebrow>
            <Text className="mt-3 text-center text-[15px] text-ink-soft">
              No tienes alquileres activos.{'\n'}Cuando alquiles un producto, lo
              verás aquí.
            </Text>
            <View className="mt-6">
              <Button variant="outline" size="md" onPress={() => router.push('/(tabs)/catalog')}>
                Ver catálogo →
              </Button>
            </View>
          </View>
        }
      />
    </SafeAreaView>
  )
}
