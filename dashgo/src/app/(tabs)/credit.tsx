import { ActivityIndicator, FlatList, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useCurrentUser, useMyCredit } from '../../lib/queries'
import { formatCents, formatDate } from '../../lib/format'
import type { CreditMovement } from '../../lib/types'
import { Button, Eyebrow, Hairline } from '../../components/ui'

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
      <Text className="font-sans text-[12px] uppercase tracking-label text-ink-muted">
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
  const { t } = useTranslation('credit')
  const typeLabel = (() => {
    switch (mv.type) {
      case 'grant': return t('movementType.grant')
      case 'charge': return t('movementType.charge')
      case 'reversal': return t('movementType.reversal')
      case 'payment': return t('movementType.payment')
      case 'adjustment': return t('movementType.adjustment')
      case 'adjustment_increase': return t('movementType.adjustment_increase')
      case 'adjustment_decrease': return t('movementType.adjustment_decrease')
      default: return mv.type
    }
  })()
  return (
    <View className="py-4">
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1 pr-3">
          <Text className="font-sans text-[12px] uppercase tracking-label text-ink-muted">
            {t('movement.meta', { date: formatDate(mv.createdAt), type: typeLabel })}
          </Text>
          {mv.note ? (
            <Text className="mt-0.5 font-sans text-[15px] text-ink-soft">{mv.note}</Text>
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
  const { t } = useTranslation('credit')
  const { data, isPending, refetch, isRefetching } = useMyCredit()
  const { data: user } = useCurrentUser()

  if (isPending) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-paper">
        <ActivityIndicator color="#1A1530" size="small" />
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
            <Eyebrow className="mb-3">{t('eyebrow')}</Eyebrow>
            <View className="flex-row flex-wrap items-baseline">
              <Text className="font-sans-semibold text-[40px] leading-[44px] text-ink">
                {t('title.lead')}{' '}
              </Text>
              <Text className="font-sans-italic text-[40px] leading-[44px] text-brand">
                {t('title.accent')}
              </Text>
            </View>
            <Text className="mt-2 text-[15px] text-ink-soft">
              {t('subtitle')}
            </Text>

            {hasAccount ? (
              <>
                <View className="mt-6 flex-row gap-3">
                  <SummaryCard
                    label={t('summary.available')}
                    value={formatCents(available)}
                    accent={available > 0}
                  />
                  <SummaryCard
                    label={t('summary.balance')}
                    value={formatCents(balanceCents)}
                    red={balanceCents < 0}
                  />
                </View>
                <View className="mt-3 flex-row gap-3">
                  <SummaryCard label={t('summary.limit')} value={formatCents(limitCents)} />
                  {data?.dueDate ? (
                    <SummaryCard label={t('summary.dueDate')} value={formatDate(data.dueDate)} />
                  ) : null}
                </View>

                {data?.status === 'overdue' && (
                  <View className="mt-4 border border-red-200 bg-red-50 px-4 py-3">
                    <Text className="font-sans text-[13px] uppercase tracking-label text-red-700">
                      {t('overdueBanner')}
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
                          className={`font-sans text-[12px] uppercase tracking-label ${user?.creditLocked ? 'text-red-700' : 'text-accent-dark'}`}
                        >
                          {t('pendingBalance')}
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
                        {t('payNow')}
                      </Button>
                    </View>
                  </View>
                )}

                <Hairline className="mt-6" />
                <Eyebrow className="mt-6 mb-2">{t('movementsHeading')}</Eyebrow>
              </>
            ) : (
              <View className="mt-10 items-center py-16">
                <Eyebrow>{t('noAccount.title')}</Eyebrow>
                <Text className="mt-3 text-center text-[15px] text-ink-soft">
                  {t('noAccount.body')}
                </Text>
              </View>
            )}
          </View>
        }
        renderItem={({ item }) => <MovementRow mv={item} />}
        ListEmptyComponent={
          hasAccount ? (
            <View className="items-center py-16">
              <Eyebrow>{t('empty.title')}</Eyebrow>
              <Text className="mt-3 text-center text-[15px] text-ink-soft">
                {t('empty.body')}
              </Text>
            </View>
          ) : null
        }
      />
    </SafeAreaView>
  )
}
