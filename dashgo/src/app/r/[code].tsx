import { View, Text, ActivityIndicator, Pressable } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { usePromoterByCode } from '../../lib/queries'
import { Button, Eyebrow } from '../../components/ui'

export default function ReferralLandingScreen() {
  const { t } = useTranslation('auth')
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
        <ActivityIndicator color="#1A1530" size="small" />
      </SafeAreaView>
    )
  }

  if (isError || !data) {
    return (
      <SafeAreaView edges={['top']} className="flex-1 bg-paper">
        <View className="flex-1 items-center justify-center px-6 py-20">
          <Eyebrow className="mb-4">{t('referralLanding.eyebrow')}</Eyebrow>
          <Text className="text-center font-sans-semibold text-[36px] leading-[40px] text-ink">
            {t('referralLanding.invalidTitle')}{' '}
            <Text className="font-sans-italic text-bad">
              {t('referralLanding.invalidTitleAccent')}
            </Text>
          </Text>
          <Text className="mt-6 max-w-sm text-center text-[15px] leading-[22px] text-ink-muted">
            {t('referralLanding.invalidHelp')}
          </Text>
          <View className="mt-10 w-full max-w-xs">
            <Button
              variant="ink"
              size="lg"
              onPress={() => router.replace('/(auth)/login')}
            >
              {t('referralLanding.goToLogin')}
            </Button>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-paper">
      <View className="flex-1 items-center justify-center px-6 py-20">
        <Eyebrow className="mb-4">{t('referralLanding.eyebrow')}</Eyebrow>

        <Text className="text-center font-sans-semibold text-[40px] leading-[44px] text-ink">
          {t('referralLanding.invitedByPrefix')}
          <Text className="font-sans-italic text-brand">
            {data.fullName}
          </Text>
          {t('referralLanding.invitedBySuffix')}{' '}🎉
        </Text>

        <Text className="mt-6 max-w-sm text-center text-[15px] leading-[22px] text-ink-muted">
          {t('referralLanding.subtitle')}
        </Text>

        <View className="mt-10 items-center">
          <Eyebrow>{t('referralLanding.codeEyebrow')}</Eyebrow>
          <Pressable onPress={goLogin} className="min-h-[48px] justify-center py-3">
            <Text className="mt-2 font-sans text-[22px] tracking-[6px] text-brand">
              {code}
            </Text>
          </Pressable>
        </View>

        <View className="mt-12 w-full max-w-xs">
          <Button variant="accent" size="lg" onPress={goLogin}>
            {t('referralLanding.createAccount')}
          </Button>
        </View>
      </View>
    </SafeAreaView>
  )
}
