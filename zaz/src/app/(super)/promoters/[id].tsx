import { useState } from 'react'
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router, useLocalSearchParams } from 'expo-router'
import {
  useCreatePayout,
  usePromoterDashboardAsAdmin,
  usePromoterPayouts,
} from '../../../lib/queries'
import type {
  Payout,
  PromoterCommissionEntry,
  ReferredCustomerSummary,
} from '../../../lib/types'
import { formatCents, formatDate } from '../../../lib/format'
import {
  Button,
  Card,
  Eyebrow,
  FieldError,
  FieldLabel,
  Hairline,
  SectionHead,
} from '../../../components/ui'

function BalanceCard({
  label,
  cents,
  accent,
  helper,
}: {
  label: string
  cents: number
  accent?: boolean
  helper?: string
}) {
  return (
    <View className="flex-1 border border-ink/15 bg-paper p-4">
      <Eyebrow>{label}</Eyebrow>
      <Text
        className={`mt-2 font-sans-semibold text-[24px] leading-[28px] ${
          accent ? 'text-brand' : 'text-ink'
        }`}
        style={{ fontVariant: ['tabular-nums'] }}
      >
        {formatCents(cents)}
      </Text>
      {helper ? (
        <Text className="mt-2 font-sans text-[10px] uppercase tracking-label text-ink-muted">
          {helper}
        </Text>
      ) : null}
    </View>
  )
}

function commissionLabel(e: PromoterCommissionEntry): string {
  if (e.type === 'paid_out') return 'Pago recibido'
  if (e.status === 'pending') return 'Pendiente'
  if (e.status === 'claimable') return 'Disponible'
  if (e.status === 'paid') return 'Pagada'
  return e.status
}

function ReferredRow({ customer }: { customer: ReferredCustomerSummary }) {
  return (
    <View className="border-b border-ink/10 py-3">
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1">
          <Text className="text-[15px] font-medium text-ink">
            {customer.fullName}
          </Text>
          <Text className="mt-0.5 font-sans text-[10px] uppercase tracking-label text-ink-muted">
            {customer.firstOrderAt
              ? `Primera orden ${formatDate(customer.firstOrderAt)}`
              : 'Aún no pidió'}
          </Text>
        </View>
        <View className="items-end">
          <Text
            className="font-sans text-[13px] text-ink"
            style={{ fontVariant: ['tabular-nums'] }}
          >
            {customer.orderCount} ped.
          </Text>
          <Text
            className="mt-0.5 font-sans text-[13px] text-brand"
            style={{ fontVariant: ['tabular-nums'] }}
          >
            {formatCents(customer.totalCommissionGeneratedCents)}
          </Text>
        </View>
      </View>
    </View>
  )
}

function CommissionRow({ entry }: { entry: PromoterCommissionEntry }) {
  const negative = entry.amountCents < 0
  return (
    <View className="flex-row items-start justify-between gap-3 border-b border-ink/10 py-3">
      <View className="flex-1">
        <Text className="text-[14px] font-medium text-ink">
          {commissionLabel(entry)}
        </Text>
        <Text className="mt-0.5 font-sans text-[10px] uppercase tracking-label text-ink-muted">
          {formatDate(entry.createdAt)}
          {entry.referredUserName ? ` · ${entry.referredUserName}` : ''}
        </Text>
      </View>
      <Text
        className={`font-sans text-[14px] font-semibold ${
          negative ? 'text-bad' : 'text-ink'
        }`}
        style={{ fontVariant: ['tabular-nums'] }}
      >
        {negative ? '−' : '+'}
        {formatCents(Math.abs(entry.amountCents))}
      </Text>
    </View>
  )
}

