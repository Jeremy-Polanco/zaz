import { View, Text } from 'react-native'
import { useTranslation } from 'react-i18next'

interface SuscriptorBadgeProps {
  wasSubscriber: boolean
}

export function SuscriptorBadge({ wasSubscriber }: SuscriptorBadgeProps) {
  const { t } = useTranslation('common')
  if (!wasSubscriber) return null
  return (
    <View className="rounded-full bg-green-100 px-2 py-0.5">
      <Text className="font-sans text-[9px] uppercase tracking-label text-green-700">
        {t('subscriber')}
      </Text>
    </View>
  )
}
