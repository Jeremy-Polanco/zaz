import { useEffect } from 'react'
import { View, ActivityIndicator, Text } from 'react-native'
import { router } from 'expo-router'
import { useCurrentUser } from '../lib/queries'

export default function Index() {
  const { data: user, isPending } = useCurrentUser()

  useEffect(() => {
    if (isPending) return
    if (!user) {
      router.replace('/(auth)/login')
      return
    }
    if (user.role === 'super_admin_delivery') {
      router.replace('/(super)')
    } else if (user.role === 'promoter') {
      router.replace('/(promoter)')
    } else {
      router.replace('/(tabs)')
    }
  }, [user, isPending])

  return (
    <View className="flex-1 items-center justify-center bg-paper">
      <Text className="font-sans-semibold text-5xl text-ink">Zaz</Text>
      <View className="mt-6 h-[2px] w-12 bg-accent" />
      <ActivityIndicator color="#220247" size="small" className="mt-6" />
    </View>
  )
}
