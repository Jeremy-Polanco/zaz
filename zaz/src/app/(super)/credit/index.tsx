import { useMemo, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import {
  useAdminCreditAccounts,
  useUsers,
} from '../../../lib/queries'
import { formatCents, formatDate } from '../../../lib/format'
import type { CreditAccountStatus } from '../../../lib/types'
import { Eyebrow, Hairline, KpiCard, SectionHead } from '../../../components/ui'

type UserCreditRowData = {
  userId: string
  fullName: string
  phone: string | null
  role: string
  balanceCents: number | null
  dueDate: string | null
  status: CreditAccountStatus
}

const STATUS_LABELS: Record<CreditAccountStatus, string> = {
  none: 'Sin cuenta',
  active: 'Al día',
  overdue: 'Vencido',
}

const STATUS_COLOR: Record<CreditAccountStatus, string> = {
  none: 'text-ink-muted',
  active: 'text-green-700',
  overdue: 'text-red-600',
}

function UserCreditRow({ item }: { item: UserCreditRowData }) {
  const balance = item.balanceCents
  const hasAccount = balance !== null
  const isNegative = hasAccount && balance < 0

  return (
    <Pressable
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onPress={() => router.push(`/(super)/credit/${item.userId}` as any)}
      className="border-b border-ink/10 py-4 active:bg-ink/5"
    >
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1">
          <Text className="font-sans-semibold text-[18px] leading-[22px] text-ink">
            {item.fullName}
          </Text>
          <Text className="mt-0.5 font-sans text-[10px] uppercase tracking-label text-ink-muted">
            {item.phone ?? '—'} · {item.role}
          </Text>
          {item.dueDate && (
            <Text className="mt-0.5 font-sans text-[10px] uppercase tracking-label text-ink-muted">
              Vence: {formatDate(item.dueDate)}
            </Text>
          )}
        </View>
        <View className="items-end">
          {hasAccount ? (
            <Text
              className={`font-sans-semibold text-[18px] ${isNegative ? 'text-red-600' : 'text-ink'}`}
              style={{ fontVariant: ['tabular-nums'] }}
            >
              {formatCents(balance)}
            </Text>
          ) : (
            <Text className="font-sans text-[14px] text-ink-muted">—</Text>
          )}
          <Text className={`font-sans text-[10px] uppercase tracking-label ${STATUS_COLOR[item.status]}`}>
            {STATUS_LABELS[item.status]}
          </Text>
        </View>
      </View>
    </Pressable>
  )
}

const FILTERS: Array<{ label: string; value: CreditAccountStatus | undefined }> = [
  { label: 'Todos', value: undefined },
  { label: 'Sin cuenta', value: 'none' },
  { label: 'Al día', value: 'active' },
  { label: 'Vencidos', value: 'overdue' },
]

export default function SuperCreditListScreen() {
  const [statusFilter, setStatusFilter] = useState<CreditAccountStatus | undefined>(undefined)
  const [search, setSearch] = useState('')

  const {
    data: allUsers,
    isPending: usersPending,
    refetch: refetchUsers,
    isRefetching: refetchingUsers,
  } = useUsers()
  const {
    data: allAccounts,
    refetch: refetchAccounts,
    isRefetching: refetchingAccounts,
  } = useAdminCreditAccounts({ pageSize: 1000 })

  const merged = useMemo<UserCreditRowData[]>(() => {
    if (!allUsers) return []
    const accountByUserId = new Map(
      (allAccounts?.items ?? []).map((a) => [a.userId, a]),
    )
    return allUsers.map((u) => {
      const account = accountByUserId.get(u.id)
      return {
        userId: u.id,
        fullName: u.fullName,
        phone: u.phone,
        role: u.role,
        balanceCents: account?.balanceCents ?? null,
        dueDate: account?.dueDate ?? null,
        status: account?.status ?? 'none',
      }
    })
  }, [allUsers, allAccounts?.items])

  const filtered = useMemo(() => {
    let list = merged
    if (statusFilter !== undefined) {
      list = list.filter((u) => u.status === statusFilter)
    }
    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter(
        (u) =>
          u.fullName.toLowerCase().includes(q) ||
          (u.phone?.toLowerCase().includes(q) ?? false),
      )
    }
    return list
  }, [merged, statusFilter, search])

  const handleRefresh = () => {
    refetchUsers()
    refetchAccounts()
  }

  if (usersPending) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-paper">
        <ActivityIndicator color="#220247" size="small" />
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-paper">
      <FlatList
        data={filtered}
        keyExtractor={(u) => u.userId}
        contentContainerClassName="px-5 pb-12"
        refreshing={refetchingUsers || refetchingAccounts}
        onRefresh={handleRefresh}
        ListHeaderComponent={
          <View className="pb-2 pt-6">
            <SectionHead
              eyebrow="Panel · Crédito fiado"
              title="Crédito"
              italicTail="fiado."
              subtitle="Toca un usuario para gestionar su crédito."
            />

            <View className="mb-5 flex-row gap-2">
              <KpiCard
                label="Cuentas"
                value={merged.filter((r) => r.status !== 'none').length}
                tone="idle"
              />
              <KpiCard
                label="Al día"
                value={merged.filter((r) => r.status === 'active').length}
                tone="ok"
              />
              <KpiCard
                label="Vencidas"
                value={merged.filter((r) => r.status === 'overdue').length}
                tone="warn"
              />
            </View>

            <TextInput
              className="mb-4 mt-4 h-11 border border-ink/25 px-3 font-sans text-[15px] text-ink"
              placeholder="Buscar por nombre o teléfono…"
              placeholderTextColor="#6B6488"
              value={search}
              onChangeText={setSearch}
              autoCapitalize="none"
            />

            <View className="mb-4 flex-row flex-wrap gap-2">
              {FILTERS.map((f) => (
                <Pressable
                  key={f.label}
                  onPress={() => setStatusFilter(f.value)}
                  className={`border px-3 py-1.5 ${
                    statusFilter === f.value
                      ? 'border-ink bg-ink'
                      : 'border-ink/20 bg-paper'
                  }`}
                >
                  <Text
                    className={`font-sans text-[10px] uppercase tracking-label ${
                      statusFilter === f.value ? 'text-paper' : 'text-ink-muted'
                    }`}
                  >
                    {f.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text className="mb-2 font-sans text-[10px] uppercase tracking-label text-ink-muted">
              {filtered.length} usuario{filtered.length !== 1 ? 's' : ''}
            </Text>
            <Hairline />
          </View>
        }
        renderItem={({ item }) => <UserCreditRow item={item} />}
        ListEmptyComponent={
          <View className="items-center py-16">
            <Eyebrow>Sin resultados</Eyebrow>
            <Text className="mt-3 text-center text-[15px] text-ink-soft">
              No hay usuarios que coincidan.
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  )
}
