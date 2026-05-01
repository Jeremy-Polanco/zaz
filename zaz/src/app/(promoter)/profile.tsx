import { View, Text, ActivityIndicator, ScrollView, Pressable } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { SymbolView } from 'expo-symbols'
import type { SFSymbol } from 'sf-symbols-typescript'
import { useCurrentUser, useLogout } from '../../lib/queries'
import { Button, Eyebrow, Hairline, ZazMark } from '../../components/ui'

type AccountLinkProps = {
  label: string
  iosIcon: SFSymbol
  androidIcon: string
  href: string
  hint?: string
}

function AccountLink({ label, iosIcon, androidIcon, href, hint }: AccountLinkProps) {
  return (
    <Pressable
      onPress={() => router.navigate(href as never)}
      className="flex-row items-center justify-between py-4 active:opacity-60"
    >
      <View className="flex-row items-center gap-3">
        <SymbolView
          name={{ ios: iosIcon, android: androidIcon }}
          size={22}
          tintColor="#1A1530"
          resizeMode="scaleAspectFit"
          fallback={<Text style={{ fontSize: 18 }}>•</Text>}
        />
        <View>
          <Text className="font-sans-medium text-[16px] text-ink">{label}</Text>
          {hint ? (
            <Text className="font-sans text-[11px] text-ink-muted">{hint}</Text>
          ) : null}
        </View>
      </View>
      <SymbolView
        name={{ ios: 'chevron.right', android: 'chevron_right' }}
        size={16}
        tintColor="#6B6488"
        resizeMode="scaleAspectFit"
        fallback={<Text style={{ fontSize: 16, color: '#6B6488' }}>›</Text>}
      />
    </Pressable>
  )
}

export default function PromoterProfileScreen() {
  const { data: user, isPending } = useCurrentUser()
  const logout = useLogout()

  if (isPending) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-paper">
        <ActivityIndicator color="#220247" size="small" />
      </SafeAreaView>
    )
  }

  const handleLogout = async () => {
    await logout()
    router.replace('/(auth)/login')
  }

  const initial = user?.fullName?.[0]?.toUpperCase() ?? '·'

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-paper">
      <ScrollView contentContainerClassName="pb-10">
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
              Promotor · Cuenta
            </Text>
          </View>
          <View className="mt-4 flex-row items-baseline">
            <Text className="font-sans-italic text-[40px] leading-[44px] text-paper">
              Tu
            </Text>
            <Text className="font-sans-semibold text-[40px] leading-[44px] text-paper">
              {' '}cuenta.
            </Text>
          </View>
          <Text
            className="mt-3 text-[13px] leading-[20px]"
            style={{ color: 'rgba(255,255,255,0.7)', maxWidth: 280 }}
          >
            Tu identidad, tu actividad y tu sesión.
          </Text>
        </View>

        <View className="px-5">
          {/* Identity block */}
          <View className="mt-6 flex-row items-center gap-5">
            <View className="h-16 w-16 items-center justify-center bg-ink">
              <Text className="font-sans-semibold text-3xl text-paper">
                {initial}
              </Text>
            </View>
            <View className="flex-1">
              <Text className="font-sans-semibold text-[22px] leading-[26px] text-ink">
                {user?.fullName ?? '—'}
              </Text>
              <Text className="mt-0.5 text-[13px] text-ink-soft">
                {user?.phone ?? ''}
              </Text>
            </View>
          </View>

          <View className="mt-8">
            <Eyebrow>Rol</Eyebrow>
            <Text className="mt-1.5 font-sans-semibold text-[18px] text-ink">
              Promotor
            </Text>
          </View>

          {user?.phone && (
            <View className="mt-6">
              <Eyebrow>Teléfono</Eyebrow>
              <Text
                className="mt-1.5 font-sans-medium text-[16px] text-ink"
                style={{ fontVariant: ['tabular-nums'] }}
              >
                {user.phone}
              </Text>
            </View>
          )}

          <Hairline className="mt-10" />

          <View className="mt-6">
            <Eyebrow className="mb-1">Mi actividad</Eyebrow>
            <AccountLink
              label="Comisiones"
              hint="Historial completo"
              iosIcon="dollarsign.circle.fill"
              androidIcon="attach_money"
              href="/(promoter)/commissions"
            />
            <AccountLink
              label="Pagos recibidos"
              hint="Lo que el admin te pagó"
              iosIcon="arrow.down.circle.fill"
              androidIcon="download"
              href="/(promoter)/payouts"
            />
            <AccountLink
              label="Catálogo"
              hint="Haz pedidos como cliente"
              iosIcon="square.grid.2x2.fill"
              androidIcon="apps"
              href="/(promoter)/catalog"
            />
            <AccountLink
              label="Puntos"
              hint="Tu balance de puntos"
              iosIcon="star.fill"
              androidIcon="star"
              href="/(promoter)/points"
            />
          </View>

          <Hairline className="mt-8" />

          <View className="mt-8">
            <Button variant="outline" size="lg" onPress={handleLogout}>
              Cerrar sesión →
            </Button>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}
