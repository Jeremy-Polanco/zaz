import { useCallback, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useAdminUsers, useCurrentUser, useDeleteUser } from '../../lib/queries'
import type { AdminUser, AdminUsersSubscriptionFilter, UserRole } from '../../lib/types'
import { Eyebrow, Hairline, SectionHead } from '../../components/ui'
import { UserAddressesPanel } from '../../components/UserAddressesPanel'

const ROLE_LABELS: Record<UserRole, string> = {
  client: 'Cliente',
  promoter: 'Promotor',
  seller: 'Vendedor',
  super_admin_delivery: 'Reparto',
}

const FILTERS: {
  label: string
  value: AdminUsersSubscriptionFilter | undefined
}[] = [
  { label: 'Todos', value: undefined },
  { label: 'Con suscripción', value: 'active' },
  { label: 'Sin suscripción', value: 'none' },
]

function SubscriptionBadge({ active }: { active: boolean }) {
  return (
    <View
      className={`border px-2 py-1 ${
        active ? 'border-ok/40 bg-ok/10' : 'border-ink/15 bg-ink/5'
      }`}
    >
      <Text
        className={`font-sans text-[10px] uppercase tracking-label ${
          active ? 'text-ok' : 'text-ink-muted'
        }`}
      >
        {active ? 'Activa' : 'Sin suscripción'}
      </Text>
    </View>
  )
}

function UserRow({
  item,
  isSelf,
  isDeleting,
  onDelete,
}: {
  item: AdminUser
  isSelf: boolean
  isDeleting: boolean
  onDelete: (user: AdminUser) => void
}) {
  const [expanded, setExpanded] = useState(false)
  return (
    <View className="border-b border-ink/10 py-4">
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1">
          <Text className="font-sans-semibold text-[18px] leading-[22px] text-ink">
            {item.fullName}
          </Text>
          <Text className="mt-0.5 font-sans text-[10px] uppercase tracking-label text-ink-muted">
            {item.phone ?? '—'} · {ROLE_LABELS[item.role]}
          </Text>
          {item.email ? (
            <Text className="mt-0.5 font-sans text-[14px] text-ink-soft" numberOfLines={1}>
              {item.email}
            </Text>
          ) : null}
        </View>
        <View className="items-end gap-2">
          <SubscriptionBadge active={item.hasActiveSubscription} />
          <Pressable onPress={() => setExpanded((v) => !v)} hitSlop={8}>
            <Text className="font-sans text-[10px] uppercase tracking-label text-brand">
              {expanded ? 'Ocultar' : 'Direcciones'}
            </Text>
          </Pressable>
          {/* Self-deletion is a 403 on DELETE /users/:id — the admin's own
              account is deleted from Perfil (DELETE /auth/me) instead. */}
          {isSelf ? (
            <Text className="font-sans text-[10px] uppercase tracking-label text-ink-muted/60">
              Vos
            </Text>
          ) : (
            <Pressable
              onPress={() => onDelete(item)}
              disabled={isDeleting}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`Eliminar la cuenta de ${item.fullName}`}
              accessibilityState={{ disabled: isDeleting }}
            >
              <Text
                className={`font-sans text-[10px] uppercase tracking-label ${
                  isDeleting ? 'text-bad/40' : 'text-bad'
                }`}
              >
                {isDeleting ? 'Eliminando…' : 'Eliminar'}
              </Text>
            </Pressable>
          )}
        </View>
      </View>
      {expanded ? (
        <View className="mt-3">
          <UserAddressesPanel userId={item.id} />
        </View>
      ) : null}
    </View>
  )
}

export default function SuperUsersScreen() {
  const [subFilter, setSubFilter] = useState<
    AdminUsersSubscriptionFilter | undefined
  >(undefined)
  const [search, setSearch] = useState('')

  const { data: users, isPending, refetch, isRefetching } = useAdminUsers(subFilter)
  const { data: me } = useCurrentUser()
  const deleteUser = useDeleteUser()
  const [deletingId, setDeletingId] = useState<string | null>(null)

  /**
   * Two-step confirmation before an irreversible delete. The web panel puts
   * the same friction behind a modal with an explicit "Eliminar
   * definitivamente" button — on mobile a single tap is far easier to fire by
   * accident, so the destructive action sits behind two taps.
   */
  const handleDelete = useCallback(
    (user: AdminUser) => {
      const run = async () => {
        setDeletingId(user.id)
        try {
          await deleteUser.mutateAsync(user.id)
        } catch (e) {
          Alert.alert(
            'Error',
            (e as { response?: { data?: { message?: string } } })?.response?.data
              ?.message ?? 'No se pudo eliminar el usuario.',
          )
        } finally {
          setDeletingId(null)
        }
      }

      Alert.alert(
        'Eliminar usuario',
        `Vas a eliminar a ${user.fullName}${user.phone ? ` (${user.phone})` : ''}. Se borran sus direcciones, suscripción, créditos y puntos. Sus pedidos se conservan anonimizados.`,
        [
          { text: 'Cancelar', style: 'cancel' },
          {
            text: 'Continuar',
            style: 'destructive',
            onPress: () =>
              Alert.alert(
                '¿Seguro?',
                'Esta acción es irreversible.',
                [
                  { text: 'Cancelar', style: 'cancel' },
                  {
                    text: 'Eliminar definitivamente',
                    style: 'destructive',
                    onPress: () => void run(),
                  },
                ],
              ),
          },
        ],
      )
    },
    [deleteUser],
  )

  const filtered = useMemo(() => {
    const list = users ?? []
    const q = search.trim().toLowerCase()
    if (!q) return list
    return list.filter(
      (u) =>
        u.fullName.toLowerCase().includes(q) ||
        (u.phone?.toLowerCase().includes(q) ?? false),
    )
  }, [users, search])

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
        automaticallyAdjustKeyboardInsets
        data={filtered}
        keyExtractor={(u) => u.id}
        contentContainerClassName="px-5 pb-12"
        refreshing={isRefetching}
        onRefresh={refetch}
        ListHeaderComponent={
          <View className="pb-2 pt-6">
            <SectionHead
              eyebrow="Panel · Usuarios"
              title="Usuarios"
              subtitle="Todos los usuarios y su estado de suscripción."
            />

            <TextInput
              className="mb-4 h-11 border border-ink/25 px-3 font-sans text-[15px] text-ink"
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
                  onPress={() => setSubFilter(f.value)}
                  className={`border px-3 py-1.5 ${
                    subFilter === f.value
                      ? 'border-ink bg-ink'
                      : 'border-ink/20 bg-paper'
                  }`}
                >
                  <Text
                    className={`font-sans text-[10px] uppercase tracking-label ${
                      subFilter === f.value ? 'text-paper' : 'text-ink-muted'
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
        renderItem={({ item }) => (
          <UserRow
            item={item}
            isSelf={me?.id === item.id}
            isDeleting={deletingId === item.id}
            onDelete={handleDelete}
          />
        )}
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
