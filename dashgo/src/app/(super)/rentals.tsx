import { useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import {
  useAdminRentals,
  useCancelRental,
  useChargeLateFee,
  useChargeTheftFee,
  useResetMaintenance,
  useRetryRentalSetup,
} from '../../lib/queries'
import { formatCents, formatDate } from '../../lib/format'
import type { AdminRentalResponse, RentalFilter, RentalStatus } from '../../lib/types'
import { Button, Eyebrow, KpiCard, SectionHead } from '../../components/ui'

// ── Status meta ──────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<RentalStatus, { label: string; box: string; text: string }> = {
  active: { label: 'Activo', box: 'border-ok/40 bg-ok/10', text: 'text-ok' },
  past_due: { label: 'Atrasado', box: 'border-warn/40 bg-warn/10', text: 'text-warn' },
  unpaid: { label: 'Sin pagar', box: 'border-bad/40 bg-bad/10', text: 'text-bad' },
  pending_setup: { label: 'Setup pendiente', box: 'border-ink/20 bg-ink/5', text: 'text-ink-muted' },
  canceled: { label: 'Cancelado', box: 'border-ink/15 bg-paper-deep', text: 'text-ink-muted' },
}

const STATUS_FILTERS: { label: string; value: RentalStatus | undefined }[] = [
  { label: 'Todos', value: undefined },
  { label: 'Activo', value: 'active' },
  { label: 'Atrasado', value: 'past_due' },
  { label: 'Sin pagar', value: 'unpaid' },
  { label: 'Setup', value: 'pending_setup' },
  { label: 'Cancelado', value: 'canceled' },
]

// ── Pending action ───────────────────────────────────────────────────────────

type ActionType =
  | 'charge'
  | 'charge-cancel'
  | 'charge-theft-cancel'
  | 'cancel'
  | 'retry'
  | 'reset-maintenance'

type PendingAction = {
  type: ActionType
  rentalId: string
  label: string
}

// ── Compact action chip ──────────────────────────────────────────────────────

function ActionChip({
  label,
  onPress,
  danger = false,
}: {
  label: string
  onPress: () => void
  danger?: boolean
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`min-h-[44px] justify-center border px-3 py-3 active:opacity-70 ${
        danger ? 'border-bad/40 bg-bad/5' : 'border-ink/20 bg-paper'
      }`}
    >
      <Text
        className={`font-sans-medium text-[10px] uppercase tracking-label ${
          danger ? 'text-bad' : 'text-ink'
        }`}
      >
        {label}
      </Text>
    </Pressable>
  )
}

// ── Confirm sheet ────────────────────────────────────────────────────────────

function ConfirmSheet({
  action,
  isPending,
  onConfirm,
  onClose,
}: {
  action: PendingAction
  isPending: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Modal
      visible
      animationType="slide"
      transparent
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
    >
      <Pressable className="flex-1 bg-ink/40" onPress={isPending ? undefined : onClose}>
        <View className="flex-1" />
      </Pressable>
      <View
        className="absolute bottom-0 left-0 right-0 rounded-t-[20px] bg-paper px-6 pb-10 pt-6"
        style={{ shadowOpacity: 0.2, shadowRadius: 20 }}
      >
        <View className="mx-auto mb-5 h-1 w-12 rounded-full bg-ink/20" />
        <Eyebrow>Confirmar acción</Eyebrow>
        <Text className="mt-2 font-sans-semibold text-[18px] leading-[24px] text-ink">
          {action.label}
        </Text>
        <Text className="mt-2 font-sans text-[15px] text-ink-soft">
          Esta acción no se puede deshacer. ¿Querés continuar?
        </Text>
        <View className="mt-6 flex-row gap-3">
          <View className="flex-1">
            <Button variant="outline" size="lg" onPress={onClose} disabled={isPending}>
              Cancelar
            </Button>
          </View>
          <View className="flex-1">
            <Button variant="accent" size="lg" onPress={onConfirm} loading={isPending}>
              Confirmar
            </Button>
          </View>
        </View>
      </View>
    </Modal>
  )
}

// ── Rental row ───────────────────────────────────────────────────────────────

const ACTIVE_FEE_STATES: RentalStatus[] = ['active', 'past_due', 'unpaid']
const DELINQUENT_STATES: RentalStatus[] = ['past_due', 'unpaid']
const CANCELABLE_STATES: RentalStatus[] = ['active', 'past_due', 'unpaid', 'pending_setup']

