import { useState } from 'react'
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
import { useLocalSearchParams } from 'expo-router'
import {
  useAdminCreditAccount,
  useAdminCreditMovements,
  useAdjustCredit,
  useGrantCredit,
  useManualAdjustment,
  useRecordPayment,
  useRefundCreditOrder,
} from '../../../lib/queries'
import { formatCents, formatDate } from '../../../lib/format'
import type { CreditMovement } from '../../../lib/types'
import { Button, Card, Eyebrow, FieldLabel, Hairline, SectionHead } from '../../../components/ui'

function movementTypeLabel(type: string) {
  switch (type) {
    case 'grant': return 'Crédito otorgado'
    case 'charge': return 'Cargo'
    case 'reversal': return 'Reversión'
    case 'payment': return 'Pago recibido'
    case 'adjustment': return 'Ajuste manual'
    case 'adjustment_increase': return 'Ajuste +'
    case 'adjustment_decrease': return 'Ajuste -'
    default: return type
  }
}

function movementAmountColor(type: CreditMovement['type']): string {
  if (type === 'charge' || type === 'adjustment_decrease') return 'text-red-600'
  if (type === 'adjustment') return 'text-ink-muted'
  return 'text-green-700'
}

function movementSign(type: CreditMovement['type']): string {
  if (type === 'charge' || type === 'adjustment_decrease') return '−'
  if (type === 'adjustment') return '±'
  return '+'
}

