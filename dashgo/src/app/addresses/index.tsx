import {
  View,
  Text,
  FlatList,
  Pressable,
  ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router, Stack } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useMyAddresses } from '../../lib/queries'
import type { UserAddress } from '../../lib/types'
import { ScreenHeader } from '../../components/ScreenHeader'

function AddressCard({ address }: { address: UserAddress }) {
  const { t } = useTranslation('addresses')
  return (
    <Pressable
      onPress={() => router.push(`/addresses/${address.id}` as never)}
      className="flex-row items-center justify-between border-b border-ink/10 py-4 active:opacity-60"
    >
      <View className="flex-1 gap-0.5">
        <View className="flex-row items-center gap-2">
          <Text className="font-sans-semibold text-[17px] text-ink">
            {address.label}
          </Text>
          {address.isDefault && (
            <View className="rounded-sm bg-brand/10 px-1.5 py-0.5">
              <Text className="text-[12px] font-sans-medium text-brand">
                {t('defaultBadge')}
              </Text>
            </View>
          )}
        </View>
        <Text className="text-[15px] text-ink-soft" numberOfLines={1}>
          {address.line1}
        </Text>
      </View>
      <Text className="ml-3 text-[20px] text-ink-soft">›</Text>
    </Pressable>
  )
}

export default function AddressesIndex() {
  const { t } = useTranslation('addresses')
  const { data: addresses, isPending } = useMyAddresses()

  if (isPending) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-paper">
        <Stack.Screen options={{ title: t('title') }} />
        <ActivityIndicator color="#1A1530" size="small" />
      </SafeAreaView>
    )
  }

  const list = addresses ?? []

  return (
    <SafeAreaView edges={['bottom']} className="flex-1 bg-paper">
      <Stack.Screen options={{ title: t('title') }} />
      <ScreenHeader title={t('title')} />
      <View className="flex-1 px-5">
        {list.length === 0 ? (
          <View className="flex-1 items-center justify-center gap-4">
            <Text className="text-[17px] text-ink-soft">
              {t('empty')}
            </Text>
            <Pressable
              onPress={() => router.push('/addresses/new' as never)}
              className="min-h-[48px] justify-center rounded-lg bg-brand px-6 py-3 active:opacity-70"
            >
              <Text className="font-sans-semibold text-[16px] text-paper">
                {t('addAddress')}
              </Text>
            </Pressable>
          </View>
        ) : (
          <>
            <FlatList
              data={list}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => <AddressCard address={item} />}
              contentContainerStyle={{ paddingBottom: 100 }}
            />
            <View className="absolute bottom-8 left-5 right-5">
              <Pressable
                onPress={() => router.push('/addresses/new' as never)}
                className="items-center rounded-xl bg-brand py-4 shadow-sm active:opacity-70"
              >
                <Text className="font-sans-semibold text-[16px] text-paper">
                  {t('addAddress')}
                </Text>
              </Pressable>
            </View>
          </>
        )}
      </View>
    </SafeAreaView>
  )
}
