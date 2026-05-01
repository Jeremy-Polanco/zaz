import { View, Text } from 'react-native'

interface SuscriptorBadgeProps {
  wasSubscriber: boolean
}

export function SuscriptorBadge({ wasSubscriber }: SuscriptorBadgeProps) {
  if (!wasSubscriber) return null
  return (
    <View className="rounded-full bg-green-100 px-2 py-0.5">
      <Text className="font-sans text-[9px] uppercase tracking-label text-green-700">
        Suscriptor
      </Text>
    </View>
  )
}