function MovementRow({
  mv,
  userId,
  existingReversalOrderIds,
}: {
  mv: CreditMovement
  userId: string
  existingReversalOrderIds: Set<string>
}) {
  const refundMut = useRefundCreditOrder(userId)

  const canRefund =
    mv.type === 'charge' &&
    mv.orderId != null &&
    !existingReversalOrderIds.has(mv.orderId)

  const handleRefund = () => {
    if (!mv.orderId) return
    const orderId = mv.orderId
    Alert.alert(
      'Confirmar reembolso',
      `¿Reembolsar el cargo del pedido ${orderId.slice(0, 8)}…?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Reembolsar',
          style: 'destructive',
          onPress: () => {
            refundMut.mutate(orderId, {
              onError: (err: unknown) => {
                const status = (err as { response?: { status?: number } })?.response?.status
                if (status === 409) {
                  Alert.alert('Ya fue reembolsado', 'Este cargo ya tiene un reembolso registrado.')
                } else {
                  Alert.alert('Error', 'No se pudo procesar el reembolso. Intentá de nuevo.')
                }
              },
            })
          },
        },
      ],
    )
  }

  return (
    <View className="border-b border-ink/10 py-3">
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1">
          <Text className="font-sans text-[10px] uppercase tracking-label text-ink-muted">
            {formatDate(mv.createdAt)} · {movementTypeLabel(mv.type)}
          </Text>
          {mv.note ? (
            <Text className="mt-0.5 font-sans text-[13px] text-ink-soft">{mv.note}</Text>
          ) : null}
        </View>
        <View className="items-end gap-1">
          <Text
            className={`font-sans-semibold text-[16px] ${movementAmountColor(mv.type)}`}
            style={{ fontVariant: ['tabular-nums'] }}
          >
            {movementSign(mv.type)}{formatCents(mv.amountCents)}
          </Text>
          {canRefund ? (
            <Pressable
              onPress={handleRefund}
              disabled={refundMut.isPending}
              className="disabled:opacity-50"
            >
              <Text className="font-sans text-[10px] uppercase tracking-label text-brand">
                {refundMut.isPending ? 'Procesando…' : 'Reembolsar'}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  )
}

function StatCard({ label, value, red }: { label: string; value: string; red?: boolean }) {
  return (
    <View className="flex-1 border border-ink/15 bg-paper p-3">
      <Text className="font-sans text-[9px] uppercase tracking-label text-ink-muted">{label}</Text>
      <Text
        className={`mt-1 font-sans-semibold text-[20px] leading-[24px] ${red ? 'text-red-600' : 'text-ink'}`}
        style={{ fontVariant: ['tabular-nums'] }}
      >
        {value}
      </Text>
    </View>
  )
}

function ActionForm({
  title,
  fields,
  onSubmit,
  loading,
}: {
  title: string
  fields: Array<{
    name: string
    label: string
    numeric?: boolean
    decimal?: boolean
    placeholder?: string
    helper?: string
  }>
  onSubmit: (values: Record<string, string>) => void
  loading: boolean
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.name, ''])),
  )

  return (
    <Card className="mb-4">
      <Eyebrow className="mb-3">{title}</Eyebrow>
      {fields.map((f) => (
        <View key={f.name} className="mb-3">
          <FieldLabel>{f.label}</FieldLabel>
          <TextInput
            className="h-11 border-b border-ink/25 pb-1 font-sans text-[15px] text-ink"
            placeholder={f.placeholder ?? ''}
            placeholderTextColor="#6B6488"
            keyboardType={
              f.decimal
                ? 'decimal-pad'
                : f.numeric
                  ? 'numbers-and-punctuation'
                  : 'default'
            }
            value={values[f.name]}
            onChangeText={(v) => setValues((prev) => ({ ...prev, [f.name]: v }))}
          />
          {f.helper ? (
            <Text className="mt-1 font-sans text-[10px] uppercase tracking-label text-ink-muted">
              {f.helper}
            </Text>
          ) : null}
        </View>
      ))}
      <Button variant="ink" loading={loading} onPress={() => onSubmit(values)}>
        Confirmar
      </Button>
    </Card>
  )
}

function dollarsToCents(value: string): number {
  const n = parseFloat(value)
  if (!Number.isFinite(n)) return NaN
  return Math.round(n * 100)
}

function defaultGrantDueDate(): string {
  const d = new Date()
  d.setMonth(d.getMonth() + 3)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export default function SuperCreditDetailScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>()
  const [movPage, setMovPage] = useState(1)

  const { data: detail, isPending } = useAdminCreditAccount(userId)
  const { data: movementsPage, isPending: movPending } = useAdminCreditMovements(userId, movPage, 30)

  const grantMut = useGrantCredit(userId!)
  const paymentMut = useRecordPayment(userId!)
  const adjustMut = useAdjustCredit(userId!)
  const manualMut = useManualAdjustment(userId!)

  const account = detail?.account

  const existingReversalOrderIds = new Set<string>(
    (movementsPage?.items ?? [])
      .filter((mv) => mv.type === 'reversal' && mv.orderId != null)
      .map((mv) => mv.orderId as string),
  )

  if (isPending) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-paper">
        <ActivityIndicator color="#220247" size="small" />
      </SafeAreaView>
    )
  }

  const balanceCents = account?.balanceCents ?? 0
  const limitCents = account?.creditLimitCents ?? 0
  const isNegative = balanceCents < 0

  const handleGrant = (v: Record<string, string>) => {
    const cents = dollarsToCents(v.amount)
    if (!cents || cents <= 0) { Alert.alert('Error', 'Monto inválido'); return }
    const dueDate = v.dueDate?.trim() || defaultGrantDueDate()
    grantMut.mutate({
      amountCents: cents,
      note: v.note || undefined,
      dueDate,
    })
  }

  const handlePayment = (v: Record<string, string>) => {
    const cents = dollarsToCents(v.amount)
    if (!cents || cents <= 0) { Alert.alert('Error', 'Monto inválido'); return }
    paymentMut.mutate({ amountCents: cents, note: v.note || undefined })
  }

  const handleAdjust = (v: Record<string, string>) => {
    const newLimit = v.newLimit?.trim() ? dollarsToCents(v.newLimit) : undefined
    if (newLimit !== undefined && (!Number.isFinite(newLimit) || newLimit < 0)) {
      Alert.alert('Error', 'Límite inválido')
      return
    }
    adjustMut.mutate({ newLimitCents: newLimit, dueDate: v.dueDate || undefined })
  }

  const handleManual = (v: Record<string, string>) => {
    const cents = dollarsToCents(v.amount)
    if (!Number.isFinite(cents) || cents === 0) { Alert.alert('Error', 'Monto inválido'); return }
    if (!v.note?.trim()) { Alert.alert('Error', 'La nota es requerida'); return }
    manualMut.mutate({ amountCents: cents, note: v.note })
  }

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-paper">
      <FlatList
        data={movementsPage?.items ?? []}
        keyExtractor={(m) => m.id}
        contentContainerClassName="px-5 pb-12"
        ListHeaderComponent={
          <View className="pt-6">
            <SectionHead
              eyebrow="Crédito fiado"
              title={account?.user?.fullName ?? userId ?? ''}
            />

            {/* Balance summary */}
            <View className="mb-6 flex-row gap-2">
              <StatCard
                label="Balance"
                value={formatCents(balanceCents)}
                red={isNegative}
              />
              <StatCard label="Límite" value={formatCents(limitCents)} />
              {account?.dueDate && (
                <StatCard label="Vencimiento" value={formatDate(account.dueDate)} />
              )}
            </View>

            {/* Action forms */}
            <ActionForm
              title="Otorgar crédito"
              fields={[
                { name: 'amount', label: 'Monto (USD)', decimal: true, placeholder: '50' },
                { name: 'note', label: 'Nota', placeholder: 'Razón opcional' },
                {
                  name: 'dueDate',
                  label: 'Fecha vencimiento (opcional · YYYY-MM-DD)',
                  placeholder: defaultGrantDueDate(),
                  helper: 'Solo se aplica en el primer otorgamiento. Default: hoy + 3 meses.',
                },
              ]}
              onSubmit={handleGrant}
              loading={grantMut.isPending}
            />

            <ActionForm
              title="Registrar pago"
              fields={[
                { name: 'amount', label: 'Monto (USD)', decimal: true, placeholder: '50' },
                { name: 'note', label: 'Nota', placeholder: 'Razón opcional' },
              ]}
              onSubmit={handlePayment}
              loading={paymentMut.isPending}
            />

            <ActionForm
              title="Ajustar límite / vencimiento"
              fields={[
                { name: 'newLimit', label: 'Nuevo límite (USD)', decimal: true, placeholder: 'Dejar vacío para no cambiar' },
                { name: 'dueDate', label: 'Fecha vencimiento (YYYY-MM-DD)', placeholder: '2025-12-31' },
              ]}
              onSubmit={handleAdjust}
              loading={adjustMut.isPending}
            />

            <ActionForm
              title="Ajuste manual"
              fields={[
                { name: 'amount', label: 'Monto USD (+ suma, − resta)', numeric: true, placeholder: '−10 o 20' },
                { name: 'note', label: 'Nota (requerida)', placeholder: 'Razón del ajuste' },
              ]}
              onSubmit={handleManual}
              loading={manualMut.isPending}
            />

            <Hairline className="mb-2 mt-4" />
            <View className="flex-row items-center justify-between mb-3">
              <Eyebrow>Movimientos</Eyebrow>
              {movPending && <ActivityIndicator color="#220247" size="small" />}
              <Text className="font-sans text-[10px] text-ink-muted">
                {movementsPage?.totalCount ?? 0} total
              </Text>
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <MovementRow
            mv={item}
            userId={userId!}
            existingReversalOrderIds={existingReversalOrderIds}
          />
        )}
        ListFooterComponent={
          movementsPage && movementsPage.totalPages > 1 ? (
            <View className="mt-4 flex-row items-center justify-between">
              <Pressable
                disabled={movPage <= 1}
                onPress={() => setMovPage((p) => p - 1)}
                className="px-4 py-2 disabled:opacity-40"
              >
                <Text className="font-sans text-[12px] uppercase tracking-label text-brand">
                  ← Anterior
                </Text>
              </Pressable>
              <Text className="font-sans text-[11px] text-ink-muted">
                {movPage} / {movementsPage.totalPages}
              </Text>
              <Pressable
                disabled={movPage >= movementsPage.totalPages}
                onPress={() => setMovPage((p) => p + 1)}
                className="px-4 py-2 disabled:opacity-40"
              >
                <Text className="font-sans text-[12px] uppercase tracking-label text-brand">
                  Siguiente →
                </Text>
              </Pressable>
            </View>
          ) : null
        }
        ListEmptyComponent={
          !movPending ? (
            <View className="items-center py-12">
              <Eyebrow>Sin movimientos</Eyebrow>
              <Text className="mt-3 text-center text-[15px] text-ink-soft">
                No hay movimientos registrados todavía.
              </Text>
            </View>
          ) : null
        }
      />
    </SafeAreaView>
  )
}
