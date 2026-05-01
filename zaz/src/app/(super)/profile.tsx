import { View, Text, ActivityIndicator, ScrollView } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { useCurrentUser, useLogout } from '../../lib/queries'
import { Button, Eyebrow, Hairline, ZazMark } from '../../components/ui'

export default function SuperProfileScreen() {
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
        <View className="relative bg-brand px-6 pb-8 pt-10">
          <View className="absolute right-6 top-5">
            <ZazMark size={20} />
          </View>
          <View className="mt-2 flex-row items-center gap-2">
            <View className="h-1.5 w-1.5 bg-accent" />
            <Text
              className="font-sans-medium text-[11px] uppercase tracking-eyebrow"
              style={{ color: 'rgba(245,228,71,0.9)' }}
            >
              Agua · New York · Admin
            </Text>
          </View>
          <View className="mt-5 flex-row items-baseline">
            <Text className="font-sans-italic text-[44px] leading-[44px] text-paper">
              Reparto
            </Text>
            <Text className="font-sans-semibold text-[44px] leading-[44px] text-paper">
              .
            </Text>
          </View>
          <Text
            className="mt-3 text-[13px] leading-[20px]"
            style={{ color: 'rgba(255,255,255,0.7)', maxWidth: 280 }}
          >
            Tu sesión, identidad y atajos del panel.
          </Text>
        </View>

        <View className="px-5">
          {/* Identity block */}
          <View className="mt-6 flex-row items-center gap-5">
            <View className="h-16 w-16 items-center justify-center bg-ink">
              <Text className="font-sans-semibold text-3xl text-paper">{initial}</Text>
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
              Super Admin · Reparto
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

          {user?.addressDefault?.text && (
            <View className="mt-6">
              <Eyebrow>Origen de reparto</Eyebrow>
              <Text className="mt-1.5 text-[15px] leading-[22px] text-ink">
                {user.addressDefault.text}
              </Text>
              <Text className="mt-1 font-sans text-[11px] uppercase tracking-label text-ink-muted">
                Punto desde el que se calcula el shipping
              </Text>
            </View>
          )}

          <Hairline className="mt-10" />

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
