import { ActivityIndicator, FlatList, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { useCurrentUser, useMyCredit } from '../../lib/queries'
import { formatCents, formatDate } from '../../lib/format'
import type { CreditMovement } from '../../lib/types'
import { Button, Eyebrow, Hairline } from '../../components/ui'

function movementTypeLabel(type: string) {
  switch (type) {
    case 'grant': return 'Crédito otorgado'
    case 'charge': return 'Cargo'
    case 'reversal': return 'Reversión'
    case 'payment': return 'Pago recibido'
    case 'adjustment': return 'Ajuste'
    case 'adjustment_increase': return 'Ajuste +'
    case 'adjustment_decrease': return 'Ajuste -'
    default: return type
  }
}

function movementAmountColor(type: CreditMovement['type']): string {
  if (type === 'charge' || type === 'adjustment_decrease') return 'text-red-600'
  if (type === 'adjustment') return 'text-ink-muted'
  return 'text-ink'
}

function movementSign(type: CreditMovement['type']): string {
  if (type === 'charge' || type === 'adjustment_decrease') return '−'
  if (type === 'adjustment') return '±'
  return '+'
}

function SummaryCard({
  label,
  value,
  red,
  accent,
}: {
  label: string
  value: string
  red?: boolean
  accent?: boolean
}) {
  return (
    <View className="flex-1 border border-ink/15 bg-paper p-4">
      <Text className="font-sans text-[10px] uppercase tracking-label text-ink-muted">
        {label}
      </Text>
      <Text
        className={`mt-2 font-sans-semibold text-[22px] leading-[26px] ${
          red ? 'text-red-600' : accent ? 'text-brand' : 'text-ink'
        }`}
        style={{ fontVariant: ['tabular-nums'] }}
      >
        {value}
      </Text>
    </View>
  )
}

function MovementRow({ mv }: { mv: CreditMovement }) {
  return (
    <View className="py-4">
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1 pr-3">
          <Text className="font-sans text-[10px] uppercase tracking-label text-ink-muted">
            {formatDate(mv.createdAt)} · {movementTypeLabel(mv.type)}
          </Text>
          {mv.note ? (
            <Text className="mt-0.5 font-sans text-[13px] text-ink-soft">{mv.note}</Text>
          ) : null}
        </View>
        <Text
          className={`font-sans-semibold text-[17px] ${movementAmountColor(mv.type)}`}
          style={{ fontVariant: ['tabular-nums'] }}
        >
          {movementSign(mv.type)}{formatCents(mv.amountCents)}
        </Text>
      </View>
      <Hairline className="mt-4" />
    </View>
  )
}

export default function CreditTab() {
  const { data, isPending, refetch, isRefetching } = useMyCredit()
  const { data: user } = useCurrentUser()

  if (isPending) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-paper">
        <ActivityIndicator color="#220247" size="small" />
      </SafeAreaView>
    )
  }

  const hasAccount = data && data.balanceCents !== null
  const balanceCents = data?.balanceCents ?? 0
  const limitCents = data?.creditLimitCents ?? 0
  const available = balanceCents + limitCents
  const movements = data?.movements ?? []

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-paper">
      <FlatList
        data={hasAccount ? movements : []}
        keyExtractor={(m) => m.id}
        contentContainerClassName="px-5 pb-8"
        refreshing={isRefetching}
        onRefresh={refetch}
        ListHeaderComponent={
          <View className="pb-2 pt-6">
            <Eyebrow className="mb-3">Mi cuenta</Eyebrow>
            <View className="flex-row flex-wrap items-baseline">
              <Text className="font-sans-semibold text-[40px] leading-[44px] text-ink">
                Mi{' '}
              </Text>
              <Text className="font-sans-italic text-[40px] leading-[44px] text-brand">
                crédito.
              </Text>
            </View>
            <Text className="mt-2 text-[13px] text-ink-soft">
              Saldo disponible para tus pedidos.
            </Text>

            {hasAccount ? (
              <>
                <View className="mt-6 flex-row gap-3">
                  <SummaryCard
                    label="Disponible"
                    value={formatCents(available)}
                    accent={available > 0}
                  />
                  <SummaryCard
                    label="Balance"
                    value={formatCents(balanceCents)}
                    red={balanceCents < 0}
                  />
                </View>
                <View className="mt-3 flex-row gap-3">
                  <SummaryCard label="Límite" value={formatCents(limitCents)} />
                  {data?.dueDate ? (
                    <SummaryCard label="Vencimiento" value={formatDate(data.dueDate)} />
                  ) : null}
                </View>

                {data?.status === 'overdue' && (
                  <View className="mt-4 border border-red-200 bg-red-50 px-4 py-3">
                    <Text className="font-sans text-[11px] uppercase tracking-label text-red-700">
                      Cuenta vencida — salda tu deuda para volver a usar la app.
                    </Text>
                  </View>
                )}

                {(data?.amountOwedCents ?? 0) > 0 && (
                  <View
                    className={`mt-4 border ${user?.creditLocked ? 'border-red-300 bg-red-50' : 'border-accent/40 bg-accent/5'} px-4 py-4`}
                  >
                    <View className="flex-row items-center justify-between">
                      <View className="flex-1 pr-3">
                        <Text
                          className={`font-sans text-[10px] uppercase tracking-label ${user?.creditLocked ? 'text-red-700' : 'text-accent-dark'}`}
                        >
                          Saldo pendiente
                        </Text>
                        <Text
                          className={`mt-1 font-sans-semibold text-[20px] ${user?.creditLocked ? 'text-red-700' : 'text-ink'}`}
                          style={{ fontVariant: ['tabular-nums'] }}
                        >
                          {formatCents(data!.amountOwedCents)}
                        </Text>
                      </View>
                      <Button
                        variant="accent"
                        size="md"
                        onPress={() => router.push('/credit-pay')}
                      >
                        Pagar ahora →
                      </Button>
                    </View>
                  </View>
                )}

                <Hairline className="mt-6" />
                <Eyebrow className="mt-6 mb-2">Mis movimientos</Eyebrow>
              </>
            ) : (
              <View className="mt-10 items-center py-16">
                <Eyebrow>Sin cuenta de crédito</Eyebrow>
                <Text className="mt-3 text-center text-[15px] text-ink-soft">
                  No tienes una cuenta de crédito activa.{'\n'}Contacta al administrador.
                </Text>
              </View>
            )}
          </View>
        }
        renderItem={({ item }) => <MovementRow mv={item} />}
        ListEmptyComponent={
          hasAccount ? (
            <View className="items-center py-16">
              <Eyebrow>Sin movimientos</Eyebrow>
              <Text className="mt-3 text-center text-[15px] text-ink-soft">
                Tu historial de crédito aparecerá aquí.
              </Text>
            </View>
          ) : null
        }
      />
    </SafeAreaView>
  )
}
