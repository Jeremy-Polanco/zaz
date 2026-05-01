import { useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  Text,
  View,
} from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { usePromoterDashboard } from '../../lib/queries'
import type {
  Payout,
  PromoterCommissionEntry,
  ReferredCustomerSummary,
} from '../../lib/types'
import { formatCents, formatDate } from '../../lib/format'
import {
  BoltIcon,
  Button,
  Eyebrow,
  Hairline,
  KpiCard,
  ZazMark,
} from '../../components/ui'

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
            className="mt-0.5 font-sans-semibold text-[14px] text-brand"
            style={{ fontVariant: ['tabular-nums'] }}
          >
            {formatCents(customer.totalCommissionGeneratedCents)}
          </Text>
        </View>
      </View>
    </View>
  )
}

function commissionLabel(entry: PromoterCommissionEntry): string {
  if (entry.type === 'paid_out') return 'Pago recibido'
  if (entry.status === 'pending') return 'Pendiente (90 días)'
  if (entry.status === 'claimable') return 'Disponible'
  if (entry.status === 'paid') return 'Pagada'
  return entry.status
}

function commissionDot(entry: PromoterCommissionEntry): string {
  if (entry.type === 'paid_out') return 'bg-ok'
  if (entry.status === 'pending') return 'bg-warn'
  if (entry.status === 'claimable') return 'bg-brand'
  if (entry.status === 'paid') return 'bg-ok'
  return 'bg-ink-muted'
}

function CommissionMiniRow({ entry }: { entry: PromoterCommissionEntry }) {
  const negative = entry.amountCents < 0
  return (
    <View className="flex-row items-start justify-between gap-3 border-b border-ink/10 py-3">
      <View className="flex-1 flex-row items-start gap-2.5">
        <View className={`mt-1.5 h-1.5 w-1.5 rounded-full ${commissionDot(entry)}`} />
        <View className="flex-1">
          <Text className="font-sans-medium text-[14px] text-ink">
            {commissionLabel(entry)}
          </Text>
          <Text className="mt-0.5 font-sans text-[10px] uppercase tracking-label text-ink-muted">
            {formatDate(entry.createdAt)}
            {entry.referredUserName ? ` · ${entry.referredUserName}` : ''}
          </Text>
        </View>
      </View>
      <Text
        className={`font-sans-semibold text-[14px] ${negative ? 'text-bad' : 'text-ink'}`}
        style={{ fontVariant: ['tabular-nums'] }}
      >
        {negative ? '−' : '+'}
        {formatCents(Math.abs(entry.amountCents))}
      </Text>
    </View>
  )
}

function PayoutMiniRow({ payout }: { payout: Payout }) {
  return (
    <View className="border-b border-ink/10 py-3">
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1">
          <Text
            className="font-sans-semibold text-[15px] text-ink"
            style={{ fontVariant: ['tabular-nums'] }}
          >
            {formatCents(payout.amountCents)}
          </Text>
          <Text className="mt-0.5 font-sans text-[10px] uppercase tracking-label text-ink-muted">
            {formatDate(payout.createdAt)}
          </Text>
          {payout.notes ? (
            <Text className="mt-1 text-[12px] text-ink-muted">
              "{payout.notes}"
            </Text>
          ) : null}
        </View>
        {payout.createdBy ? (
          <Text className="font-sans text-[10px] uppercase tracking-label text-ink-muted">
            {payout.createdBy.fullName}
          </Text>
        ) : null}
      </View>
    </View>
  )
}