function RentalRow({
  rental,
  onAction,
}: {
  rental: AdminRentalResponse
  onAction: (a: PendingAction) => void
}) {
  const badge = STATUS_BADGE[rental.status]
  const canCharge = ACTIVE_FEE_STATES.includes(rental.status) && rental.lateFeeCents > 0
  const canChargeCancel = DELINQUENT_STATES.includes(rental.status) && rental.lateFeeCents > 0
  const canChargeTheft =
    ACTIVE_FEE_STATES.includes(rental.status) &&
    rental.theftFeeCents > 0 &&
    !rental.theftFeeChargedAt
  const canCancel = CANCELABLE_STATES.includes(rental.status)
  const canRetry = rental.status === 'pending_setup'
  const canResetMaintenance = !!rental.nextMaintenanceAt

  return (
    <View className="border border-ink/10 bg-paper p-4">
      {/* Customer + status */}
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1">
          <Text className="font-sans-semibold text-[16px] leading-[20px] text-ink">
            {rental.userName}
          </Text>
          {rental.userPhone ? (
            <Text className="mt-0.5 font-sans text-[13px] text-ink-muted">
              {rental.userPhone}
            </Text>
          ) : null}
        </View>
        <View className={`shrink-0 border px-2 py-1 ${badge.box}`}>
          <Text className={`font-sans text-[10px] uppercase tracking-label ${badge.text}`}>
            {badge.label}
          </Text>
        </View>
      </View>

      {/* Meta */}
      <View className="mt-2 flex-row flex-wrap items-center gap-x-2 gap-y-1">
        <Text className="font-sans text-[10px] uppercase tracking-label text-ink-muted">
          {rental.productName}
        </Text>
        <Text className="text-ink-muted">·</Text>
        <Text
          className="font-sans text-[10px] uppercase tracking-label text-ink-muted"
          style={{ fontVariant: ['tabular-nums'] }}
        >
          {formatCents(rental.monthlyRentCents)}/mes
        </Text>
        {rental.currentPeriodEnd ? (
          <>
            <Text className="text-ink-muted">·</Text>
            <Text className="font-sans text-[10px] uppercase tracking-label text-ink-muted">
              Período: {formatDate(rental.currentPeriodEnd)}
            </Text>
          </>
        ) : null}
        {rental.daysDelinquent > 0 ? (
          <>
            <Text className="text-ink-muted">·</Text>
            <Text className="font-sans text-[10px] uppercase tracking-label text-bad">
              {rental.daysDelinquent}d atrasado
            </Text>
          </>
        ) : null}
      </View>

      {/* Actions */}
      {(canCharge ||
        canChargeCancel ||
        canChargeTheft ||
        canRetry ||
        canResetMaintenance ||
        canCancel) && (
        <View className="mt-3 flex-row flex-wrap gap-2">
          {canCharge ? (
            <ActionChip
              label="Cobrar late fee"
              onPress={() =>
                onAction({
                  type: 'charge',
                  rentalId: rental.id,
                  label: `Cobrar multa de ${formatCents(rental.lateFeeCents)} a ${rental.userName}`,
                })
              }
            />
          ) : null}
          {canChargeCancel ? (
            <ActionChip
              label="Cobrar y cancelar"
              onPress={() =>
                onAction({
                  type: 'charge-cancel',
                  rentalId: rental.id,
                  label: `Cobrar ${formatCents(rental.lateFeeCents)} y cancelar el alquiler de ${rental.userName}`,
                })
              }
            />
          ) : null}
          {canChargeTheft ? (
            <ActionChip
              label="Cobrar robo"
              onPress={() =>
                onAction({
                  type: 'charge-theft-cancel',
                  rentalId: rental.id,
                  label: `Cobrar multa por robo de ${formatCents(rental.theftFeeCents)} y cancelar el alquiler de ${rental.userName}`,
                })
              }
            />
          ) : null}
          {canRetry ? (
            <ActionChip
              label="Reintentar setup"
              onPress={() =>
                onAction({
                  type: 'retry',
                  rentalId: rental.id,
                  label: `Reintentar setup para ${rental.userName} — ${rental.productName}`,
                })
              }
            />
          ) : null}
          {canResetMaintenance ? (
            <ActionChip
              label="Reiniciar timer"
              onPress={() =>
                onAction({
                  type: 'reset-maintenance',
                  rentalId: rental.id,
                  label: `Reiniciar el timer de mantenimiento a 90 días para ${rental.userName}`,
                })
              }
            />
          ) : null}
          {canCancel ? (
            <ActionChip
              danger
              label="Cancelar"
              onPress={() =>
                onAction({
                  type: 'cancel',
                  rentalId: rental.id,
                  label: `Cancelar el alquiler de ${rental.userName} — ${rental.productName}`,
                })
              }
            />
          ) : null}
        </View>
      )}
    </View>
  )
}

// ── Screen ───────────────────────────────────────────────────────────────────

