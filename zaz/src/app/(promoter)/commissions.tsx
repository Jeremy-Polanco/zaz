import { useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { usePromoterCommissions } from '../../lib/queries'
import type {
  PromoterCommissionEntry,
  PromoterCommissionEntryStatus,
} from '../../lib/types'
import { formatCents, formatDate } from '../../lib/format'
import { Button, Eyebrow, SectionHead } from '../../components/ui'

type FilterValue = PromoterCommissionEntryStatus | 'all'

const FILTERS: { label: string; value: FilterValue }[] = [
  { label: 'Todas', value: 'all' },
  { label: 'Disponibles', value: 'claimable' },
  { label: 'Pendientes', value: 'pending' },
  { label: 'Pagadas', value: 'paid' },
]

function Chip({
  active,
  label,
  onPress,
}: {
  active: boolean
  label: string
  onPress: () => void
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`px-3 py-1.5 ${
        active ? 'bg-accent' : 'border border-ink/15 bg-transparent active:bg-ink/5'
      }`}
    >
      <Text
        className={`font-sans-medium text-[10px] uppercase tracking-label ${
          active ? 'text-brand-dark' : 'text-ink-soft'
        }`}
      >
        {label}
      </Text>
    </Pressable>
  )
}

function statusDot(e: PromoterCommissionEntry): string {
  if (e.type === 'paid_out') return 'bg-ok'
  if (e.status === 'pending') return 'bg-warn'
  if (e.status === 'claimable') return 'bg-brand'
  if (e.status === 'paid') return 'bg-ok'
  return 'bg-ink-muted'
}

function statusLabel(e: PromoterCommissionEntry): string {
  if (e.type === 'paid_out') return 'Pago recibido'
  if (e.status === 'pending') return 'Pendiente'
  if (e.status === 'claimable') return 'Disponible'
  if (e.status === 'paid') return 'Pagada'
  return e.status
}

function CommissionRow({ entry }: { entry: PromoterCommissionEntry }) {
  const negative = entry.amountCents < 0
  return (
    <View className="border-b border-ink/10 py-4">
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1 flex-row items-start gap-2.5">
          <View className={`mt-2 h-1.5 w-1.5 rounded-full ${statusDot(entry)}`} />
          <View className="flex-1">
            <Text className="font-sans-semibold text-[15px] text-ink">
              {statusLabel(entry)}
            </Text>
            <Text className="mt-0.5 font-sans text-[10px] uppercase tracking-label text-ink-muted">
              {formatDate(entry.createdAt)}
            </Text>
            {entry.referredUserName ? (
              <Text className="mt-1 text-[13px] text-ink-muted">
                de{' '}
                <Text className="font-medium text-ink">
                  {entry.referredUserName}
                </Text>
              </Text>
            ) : null}
            {entry.status === 'pending' && entry.claimableAt ? (
              <Text className="mt-1 font-sans text-[10px] uppercase tracking-label text-ink-muted">
                Vesta {formatDate(entry.claimableAt)}
              </Text>
            ) : null}
          </View>
        </View>
        <Text
          className={`font-sans-semibold text-[16px] ${
            negative ? 'text-bad' : 'text-ink'
          }`}
          style={{ fontVariant: ['tabular-nums'] }}
        >
          {negative ? '−' : '+'}
          {formatCents(Math.abs(entry.amountCents))}
        </Text>
      </View>
    </View>
  )
}

export default function PromoterCommissionsScreen() {
  const [filter, setFilter] = useState<FilterValue>('all')
  const [page, setPage] = useState(1)

  const { data, isPending, refetch, isRefetching } = usePromoterCommissions({
    status: filter === 'all' ? undefined : filter,
    page,
    pageSize: 25,
  })

  const items = data?.items ?? []

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-paper">
      <View className="px-5 pt-6">
        <SectionHead
          eyebrow="Comisiones"
          title="Mis"
          italicTail="comisiones."
          subtitle="Historial completo de lo que ganaste."
        />

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerClassName="gap-2 pb-4"
        >
          {FILTERS.map((f) => (
            <Chip
              key={f.value}
              active={filter === f.value}
              label={f.label}
              onPress={() => {
                setFilter(f.value)
                setPage(1)
              }}
            />
          ))}
        </ScrollView>
      </View>

      {isPending ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#220247" size="small" />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(e) => e.id}
          contentContainerClassName="px-5 pb-12"
          refreshing={isRefetching}
          onRefresh={refetch}
          renderItem={({ item }) => <CommissionRow entry={item} />}
          ListEmptyComponent={
            <View className="items-center py-16">
              <Eyebrow>Sin movimientos</Eyebrow>
              <Text className="mt-3 text-center text-[14px] text-ink-muted">
                Todavía no hay comisiones para este filtro.
              </Text>
            </View>
          }
          ListFooterComponent={
            data && data.totalPages > 1 ? (
              <View className="mt-6 flex-row items-center justify-between border-t border-ink/10 pt-4">
                <Text className="font-sans text-[10px] uppercase tracking-label text-ink-muted">
                  Página {data.page} de {data.totalPages} · {data.totalCount}
                </Text>
                <View className="flex-row gap-2">
                  <Button
                    variant="outline"
                    disabled={data.page <= 1}
                    onPress={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    ← Ant
                  </Button>
                  <Button
                    variant="outline"
                    disabled={data.page >= data.totalPages}
                    onPress={() =>
                      setPage((p) => Math.min(data.totalPages, p + 1))
                    }
                  >
                    Sig →
                  </Button>
                </View>
              </View>
            ) : null
          }
        />
      )}
    </SafeAreaView>
  )
}
