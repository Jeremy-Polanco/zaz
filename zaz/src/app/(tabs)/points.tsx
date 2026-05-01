import { View, Text, FlatList, ActivityIndicator } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { usePointsBalance, usePointsHistory } from '../../lib/queries'
import { formatCents, formatDate } from '../../lib/format'
import type { PointsEntry } from '../../lib/types'
import { Eyebrow, Hairline } from '../../components/ui'

function SummaryCard({
  label,
  cents,
  accent,
}: {
  label: string
  cents: number
  accent?: boolean
}) {
  return (
    <View className="flex-1 border border-ink/15 bg-paper p-4">
      <Text className="font-sans text-[10px] uppercase tracking-label text-ink-muted">
        {label}
      </Text>
      <Text
        className={`mt-2 font-sans-semibold text-[26px] ${accent ? 'text-brand' : 'text-ink'}`}
        style={{ fontVariant: ['tabular-nums'] }}
      >
        {formatCents(cents)}
      </Text>
    </View>
  )
}

function EntryRow({ entry }: { entry: PointsEntry }) {
  const sign = entry.amountCents >= 0 ? '+' : '−'
  const abs = Math.abs(entry.amountCents)
  const statusLabel = (() => {
    if (entry.status === 'claimable') return 'Disponible'
    if (entry.status === 'pending') return 'Pendiente'
    if (entry.status === 'redeemed') return 'Canjeado'
    if (entry.status === 'expired') return 'Vencido'
    return entry.status
  })()
  const typeLabel =
    entry.type === 'earned'
      ? 'Ganado'
      : entry.type === 'redeemed'
      ? 'Canje'
      : 'Vencido'
  const amountColor =
    entry.status === 'expired'
      ? 'text-ink-muted'
      : entry.type === 'redeemed'
      ? 'text-brand'
      : 'text-ink'

  return (
    <View className="py-4">
      <View className="flex-row items-start justify-between">
        <View className="flex-1 pr-3">
          <Text className="font-sans text-[10px] uppercase tracking-label text-ink-muted">
            {formatDate(entry.createdAt)} · {typeLabel}
          </Text>
          <Text className="mt-1 font-sans-semibold text-[15px] text-ink">
            {statusLabel}
          </Text>
          {entry.status === 'pending' && entry.claimableAt && (
            <Text className="mt-1 font-sans text-[10px] uppercase tracking-label text-ink-muted">
              Disponible el {formatDate(entry.claimableAt)}
            </Text>
          )}
          {entry.status === 'claimable' && entry.expiresAt && (
            <Text className="mt-1 font-sans text-[10px] uppercase tracking-label text-ink-muted">
              Vence el {formatDate(entry.expiresAt)}
            </Text>
          )}
        </View>
        <Text
          className={`font-sans-semibold text-[18px] ${amountColor}`}
          style={{ fontVariant: ['tabular-nums'] }}
        >
          {sign}
          {formatCents(abs)}
        </Text>
      </View>
      <Hairline className="mt-4" />
    </View>
  )
}

export default function PointsTab() {
  const { data: balance, isPending: balancePending } = usePointsBalance()
  const { data: history, isPending: historyPending, refetch, isRefetching } =
    usePointsHistory()

  if (balancePending || historyPending) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-paper">
        <ActivityIndicator color="#220247" size="small" />
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-paper">
      <FlatList
        data={history ?? []}
        keyExtractor={(e) => e.id}
        contentContainerClassName="px-5 pb-8"
        ListHeaderComponent={
          <View className="pb-2 pt-6">
            <Eyebrow className="mb-3">Mis puntos</Eyebrow>
            <View className="flex-row flex-wrap items-baseline">
              <Text className="font-sans-semibold text-[40px] leading-[44px] text-ink">
                Puntos y{' '}
              </Text>
              <Text className="font-sans-italic text-[40px] leading-[44px] text-brand">
                canjes.
              </Text>
            </View>
            <Text className="mt-2 text-[13px] text-ink-soft">
              Ganas puntos en cada pedido entregado. Se activan a los 90 días y
              expiran a los 180.
            </Text>

            <View className="mt-6 flex-row gap-3">
              <SummaryCard
                label="Disponibles"
                cents={balance?.claimableCents ?? 0}
                accent={(balance?.claimableCents ?? 0) > 0}
              />
              <SummaryCard
                label="Pendientes"
                cents={balance?.pendingCents ?? 0}
              />
            </View>
            <View className="mt-3 flex-row gap-3">
              <SummaryCard
                label="Canjeados"
                cents={balance?.redeemedCents ?? 0}
              />
              <SummaryCard
                label="Vencidos"
                cents={balance?.expiredCents ?? 0}
              />
            </View>

            <Hairline className="mt-6" />
            <Eyebrow className="mt-6 mb-2">Historial</Eyebrow>
          </View>
        }
        renderItem={({ item }) => <EntryRow entry={item} />}
        ListEmptyComponent={
          <View className="items-center py-20">
            <Eyebrow>Sin movimientos</Eyebrow>
            <Text className="mt-3 text-center text-[15px] text-ink-soft">
              Cuando completes un pedido{'\n'}vas a ver tus puntos acá.
            </Text>
          </View>
        }
        refreshing={isRefetching}
        onRefresh={refetch}
      />
    </SafeAreaView>
  )
}
