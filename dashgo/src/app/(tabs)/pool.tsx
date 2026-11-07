import { ActivityIndicator, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import {
  useCurrentUser,
  useMyAssociateBalance,
  usePoolSummary,
} from '../../lib/queries'
import { formatCents } from '../../lib/format'
import { formatDistributionDate, parseQuarter } from '../../lib/pool'
import { isAssociate } from '../../lib/roles'
import type { AssociateBalanceEntry } from '../../lib/types'
import { Card, Eyebrow, Hairline, Nums, SectionHead } from '../../components/ui'

function quarterText(t: TFunction, quarter: string): string {
  const q = parseQuarter(quarter)
  return q ? t('quarterLabel', { n: q.n, year: q.year }) : quarter
}

function entryTitle(t: TFunction, entry: AssociateBalanceEntry): string {
  switch (entry.type) {
    case 'allocation':
      return entry.quarter
        ? t('allocation', { quarter: quarterText(t, entry.quarter) })
        : t('allocationNoQuarter')
    case 'redemption':
      return t('redemption')
    case 'reversal':
      return t('reversal')
  }
}

function signedCents(cents: number): string {
  return cents < 0 ? `-${formatCents(-cents)}` : `+${formatCents(cents)}`
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View className="mt-4">
      <Text className="font-sans text-[12px] uppercase tracking-label text-ink-muted">
        {label}
      </Text>
      {children}
    </View>
  )
}

/**
 * Pool de asociados — espejo de la `/pool` web. Lo ve cualquiera con sesión:
 * un ex asociado conserva su saldo y su historial; el resumen del trimestre
 * (que la API rechaza con 403 a quien no es asociado) solo se pide a los
 * asociados.
 */
export default function PoolTab() {
  const { t, i18n } = useTranslation('pool')
  const locale = i18n.language.startsWith('en') ? 'en' : 'es'
  const { data: me } = useCurrentUser()
  const associate = isAssociate(me?.role)
  const { data: balance, isPending: balancePending } = useMyAssociateBalance(!!me)
  const { data: summary } = usePoolSummary(associate)

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-paper">
      <ScrollView contentContainerClassName="px-5 pb-8">
        <View className="pt-6">
          <SectionHead
            eyebrow={t('eyebrow')}
            title={t('title')}
            subtitle={t('subtitle')}
          />
        </View>

        {associate && summary && (
          <Card className="mb-4">
            <Eyebrow>{quarterText(t, summary.quarter)}</Eyebrow>
            <Stat label={t('poolOfQuarter')}>
              <Nums className="mt-1 font-sans-semibold text-[28px]">
                {formatCents(summary.poolCents)}
              </Nums>
            </Stat>
            <Stat label={t('estimatedShare')}>
              <Nums className="mt-1 font-sans-semibold text-[28px]">
                {formatCents(summary.estimatedShareCents)}
              </Nums>
            </Stat>
            <Text className="mt-4 text-[15px] text-ink">
              {t('nextDistribution', {
                date: formatDistributionDate(summary.nextDistributionAt, locale),
              })}
            </Text>
            <Text className="mt-1 text-[15px] text-ink">
              {t('associates', { count: summary.associateCount })}
            </Text>
          </Card>
        )}

        <Card className="mb-4">
          <Eyebrow>{t('balance')}</Eyebrow>
          <Nums className="mt-2 font-sans-semibold text-[36px]">
            {balancePending || !balance ? '…' : formatCents(balance.balanceCents)}
          </Nums>
          <Text className="mt-2 text-[14px] text-ink-muted">{t('balanceHint')}</Text>
        </Card>

        <Card>
          <Eyebrow>{t('history')}</Eyebrow>
          {balancePending || !balance ? (
            <View className="mt-4 items-center">
              <ActivityIndicator color="#1A1530" size="small" />
            </View>
          ) : balance.entries.length === 0 ? (
            <Text className="mt-4 text-[14px] text-ink-muted">{t('empty')}</Text>
          ) : (
            balance.entries.map((entry) => (
              <View key={entry.id}>
                <View className="flex-row items-center justify-between gap-4 py-3">
                  <View className="flex-1">
                    <Text className="font-sans-medium text-[15px] text-ink">
                      {entryTitle(t, entry)}
                    </Text>
                    <Text className="mt-0.5 text-[12px] text-ink-muted">
                      {formatDistributionDate(entry.createdAt, locale)}
                    </Text>
                  </View>
                  <Nums
                    className={`font-sans-medium text-[15px] ${
                      entry.amountCents < 0 ? 'text-ink-muted' : 'text-ok'
                    }`}
                  >
                    {signedCents(entry.amountCents)}
                  </Nums>
                </View>
                <Hairline />
              </View>
            ))
          )}
        </Card>
      </ScrollView>
    </SafeAreaView>
  )
}
