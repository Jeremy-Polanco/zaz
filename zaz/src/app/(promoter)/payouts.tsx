import {
  ActivityIndicator,
  FlatList,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useMyPayouts } from '../../lib/queries'
import type { Payout } from '../../lib/types'
import { formatCents, formatDate } from '../../lib/format'
import { Eyebrow, KpiCard, SectionHead } from '../../components/ui'

function PayoutRow({ payout }: { payout: Payout }) {
  return (
    <View className="border-b border-ink/10 py-4">
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1">
          <Text
            className="font-sans text-[18px] font-semibold text-brand"
            style={{ fontVariant: ['tabular-nums'] }}
          >
            {formatCents(payout.amountCents)}
          </Text>
          <Text className="mt-0.5 font-sans text-[10px] uppercase tracking-label text-ink-muted">
            {formatDate(payout.createdAt)}
          </Text>
          {payout.notes ? (
            <Text className="mt-2 text-[13px] text-ink">
              “{payout.notes}”
            </Text>
          ) : null}
          {payout.createdBy ? (
            <Text className="mt-1 font-sans text-[10px] uppercase tracking-label text-ink-muted">
              Emitido por {payout.createdBy.fullName}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  )
}

export default function PromoterPayoutsScreen() {
  const { data: payouts, isPending, refetch, isRefetching } = useMyPayouts()
  const list = payouts ?? []
  const total = list.reduce((sum, p) => sum + p.amountCents, 0)

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-paper">
      {isPending ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#220247" size="small" />
        </View>
      ) : (
        <FlatList
          data={list}
          keyExtractor={(p) => p.id}
          contentContainerClassName="px-5 pb-12"
          refreshing={isRefetching}
          onRefresh={refetch}
          ListHeaderComponent={
            <View className="pt-6">
              <SectionHead
                eyebrow="Pagos"
                title="Mis"
                italicTail="pagos."
                subtitle="Cada vez que el admin te paga, queda registrado acá."
              />

              <View className="mb-6 flex-row gap-2">
                <KpiCard
                  label="Total recibido"
                  value={formatCents(total)}
                  tone="ok"
                />
                <KpiCard label="Pagos" value={list.length} tone="idle" />
              </View>

              <Eyebrow className="mb-2">Historial</Eyebrow>
            </View>
          }
          renderItem={({ item }) => <PayoutRow payout={item} />}
          ListEmptyComponent={
            <View className="items-center py-16">
              <Eyebrow>Sin pagos todavía</Eyebrow>
              <Text className="mt-3 text-center text-[14px] text-ink-muted">
                Cuando recibas un pago, aparecerá acá.
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  )
}