export default function SuperRentalsScreen() {
  const [statusFilter, setStatusFilter] = useState<RentalStatus | undefined>(undefined)
  const [customerSearch, setCustomerSearch] = useState('')
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)

  const filters = useMemo<RentalFilter>(
    () => ({
      page: 1,
      pageSize: 25,
      status: statusFilter ? [statusFilter] : undefined,
    }),
    [statusFilter],
  )

  const { data: rentals, isPending, refetch, isRefetching } = useAdminRentals(filters)
  const chargeMutation = useChargeLateFee()
  const theftMutation = useChargeTheftFee()
  const cancelMutation = useCancelRental()
  const retryMutation = useRetryRentalSetup()
  const resetMaintenanceMutation = useResetMaintenance()

  const isMutating =
    chargeMutation.isPending ||
    theftMutation.isPending ||
    cancelMutation.isPending ||
    retryMutation.isPending ||
    resetMaintenanceMutation.isPending

  // Summary from the (status-filtered) fetched list — no extra request.
  const summary = useMemo(() => {
    const list = rentals ?? []
    const debiendo = list.filter(
      (r) => r.status === 'past_due' || r.status === 'unpaid',
    )
    return {
      alDiaCount: list.filter((r) => r.status === 'active').length,
      debiendoCount: debiendo.length,
      rentAtRiskCents: debiendo.reduce((sum, r) => sum + r.monthlyRentCents, 0),
    }
  }, [rentals])

  // Customer name search is applied client-side over the fetched list.
  const displayed = useMemo(() => {
    const list = rentals ?? []
    const q = customerSearch.trim().toLowerCase()
    if (!q) return list
    return list.filter((r) => r.userName.toLowerCase().includes(q))
  }, [rentals, customerSearch])

  const handleConfirm = async () => {
    if (!pendingAction) return
    const { type, rentalId } = pendingAction
    try {
      if (type === 'charge') {
        await chargeMutation.mutateAsync({ rentalId, alsoCancel: false })
      } else if (type === 'charge-cancel') {
        await chargeMutation.mutateAsync({ rentalId, alsoCancel: true })
      } else if (type === 'charge-theft-cancel') {
        await theftMutation.mutateAsync({ rentalId, alsoCancel: true })
      } else if (type === 'cancel') {
        await cancelMutation.mutateAsync(rentalId)
      } else if (type === 'retry') {
        await retryMutation.mutateAsync(rentalId)
      } else if (type === 'reset-maintenance') {
        await resetMaintenanceMutation.mutateAsync(rentalId)
      }
      setPendingAction(null)
    } catch (e) {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? 'No se pudo completar la acción.'
      setPendingAction(null)
      Alert.alert('Acción fallida', msg)
    }
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
        automaticallyAdjustKeyboardInsets
        data={displayed}
        keyExtractor={(r) => r.id}
        contentContainerClassName="px-5 pb-12"
        ItemSeparatorComponent={() => <View className="h-3" />}
        refreshing={isRefetching}
        onRefresh={refetch}
        ListHeaderComponent={
          <View className="pb-2 pt-6">
            <SectionHead
              eyebrow="Panel · Alquileres"
              title="Alquileres"
              italicTail="activos."
              subtitle={`${rentals?.length ?? 0} resultado${rentals?.length === 1 ? '' : 's'}.`}
            />

            <View className="mb-5 flex-row gap-2">
              <KpiCard label="Al día" value={summary.alDiaCount} tone="ok" />
              <KpiCard label="Debiendo" value={summary.debiendoCount} tone="warn" />
              <KpiCard
                label="En riesgo"
                value={formatCents(summary.rentAtRiskCents)}
                tone="idle"
              />
            </View>

            <TextInput
              className="mb-4 h-11 border border-ink/25 px-3 font-sans text-[15px] text-ink"
              placeholder="Buscar cliente por nombre…"
              placeholderTextColor="#6B6488"
              value={customerSearch}
              onChangeText={setCustomerSearch}
              autoCapitalize="none"
            />

            <View className="mb-4 flex-row flex-wrap gap-2">
              {STATUS_FILTERS.map((f) => (
                <Pressable
                  key={f.label}
                  onPress={() => setStatusFilter(f.value)}
                  className={`min-h-[44px] justify-center border px-3 py-3 ${
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
          </View>
        }
        renderItem={({ item }) => (
          <RentalRow rental={item} onAction={setPendingAction} />
        )}
        ListEmptyComponent={
          <View className="items-center py-16">
            <Eyebrow>Sin resultados</Eyebrow>
            <Text className="mt-3 text-center text-[15px] text-ink-soft">
              No hay alquileres registrados.
            </Text>
          </View>
        }
      />

      {pendingAction ? (
        <ConfirmSheet
          action={pendingAction}
          isPending={isMutating}
          onConfirm={handleConfirm}
          onClose={() => setPendingAction(null)}
        />
      ) : null}
    </SafeAreaView>
  )
}
