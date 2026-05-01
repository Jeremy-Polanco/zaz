import { View, Text, ActivityIndicator, Pressable } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, router } from 'expo-router'
import { usePromoterByCode } from '../../lib/queries'
import { Button, Eyebrow } from '../../components/ui'

export default function ReferralLandingScreen() {
  const params = useLocalSearchParams<{ code: string }>()
  const code = typeof params.code === 'string' ? params.code.toUpperCase() : ''
  const { data, isPending, isError } = usePromoterByCode(code || undefined)

  const goLogin = () => {
    router.replace({
      pathname: '/(auth)/login',
      params: { ref: code },
    })
  }

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
        <View className="flex-1 items-center justify-center px-6 py-20">
          <Eyebrow className="mb-4">Invitación</Eyebrow>
          <Text className="text-center font-sans-semibold text-[36px] leading-[40px] text-ink">
            Código{' '}
            <Text className="font-sans-italic text-bad">no válido.</Text>
          </Text>
          <Text className="mt-6 max-w-sm text-center text-[15px] leading-[22px] text-ink-muted">
            Revisá el link. Si sigue sin funcionar, pedile al promotor que te
            reenvíe el código.
          </Text>
          <View className="mt-10 w-full max-w-xs">
            <Button
              variant="ink"
              size="lg"
              onPress={() => router.replace('/(auth)/login')}
            >
              Entrar a Zaz
            </Button>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-paper">
      <View className="flex-1 items-center justify-center px-6 py-20">
        <Eyebrow className="mb-4">Invitación</Eyebrow>

        <Text className="text-center font-sans-semibold text-[40px] leading-[44px] text-ink">
          Te invitó{' '}
          <Text className="font-sans-italic text-brand">
            {data.fullName}
          </Text>{' '}
          🎉
        </Text>

        <Text className="mt-6 max-w-sm text-center text-[15px] leading-[22px] text-ink-muted">
          Creá tu cuenta usando este código y súmate a Zaz — tu colmado al
          timbre.
        </Text>

        <View className="mt-10 items-center">
          <Eyebrow>Código</Eyebrow>
          <Pressable onPress={goLogin}>
            <Text className="mt-2 font-sans text-[22px] tracking-[6px] text-brand">
              {code}
            </Text>
          </Pressable>
        </View>

        <View className="mt-12 w-full max-w-xs">
          <Button variant="accent" size="lg" onPress={goLogin}>
            Crear cuenta con este código →
          </Button>
        </View>
      </View>
    </SafeAreaView>
  )
}
