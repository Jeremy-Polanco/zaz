import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import {
  useAdminUsers,
  useCurrentUser,
  useDeleteUser,
  useTransferSellerPortfolio,
  useUpdateUserAdmin,
} from '../../lib/queries'
import type { AdminUser, AdminUsersSubscriptionFilter, UserRole } from '../../lib/types'
import { Button, Eyebrow, Hairline, SectionHead } from '../../components/ui'
import { UserAddressesPanel } from '../../components/UserAddressesPanel'
import { SellerCatalogPanel } from '../../components/SellerCatalogPanel'
import { isSuperAdmin } from '../../lib/roles'

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

/**
 * Roles asignables desde el panel. `super_admin_delivery` NO está: se
 * provisiona por bootstrap/consola a propósito, así una sesión de admin robada
 * no puede fabricar otro admin. El backend lo rechaza igual.
 */
const ASSIGNABLE_ROLES: UserRole[] = ['client', 'seller', 'promoter']

function UserRow({
  item,
  isSelf,
  isDeleting,
  onDelete,
  canEditRole,
  onChangeRole,
  sellers,
  onAssignSeller,
  promoters,
  onAssignPromoter,
  pendingUpdate,
}: {
  item: AdminUser
  isSelf: boolean
  isDeleting: boolean
  onDelete: (user: AdminUser) => void
  canEditRole: boolean
  onChangeRole: (user: AdminUser, role: UserRole) => void
  sellers: AdminUser[]
  onAssignSeller: (user: AdminUser, sellerId: string | null) => void
  promoters: AdminUser[]
  onAssignPromoter: (user: AdminUser, referredById: string | null) => void
  pendingUpdate: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const [catalogOpen, setCatalogOpen] = useState(false)
  // Un super admin no se edita desde acá — ni a sí mismo (perdería el panel sin
  // forma de volver) ni a otro.
  const editable =
    canEditRole && !isSelf && item.role !== 'super_admin_delivery'
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
          {canEditRole && item.role === 'seller' ? (
            <Pressable onPress={() => setCatalogOpen((v) => !v)} hitSlop={8}>
              <Text className="font-sans text-[10px] uppercase tracking-label text-brand">
                {catalogOpen ? 'Ocultar' : 'Catálogo'}
              </Text>
            </Pressable>
          ) : null}
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
      {editable ? (
        <View className="mt-3 gap-2">
          <View className="flex-row flex-wrap items-center gap-2">
            <Text className="font-sans text-[10px] uppercase tracking-label text-ink-muted">
              Rol
            </Text>
            {ASSIGNABLE_ROLES.map((r) => (
              <Pressable
                key={r}
                onPress={() => onChangeRole(item, r)}
                disabled={pendingUpdate || r === item.role}
                accessibilityRole="button"
                accessibilityLabel={`Poner a ${item.fullName} como ${ROLE_LABELS[r]}`}
                className={`border px-2 py-1 ${
                  r === item.role
                    ? 'border-brand bg-brand/10'
                    : 'border-ink/15 bg-paper'
                }`}
              >
                <Text
                  className={`font-sans text-[11px] ${
                    r === item.role ? 'text-brand' : 'text-ink-muted'
                  }`}
                >
                  {ROLE_LABELS[r]}
                </Text>
              </Pressable>
            ))}
          </View>

          {item.role !== 'seller' && sellers.length > 0 ? (
            <View className="flex-row flex-wrap items-center gap-2">
              <Text className="font-sans text-[10px] uppercase tracking-label text-ink-muted">
                Vendedor
              </Text>
              {/* "Sin vendedor" y "tiene uno que no puedo nombrar" son estados
                  distintos. Si el asignado no está en el padrón, se dice — no
                  se lo pinta como libre. */}
              {item.sellerId != null &&
              !sellers.some((s) => s.id === item.sellerId) ? (
                <View className="border border-accent-dark bg-accent-light px-2 py-1">
                  <Text className="font-sans text-[11px] text-ink">
                    Asignado (fuera de la lista)
                  </Text>
                </View>
              ) : null}
              <Pressable
                onPress={() => onAssignSeller(item, null)}
                disabled={pendingUpdate || item.sellerId == null}
                accessibilityRole="button"
                accessibilityLabel={`Dejar a ${item.fullName} sin vendedor`}
                className={`border px-2 py-1 ${
                  item.sellerId == null
                    ? 'border-brand bg-brand/10'
                    : 'border-ink/15 bg-paper'
                }`}
              >
                <Text
                  className={`font-sans text-[11px] ${
                    item.sellerId == null ? 'text-brand' : 'text-ink-muted'
                  }`}
                >
                  Sin asignar
                </Text>
              </Pressable>
              {sellers.map((sel) => (
                <Pressable
                  key={sel.id}
                  onPress={() => onAssignSeller(item, sel.id)}
                  disabled={pendingUpdate || item.sellerId === sel.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Asignarle ${item.fullName} al vendedor ${sel.fullName}`}
                  className={`border px-2 py-1 ${
                    item.sellerId === sel.id
                      ? 'border-brand bg-brand/10'
                      : 'border-ink/15 bg-paper'
                  }`}
                >
                  <Text
                    className={`font-sans text-[11px] ${
                      item.sellerId === sel.id ? 'text-brand' : 'text-ink-muted'
                    }`}
                  >
                    {sel.fullName}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {/* Atribución de comisiones. Hasta ahora `referredById` solo se
              escribía UNA vez, en el alta, desde el link de referido del
              promotor: a un cliente ya registrado no había forma de pasárselo
              a nadie. Espejo de la web. */}
          {item.role !== 'seller' &&
          item.role !== 'promoter' &&
          promoters.length > 0 ? (
            <View className="flex-row flex-wrap items-center gap-2">
              <Text className="font-sans text-[10px] uppercase tracking-label text-ink-muted">
                Promotor
              </Text>
              {/* "Sin promotor" y "tiene uno que no puedo nombrar" son estados
                  distintos: pintar como libre a un cliente que ya le genera
                  comisión a alguien es dato falso, no una limitación. */}
              {item.referredById != null &&
              !promoters.some((p) => p.id === item.referredById) ? (
                <View className="border border-accent-dark bg-accent-light px-2 py-1">
                  <Text className="font-sans text-[11px] text-ink">
                    Asignado (fuera de la lista)
                  </Text>
                </View>
              ) : null}
              <Pressable
                onPress={() => onAssignPromoter(item, null)}
                disabled={pendingUpdate || item.referredById == null}
                accessibilityRole="button"
                accessibilityLabel={`Dejar a ${item.fullName} sin promotor`}
                className={`border px-2 py-1 ${
                  item.referredById == null
                    ? 'border-brand bg-brand/10'
                    : 'border-ink/15 bg-paper'
                }`}
              >
                <Text
                  className={`font-sans text-[11px] ${
                    item.referredById == null ? 'text-brand' : 'text-ink-muted'
                  }`}
                >
                  Sin promotor
                </Text>
              </Pressable>
              {promoters.map((pro) => (
                <Pressable
                  key={pro.id}
                  onPress={() => onAssignPromoter(item, pro.id)}
                  disabled={pendingUpdate || item.referredById === pro.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Atribuir ${item.fullName} al promotor ${pro.fullName}`}
                  className={`border px-2 py-1 ${
                    item.referredById === pro.id
                      ? 'border-brand bg-brand/10'
                      : 'border-ink/15 bg-paper'
                  }`}
                >
                  <Text
                    className={`font-sans text-[11px] ${
                      item.referredById === pro.id
                        ? 'text-brand'
                        : 'text-ink-muted'
                    }`}
                  >
                    {pro.fullName}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
      {catalogOpen ? (
        <View className="mt-3">
          <SellerCatalogPanel sellerId={item.id} sellerName={item.fullName} />
        </View>
      ) : null}
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
  // Filtro por vendedor: 'all' (todos), 'none' (sin vendedor) o el id de un
  // vendedor concreto. Solo lo ve/usa el super admin — mismo gate que los
  // chips de asignación por fila.
  const [sellerFilter, setSellerFilter] = useState<'all' | 'none' | string>(
    'all',
  )

  const { data: users, isPending, refetch, isRefetching } = useAdminUsers(subFilter)
  const { data: me } = useCurrentUser()
  const deleteUser = useDeleteUser()
  const updateUser = useUpdateUserAdmin()
  const transferPortfolio = useTransferSellerPortfolio()
  // Solo el super admin toca roles y cartera. Un vendedor entra a esta pantalla
  // (ve sus clientes) pero no puede reasignar. La API lo rechaza igual.
  const canEditRole = isSuperAdmin(me?.role)
  // El padrón de vendedores sale de la lista SIN filtrar, no de `users`. Si se
  // derivara de la filtrada, con un filtro de suscripción puesto los vendedores
  // no suscriptos desaparecerían de las opciones. Espejo de la web.
  const { data: allUsers } = useAdminUsers(undefined)
  const sellers = useMemo(
    () => (allUsers ?? []).filter((u) => u.role === 'seller'),
    [allUsers],
  )
  // Mismo motivo: el padrón de promotores también sale de la lista sin filtrar.
  const promoters = useMemo(
    () => (allUsers ?? []).filter((u) => u.role === 'promoter'),
    [allUsers],
  )
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // Cartera COMPLETA del vendedor filtrado — ignora `search` a propósito. El
  // endpoint de transferencia mueve TODOS los clientes de ese vendedor en el
  // server (no una lista de ids elegida a mano), así que "Pasar N clientes"
  // no puede depender de lo que haya tipeado en el buscador.
  const sellerPortfolio = useMemo(() => {
    if (sellerFilter === 'all' || sellerFilter === 'none') return []
    return (users ?? []).filter((u) => u.sellerId === sellerFilter)
  }, [users, sellerFilter])
  const activeSeller = useMemo(
    () => sellers.find((s) => s.id === sellerFilter) ?? null,
    [sellers, sellerFilter],
  )
  // undefined = todavía no eligió destino (no se muestra el botón de
  // confirmar); null = "Sin vendedor" es el destino elegido.
  const [transferDestination, setTransferDestination] = useState<
    string | null | undefined
  >(undefined)
  const transferDestinationLabel =
    transferDestination === undefined
      ? null
      : transferDestination === null
        ? 'Sin vendedor'
        : sellers.find((s) => s.id === transferDestination)?.fullName ??
          'otro vendedor'
  const [transferError, setTransferError] = useState<string | null>(null)
  const [transferSuccessMessage, setTransferSuccessMessage] = useState<
    string | null
  >(null)
  const transferMessageTimeout = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  )
  useEffect(() => {
    return () => {
      if (transferMessageTimeout.current)
        clearTimeout(transferMessageTimeout.current)
    }
  }, [])
  // Cambiar de vendedor filtrado arranca la elección de destino de cero.
  useEffect(() => {
    setTransferDestination(undefined)
    setTransferError(null)
  }, [sellerFilter])

  const handleTransferPortfolio = useCallback(() => {
    if (sellerFilter === 'all' || sellerFilter === 'none') return
    if (transferDestination === undefined || !transferDestinationLabel) return
    const fromName = activeSeller?.fullName ?? 'este vendedor'
    const n = sellerPortfolio.length
    Alert.alert(
      'Reasignar cartera',
      `¿Pasar ${n} cliente${n === 1 ? '' : 's'} de ${fromName} a ${transferDestinationLabel}?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Confirmar',
          onPress: () =>
            transferPortfolio.mutate(
              { sellerId: sellerFilter, toSellerId: transferDestination },
              {
                onSuccess: (data) => {
                  setTransferError(null)
                  const moved = data.moved
                  setTransferSuccessMessage(
                    `Se pasaron ${moved} cliente${moved === 1 ? '' : 's'} a ${transferDestinationLabel}`,
                  )
                  if (transferMessageTimeout.current)
                    clearTimeout(transferMessageTimeout.current)
                  transferMessageTimeout.current = setTimeout(
                    () => setTransferSuccessMessage(null),
                    2000,
                  )
                  setSellerFilter(transferDestination ?? 'none')
                },
                onError: (e) => {
                  const msg =
                    (e as { response?: { data?: { message?: string } } })
                      ?.response?.data?.message ??
                    'No se pudo reasignar la cartera.'
                  setTransferError(msg)
                },
              },
            ),
        },
      ],
    )
  }, [
    sellerFilter,
    transferDestination,
    transferDestinationLabel,
    activeSeller,
    sellerPortfolio,
    transferPortfolio,
  ])

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

  // Lista chica y sin paginar (igual que `search`, ya filtrado en cliente):
  // el filtro por vendedor se resuelve acá también — solo la transferencia
  // en sí pega contra el server (POST /users/sellers/:id/transfer).
  const filtered = useMemo(() => {
    const list = users ?? []
    const q = search.trim().toLowerCase()
    return list.filter((u) => {
      if (
        q &&
        !(
          u.fullName.toLowerCase().includes(q) ||
          (u.phone?.toLowerCase().includes(q) ?? false)
        )
      )
        return false
      if (sellerFilter === 'none') return u.sellerId == null
      if (sellerFilter !== 'all') return u.sellerId === sellerFilter
      return true
    })
  }, [users, search, sellerFilter])

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

            {/* Filtro por vendedor — solo el super admin lo ve/usa, mismo
                gate que los chips de asignación por fila. */}
            {canEditRole ? (
              <View className="mb-4">
                <Text className="mb-2 font-sans text-[10px] uppercase tracking-label text-ink-muted">
                  Vendedor
                </Text>
                <View className="flex-row flex-wrap gap-2">
                  <Pressable
                    onPress={() => setSellerFilter('all')}
                    accessibilityRole="button"
                    accessibilityLabel="Ver clientes de todos los vendedores"
                    className={`border px-3 py-1.5 ${
                      sellerFilter === 'all'
                        ? 'border-ink bg-ink'
                        : 'border-ink/20 bg-paper'
                    }`}
                  >
                    <Text
                      className={`font-sans text-[10px] uppercase tracking-label ${
                        sellerFilter === 'all' ? 'text-paper' : 'text-ink-muted'
                      }`}
                    >
                      Todos
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setSellerFilter('none')}
                    accessibilityRole="button"
                    accessibilityLabel="Ver clientes sin vendedor"
                    className={`border px-3 py-1.5 ${
                      sellerFilter === 'none'
                        ? 'border-ink bg-ink'
                        : 'border-ink/20 bg-paper'
                    }`}
                  >
                    <Text
                      className={`font-sans text-[10px] uppercase tracking-label ${
                        sellerFilter === 'none' ? 'text-paper' : 'text-ink-muted'
                      }`}
                    >
                      Sin vendedor
                    </Text>
                  </Pressable>
                  {sellers.map((s) => (
                    <Pressable
                      key={s.id}
                      onPress={() => setSellerFilter(s.id)}
                      accessibilityRole="button"
                      accessibilityLabel={`Ver cartera de ${s.fullName}`}
                      className={`border px-3 py-1.5 ${
                        sellerFilter === s.id
                          ? 'border-ink bg-ink'
                          : 'border-ink/20 bg-paper'
                      }`}
                    >
                      <Text
                        className={`font-sans text-[10px] uppercase tracking-label ${
                          sellerFilter === s.id ? 'text-paper' : 'text-ink-muted'
                        }`}
                      >
                        {s.fullName}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}

            {/* Reasignar cartera: mueve TODOS los clientes de un vendedor a
                otro (o los deja sin vendedor) de un tiro. Solo aparece
                filtrando por un vendedor concreto y con cartera para mover. */}
            {canEditRole &&
            sellerFilter !== 'all' &&
            sellerFilter !== 'none' &&
            sellerPortfolio.length > 0 ? (
              <View className="mb-4 border border-ink/15 bg-paper-deep p-4">
                <Text className="font-sans-semibold text-[15px] text-ink">
                  {`${sellerPortfolio.length} cliente${sellerPortfolio.length === 1 ? '' : 's'} de ${activeSeller?.fullName ?? 'este vendedor'}`}
                </Text>
                <Text className="mb-3 mt-1 font-sans text-[10px] uppercase tracking-label text-ink-muted">
                  Reasignar cartera a
                </Text>
                <View className="flex-row flex-wrap gap-2">
                  <Pressable
                    onPress={() => setTransferDestination(null)}
                    accessibilityRole="button"
                    accessibilityLabel="Elegir sin vendedor como destino"
                    className={`border px-3 py-1.5 ${
                      transferDestination === null
                        ? 'border-brand bg-brand/10'
                        : 'border-ink/15 bg-paper'
                    }`}
                  >
                    <Text
                      className={`font-sans text-[11px] ${
                        transferDestination === null
                          ? 'text-brand'
                          : 'text-ink-muted'
                      }`}
                    >
                      Sin vendedor
                    </Text>
                  </Pressable>
                  {sellers
                    .filter((s) => s.id !== sellerFilter)
                    .map((s) => (
                      <Pressable
                        key={s.id}
                        onPress={() => setTransferDestination(s.id)}
                        accessibilityRole="button"
                        accessibilityLabel={`Elegir a ${s.fullName} como destino`}
                        className={`border px-3 py-1.5 ${
                          transferDestination === s.id
                            ? 'border-brand bg-brand/10'
                            : 'border-ink/15 bg-paper'
                        }`}
                      >
                        <Text
                          className={`font-sans text-[11px] ${
                            transferDestination === s.id
                              ? 'text-brand'
                              : 'text-ink-muted'
                          }`}
                        >
                          {s.fullName}
                        </Text>
                      </Pressable>
                    ))}
                </View>
                {transferDestination !== undefined && transferDestinationLabel ? (
                  <View className="mt-3">
                    <Button
                      onPress={handleTransferPortfolio}
                      loading={transferPortfolio.isPending}
                    >
                      {`Pasar ${sellerPortfolio.length} cliente${sellerPortfolio.length === 1 ? '' : 's'} a ${transferDestinationLabel}`}
                    </Button>
                  </View>
                ) : null}
              </View>
            ) : null}

            {/* El éxito/error persiste incluso si el destino elegido ("Sin
                vendedor") hace que la card de arriba deje de mostrarse. */}
            {canEditRole && transferSuccessMessage ? (
              <Text className="mb-4 font-sans text-[11px] uppercase tracking-label text-ok">
                {transferSuccessMessage}
              </Text>
            ) : null}
            {canEditRole && transferError ? (
              <Text className="mb-4 font-sans text-[11px] uppercase tracking-label text-bad">
                {transferError}
              </Text>
            ) : null}

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
            canEditRole={canEditRole}
            onChangeRole={(u, role) => updateUser.mutate({ id: u.id, role })}
            sellers={sellers}
            onAssignSeller={(u, sellerId) =>
              updateUser.mutate({ id: u.id, sellerId })
            }
            promoters={promoters}
            onAssignPromoter={(u, referredById) =>
              updateUser.mutate({ id: u.id, referredById })
            }
            pendingUpdate={updateUser.isPending}
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