function PayoutRow({ payout }: { payout: Payout }) {
  return (
    <View className="border-b border-ink/10 py-3">
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1">
          <Text
            className="font-sans text-[16px] font-semibold text-brand"
            style={{ fontVariant: ['tabular-nums'] }}
          >
            {formatCents(payout.amountCents)}
          </Text>
          <Text className="mt-0.5 font-sans text-[10px] uppercase tracking-label text-ink-muted">
            {formatDate(payout.createdAt)}
          </Text>
          {payout.notes ? (
            <Text className="mt-1 text-[13px] text-ink">
              “{payout.notes}”
            </Text>
          ) : null}
          {payout.createdBy ? (
            <Text className="mt-1 font-sans text-[10px] uppercase tracking-label text-ink-muted">
              por {payout.createdBy.fullName}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  )
}

function PayoutModal({
  visible,
  promoterName,
  claimableCents,
  onClose,
  onConfirm,
  isPending,
  errorMsg,
}: {
  visible: boolean
  promoterName: string
  claimableCents: number
  onClose: () => void
  onConfirm: (notes: string) => void
  isPending: boolean
  errorMsg: string | null
}) {
  const [notes, setNotes] = useState('')

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View className="flex-1 items-center justify-end bg-ink/40">
        <View className="w-full border border-ink/15 bg-paper p-6">
          <View className="flex-row items-center justify-between">
            <Eyebrow>Pagar comisiones</Eyebrow>
            <Pressable onPress={onClose} disabled={isPending}>
              <Text className="font-sans text-[11px] uppercase tracking-label text-ink-muted">
                Cerrar ✕
              </Text>
            </Pressable>
          </View>

          <Text className="mt-4 font-sans-semibold text-[24px] leading-[28px] text-ink">
            ¿Pagar{' '}
            <Text
              className="text-brand"
              style={{ fontVariant: ['tabular-nums'] }}
            >
              {formatCents(claimableCents)}
            </Text>{' '}
            a{' '}
            <Text className="font-sans-italic">{promoterName}</Text>?
          </Text>

          <Text className="mt-3 text-[14px] text-ink-muted">
            Esta acción marca todas las comisiones disponibles como pagadas y
            registra un pago histórico. No se puede revertir.
          </Text>

          <View className="mt-5">
            <FieldLabel>Notas (opcional)</FieldLabel>
            <TextInput
              className="min-h-[80px] border border-ink/20 bg-paper px-3 py-2 font-sans text-[15px] text-ink"
              placeholder="Ej: Paid via Cash App $handle"
              placeholderTextColor="#6B6488"
              multiline
              maxLength={500}
              value={notes}
              onChangeText={setNotes}
              editable={!isPending}
              style={{ textAlignVertical: 'top' }}
            />
          </View>

          {errorMsg ? <FieldError message={errorMsg} /> : null}

          <View className="mt-6 flex-row gap-3">
            <View className="flex-1">
              <Button
                variant="accent"
                loading={isPending}
                onPress={() => onConfirm(notes.trim())}
              >
                Confirmar pago
              </Button>
            </View>
            <Button variant="ghost" onPress={onClose} disabled={isPending}>
              Cancelar
            </Button>
          </View>
        </View>
      </View>
    </Modal>
  )
}

export default function SuperPromoterDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const promoterId = typeof id === 'string' ? id : ''
  const { data, isPending, isError, refetch } =
    usePromoterDashboardAsAdmin(promoterId)
  const { data: payouts } = usePromoterPayouts(promoterId)
  const createPayout = useCreatePayout()

  const [modalOpen, setModalOpen] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  if (isPending) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-paper">
        <ActivityIndicator color="#220247" size="small" />
      </SafeAreaView>
    )
  }

  if (isError || !data) {
    return (
      <SafeAreaView edges={['top']} className="flex-1 bg-paper">
        <View className="flex-1 items-center justify-center px-6">
          <Eyebrow>Error</Eyebrow>
          <Text className="mt-3 text-center text-[15px] text-ink-muted">
            No pudimos cargar este promotor.
          </Text>
          <View className="mt-5">
            <Button variant="ghost" onPress={() => router.back()}>
              ← Volver
            </Button>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  const { promoter, balances, referredCustomers, recentCommissions } = data
  const payoutList = payouts ?? data.payouts

  const handleConfirm = async (notes: string) => {
    setErrorMsg(null)
    try {
      await createPayout.mutateAsync({
        promoterId,
        notes: notes.length > 0 ? notes : undefined,
      })
      setModalOpen(false)
      refetch()
    } catch (err) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? 'No se pudo emitir el pago'
      setErrorMsg(msg)
    }
  }

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-paper">
      <ScrollView contentContainerClassName="px-5 pb-12">
        <View className="pt-4">
          <Pressable
            onPress={() => router.back()}
            className="mb-2 self-start px-1 py-2"
          >
            <Text className="font-sans text-[11px] uppercase tracking-label text-ink-muted">
              ← Promotores
            </Text>
          </Pressable>

          <SectionHead
            eyebrow="Promotor · Detalle"
            title={promoter.fullName}
            italicTail=""
            subtitle={`${promoter.phone ?? '—'} · Código ${promoter.referralCode ?? '—'}`}
          />
        </View>

        <View className="mb-5 flex-row gap-3">
          <BalanceCard
            label="Disponible"
            cents={balances.claimableCents}
            accent={balances.claimableCents > 0}
            helper="Cobrable"
          />
          <BalanceCard
            label="Pendiente"
            cents={balances.pendingCents}
            helper="90 días"
          />
        </View>

        <View className="mb-6 flex-row gap-3">
          <BalanceCard
            label="Pagado"
            cents={balances.paidCents}
            helper="Histórico"
          />
          <View className="flex-1 border border-ink/15 bg-paper p-4">
            <Eyebrow>Referidos</Eyebrow>
            <Text
              className="mt-2 font-sans-semibold text-[24px] leading-[28px] text-ink"
              style={{ fontVariant: ['tabular-nums'] }}
            >
              {data.referredCount}
            </Text>
          </View>
        </View>

        <Card className="mb-8">
          <Eyebrow tone="accent">Pagar comisiones</Eyebrow>
          <Text className="mt-3 font-sans-semibold text-[20px] leading-[24px] text-ink">
            {balances.claimableCents > 0
              ? `Hay ${formatCents(balances.claimableCents)} disponibles`
              : 'Sin comisiones para pagar'}
          </Text>
          <Text className="mt-2 text-[13px] text-ink-muted">
            Al confirmar, todas las comisiones pasan a "pagadas" y se registra un
            pago agrupado.
          </Text>

          <Hairline className="my-4" />

          <Button
            variant="accent"
            size="lg"
            disabled={balances.claimableCents <= 0 || createPayout.isPending}
            onPress={() => {
              setErrorMsg(null)
              setModalOpen(true)
            }}
          >
            Pagar ahora
          </Button>
        </Card>

        <Card className="mb-6">
          <Eyebrow className="mb-3">
            Clientes referidos ({referredCustomers.length})
          </Eyebrow>
          {referredCustomers.length === 0 ? (
            <View className="py-6">
              <Text className="text-center text-[14px] text-ink-muted">
                Sin referidos todavía.
              </Text>
            </View>
          ) : (
            <View>
              {referredCustomers.map((c) => (
                <ReferredRow key={c.id} customer={c} />
              ))}
            </View>
          )}
        </Card>

        <Card className="mb-6">
          <Eyebrow className="mb-3">Últimas comisiones</Eyebrow>
          {recentCommissions.length === 0 ? (
            <View className="py-6">
              <Text className="text-center text-[14px] text-ink-muted">
                Sin movimientos todavía.
              </Text>
            </View>
          ) : (
            <View>
              {recentCommissions.slice(0, 10).map((c) => (
                <CommissionRow key={c.id} entry={c} />
              ))}
            </View>
          )}
        </Card>

        <Card className="mb-6">
          <Eyebrow className="mb-3">Pagos emitidos</Eyebrow>
          {payoutList.length === 0 ? (
            <View className="py-6">
              <Text className="text-center text-[14px] text-ink-muted">
                Aún no se emitió ningún pago.
              </Text>
            </View>
          ) : (
            <View>
              {payoutList.map((p) => (
                <PayoutRow key={p.id} payout={p} />
              ))}
            </View>
          )}
        </Card>
      </ScrollView>

      <PayoutModal
        visible={modalOpen}
        promoterName={promoter.fullName}
        claimableCents={balances.claimableCents}
        onClose={() => {
          if (!createPayout.isPending) setModalOpen(false)
        }}
        onConfirm={handleConfirm}
        isPending={createPayout.isPending}
        errorMsg={errorMsg}
      />
    </SafeAreaView>
  )
}