export default function PromoterDashboardScreen() {
  const { data, isPending, isError, refetch, isRefetching } =
    usePromoterDashboard()
  const [copiedCode, setCopiedCode] = useState(false)
  const [copiedLink, setCopiedLink] = useState(false)

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
          <Text className="mt-3 text-center text-[16px] text-ink-muted">
            No pudimos cargar tu panel.
          </Text>
        </View>
      </SafeAreaView>
    )
  }

  const {
    promoter,
    balances,
    referredCount,
    referredCustomers,
    recentCommissions,
    payouts,
  } = data

  const firstName = promoter.fullName.split(' ')[0]

  const copyCode = async () => {
    if (!promoter.referralCode) return
    await Clipboard.setStringAsync(promoter.referralCode)
    setCopiedCode(true)
    setTimeout(() => setCopiedCode(false), 1500)
  }

  const copyLink = async () => {
    await Clipboard.setStringAsync(promoter.shareUrl)
    setCopiedLink(true)
    setTimeout(() => setCopiedLink(false), 1500)
  }

  const shareCode = async () => {
    try {
      await Share.share({
        message: `Te invito a Zaz — agua al timbre. Usa mi código: ${promoter.referralCode ?? ''} · ${promoter.shareUrl}`,
      })
    } catch {}
  }

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-paper">
      <ScrollView
        contentContainerClassName="pb-12"
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
        }
      >
        {/* Branded poster header */}
        <View className="relative bg-brand px-6 pb-7 pt-10">
          <View className="absolute right-6 top-5">
            <ZazMark size={20} />
          </View>
          <View className="mt-2 flex-row items-center gap-2">
            <View className="h-1.5 w-1.5 bg-accent" />
            <Text
              className="font-sans-medium text-[11px] uppercase tracking-eyebrow"
              style={{ color: 'rgba(245,228,71,0.9)' }}
            >
              Panel · Promotor
            </Text>
          </View>
          <View className="mt-4">
            <Text className="font-sans-semibold text-[40px] leading-[44px] text-paper">
              Hola,
            </Text>
            <View className="flex-row items-baseline">
              <Text className="font-sans-italic text-[40px] leading-[44px] text-accent">
                {firstName}
              </Text>
              <Text className="font-sans-semibold text-[40px] leading-[44px] text-paper">
                .
              </Text>
            </View>
          </View>
          <Text
            className="mt-3 text-[13px] leading-[20px]"
            style={{ color: 'rgba(255,255,255,0.7)', maxWidth: 280 }}
          >
            Tu código, tus referidos, tus comisiones. Comparte y ganá.
          </Text>
        </View>

        {/* KPI strip */}
        <View className="mt-5 flex-row gap-2 px-5">
          <KpiCard
            label="Disponible"
            value={formatCents(balances.claimableCents)}
            tone={balances.claimableCents > 0 ? 'attn' : 'idle'}
          />
          <KpiCard
            label="Pendiente"
            value={formatCents(balances.pendingCents)}
            tone="warn"
          />
        </View>
        <View className="mt-2 flex-row gap-2 px-5">
          <KpiCard
            label="Pagado"
            value={formatCents(balances.paidCents)}
            tone="ok"
          />
          <KpiCard label="Referidos" value={referredCount} tone="idle" />
        </View>

        {/* Hero referral code block */}
        <View className="mx-5 mt-7 bg-paper-deep px-5 py-6">
          <View className="flex-row items-center gap-2">
            <BoltIcon size={11} color="#220247" />
            <Text className="font-sans-medium text-[11px] uppercase tracking-eyebrow text-brand">
              Tu código
            </Text>
          </View>
          <Text
            className="mt-3 font-sans-semibold text-[44px] leading-[48px] text-brand"
            style={{ letterSpacing: 4, fontVariant: ['tabular-nums'] }}
            numberOfLines={1}
          >
            {promoter.referralCode ?? '—'}
          </Text>

          <View className="mt-5 flex-row flex-wrap gap-2">
            {promoter.referralCode ? (
              <View className="flex-1">
                <Button variant="outline" onPress={copyCode}>
                  {copiedCode ? 'Copiado ✓' : 'Copiar código'}
                </Button>
              </View>
            ) : null}
            <View className="flex-1">
              <Button variant="outline" onPress={copyLink}>
                {copiedLink ? 'Copiado ✓' : 'Copiar link'}
              </Button>
            </View>
          </View>
          <View className="mt-2">
            <Button variant="accent" onPress={shareCode}>
              Compartir →
            </Button>
          </View>

          <Hairline className="mt-5" />
          <Text
            className="mt-3 font-sans text-[10px] uppercase tracking-label text-ink-muted"
            numberOfLines={2}
          >
            {promoter.shareUrl}
          </Text>
        </View>

        {/* Referred customers */}
        <View className="mt-7 px-5">
          <View className="mb-3 flex-row items-baseline justify-between">
            <Eyebrow>Clientes referidos</Eyebrow>
            <Text className="font-sans text-[10px] uppercase tracking-label text-ink-muted">
              {referredCustomers.length}{' '}
              {referredCustomers.length === 1 ? 'persona' : 'personas'}
            </Text>
          </View>
          {referredCustomers.length === 0 ? (
            <View className="border border-ink/10 px-4 py-6">
              <Text className="text-center text-[13px] text-ink-muted">
                Sin referidos todavía.{'\n'}Comparte tu código.
              </Text>
            </View>
          ) : (
            <View>
              {referredCustomers.map((c) => (
                <ReferredRow key={c.id} customer={c} />
              ))}
            </View>
          )}
        </View>

        {/* Recent commissions */}
        <View className="mt-7 px-5">
          <View className="mb-3 flex-row items-baseline justify-between">
            <Eyebrow>Últimas comisiones</Eyebrow>
            <Pressable
              onPress={() => router.push('/(promoter)/commissions')}
              className="px-2 py-1"
            >
              <Text className="font-sans-medium text-[10px] uppercase tracking-label text-brand">
                Ver todo →
              </Text>
            </Pressable>
          </View>
          {recentCommissions.length === 0 ? (
            <View className="border border-ink/10 px-4 py-6">
              <Text className="text-center text-[13px] text-ink-muted">
                Sin comisiones todavía.
              </Text>
            </View>
          ) : (
            <View>
              {recentCommissions.slice(0, 6).map((e) => (
                <CommissionMiniRow key={e.id} entry={e} />
              ))}
            </View>
          )}
        </View>

        {/* Recent payouts */}
        <View className="mt-7 px-5">
          <View className="mb-3 flex-row items-baseline justify-between">
            <Eyebrow>Pagos recibidos</Eyebrow>
            <Pressable
              onPress={() => router.push('/(promoter)/payouts')}
              className="px-2 py-1"
            >
              <Text className="font-sans-medium text-[10px] uppercase tracking-label text-brand">
                Ver todo →
              </Text>
            </Pressable>
          </View>
          {payouts.length === 0 ? (
            <View className="border border-ink/10 px-4 py-6">
              <Text className="text-center text-[13px] text-ink-muted">
                Sin pagos todavía.
              </Text>
            </View>
          ) : (
            <View>
              {payouts.slice(0, 4).map((p) => (
                <PayoutMiniRow key={p.id} payout={p} />
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}
