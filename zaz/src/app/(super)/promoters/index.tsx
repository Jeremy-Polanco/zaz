import { useMemo, useState } from 'react'
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
import { router } from 'expo-router'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useInvitePromoter, usePromoters } from '../../../lib/queries'
import {
  invitePromoterSchema,
  type InvitePromoterInput,
} from '../../../lib/schemas'
import type { Promoter } from '../../../lib/types'
import { formatCents } from '../../../lib/format'
import {
  Button,
  Card,
  Eyebrow,
  FieldError,
  FieldLabel,
  Hairline,
  KpiCard,
  Metric,
  SectionHead,
} from '../../../components/ui'

function InviteForm({ onDone }: { onDone: () => void }) {
  const invite = useInvitePromoter()
  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<InvitePromoterInput>({
    resolver: zodResolver(invitePromoterSchema),
    defaultValues: { phone: '', fullName: '' },
  })

  const onSubmit = handleSubmit(async (values) => {
    try {
      await invite.mutateAsync(values)
      reset()
      onDone()
    } catch (e) {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? 'No se pudo crear el promotor'
      Alert.alert('Error', msg)
    }
  })

  return (
    <Card className="mb-8">
      <Eyebrow className="mb-4" tone="accent">
        Nuevo
      </Eyebrow>
      <Text className="mb-6 font-sans-semibold text-[26px] leading-[30px] text-ink">
        Nuevo promotor
      </Text>

      <FieldLabel>Teléfono (E.164)</FieldLabel>
      <Controller
        control={control}
        name="phone"
        render={({ field: { onChange, value } }) => (
          <TextInput
            className="h-11 border-b border-ink/25 pb-1 font-sans text-[16px] text-ink"
            placeholder="+18091234567"
            placeholderTextColor="#6B6488"
            keyboardType="phone-pad"
            autoCapitalize="none"
            value={value}
            onChangeText={onChange}
          />
        )}
      />
      <FieldError message={errors.phone?.message} />

      <View className="mt-5">
        <FieldLabel>Nombre completo</FieldLabel>
        <Controller
          control={control}
          name="fullName"
          render={({ field: { onChange, value } }) => (
            <TextInput
              className="h-11 border-b border-ink/25 pb-1 font-sans text-[16px] text-ink"
              placeholder="María González"
              placeholderTextColor="#6B6488"
              value={value}
              onChangeText={onChange}
            />
          )}
        />
        <FieldError message={errors.fullName?.message} />
      </View>

      <View className="mt-6 flex-row gap-3">
        <View className="flex-1">
          <Button
            variant="accent"
            loading={invite.isPending}
            onPress={onSubmit}
          >
            Crear promotor
          </Button>
        </View>
        <Button variant="ghost" onPress={onDone} disabled={invite.isPending}>
          Cancelar
        </Button>
      </View>
    </Card>
  )
}

function PromoterRow({ promoter }: { promoter: Promoter }) {
  const claimable = promoter.claimableCents ?? 0
  const pending = promoter.pendingCents ?? 0
  return (
    <Pressable
      onPress={() => router.push(`/(super)/promoters/${promoter.id}`)}
      className="border-b border-ink/10 py-4 active:bg-ink/5"
    >
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1">
          <Text className="font-sans-semibold text-[20px] leading-[24px] text-ink">
            {promoter.fullName}
          </Text>
          <Text
            className="mt-0.5 font-sans text-[10px] uppercase tracking-label text-ink-muted"
            style={{ fontVariant: ['tabular-nums'] }}
          >
            {promoter.phone ?? '—'} · {promoter.referralCode ?? '—'}
          </Text>
        </View>
        <View className="items-end">
          <Eyebrow>Referidos</Eyebrow>
          <Text
            className="font-sans-semibold text-[22px] leading-[24px] text-ink"
            style={{ fontVariant: ['tabular-nums'] }}
          >
            {promoter.referredCount}
          </Text>
        </View>
      </View>

      <View className="mt-3 flex-row gap-3">
        <View className="flex-1 border border-ink/15 bg-paper-deep/30 px-3 py-2">
          <Text className="font-sans text-[9px] uppercase tracking-label text-ink-muted">
            Disponible
          </Text>
          <Text
            className={`mt-0.5 font-sans text-[15px] font-semibold ${
              claimable > 0 ? 'text-brand' : 'text-ink-muted'
            }`}
            style={{ fontVariant: ['tabular-nums'] }}
          >
            {formatCents(claimable)}
          </Text>
        </View>
        <View className="flex-1 border border-ink/15 bg-paper-deep/30 px-3 py-2">
          <Text className="font-sans text-[9px] uppercase tracking-label text-ink-muted">
            Pendiente
          </Text>
          <Text
            className="mt-0.5 font-sans text-[15px] text-ink-muted"
            style={{ fontVariant: ['tabular-nums'] }}
          >
            {formatCents(pending)}
          </Text>
        </View>
        <View className="items-center justify-center px-2">
          <Text className="font-sans text-[11px] uppercase tracking-label text-brand">
            Ver →
          </Text>
        </View>
      </View>
    </Pressable>
  )
}

export default function SuperPromotersScreen() {
  const {
    data: promoters,
    isPending,
    refetch,
    isRefetching,
  } = usePromoters()
  const [creating, setCreating] = useState(false)
  const count = useMemo(() => promoters?.length ?? 0, [promoters])

  if (isPending) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-paper">
        <ActivityIndicator color="#220247" size="small" />
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-paper">
      <FlatList
        data={creating ? [] : promoters ?? []}
        keyExtractor={(p) => p.id}
        contentContainerClassName="px-5 pb-12"
        refreshing={isRefetching}
        onRefresh={refetch}
        ListHeaderComponent={
          <View className="pb-2 pt-6">
            <SectionHead
              eyebrow="Panel · Promotores"
              title="Promotores"
              italicTail="y códigos."
              subtitle="Invitá gente para que traiga clientes a Zaz."
            />

            <View className="mb-7 flex-row gap-2">
              <KpiCard label="Promotores" value={count} tone="idle" />
              <KpiCard
                label="Con referidos"
                value={(promoters ?? []).filter((p) => p.referredCount > 0).length}
                tone="ok"
              />
              <KpiCard
                label="Sin referir"
                value={(promoters ?? []).filter((p) => p.referredCount === 0).length}
                tone="warn"
              />
            </View>

            {creating ? (
              <InviteForm onDone={() => setCreating(false)} />
            ) : (
              <View className="mb-6">
                <Button variant="accent" onPress={() => setCreating(true)}>
                  + Nuevo promotor
                </Button>
              </View>
            )}

            {!creating && <Hairline className="mb-2" />}
          </View>
        }
        renderItem={({ item }) => <PromoterRow promoter={item} />}
        ListEmptyComponent={
          !creating ? (
            <View className="items-center py-16">
              <Eyebrow>Sin promotores</Eyebrow>
              <Text className="mt-3 text-center text-[15px] text-ink-soft">
                Invitá al primero para empezar.
              </Text>
            </View>
          ) : null
        }
      />
    </SafeAreaView>
  )
}
