import { useMemo } from 'react'
import { View, Text, ScrollView, ActivityIndicator, Pressable } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { useCategories, useCurrentUser, useOrders, useProducts } from '../../lib/queries'
import { categorySelection } from '../../lib/category-selection'
import { CategoryCard } from '../../components/CategoryCard'
import { BoltIcon, Eyebrow, Hairline, PlaceholderImage, SpeedBanner } from '../../components/ui'
import { formatMoney } from '../../lib/format'

export default function HomeTab() {
  const { data: user } = useCurrentUser()
  const { data: categories, isPending: categoriesPending } = useCategories()
  const { data: products, isPending: productsPending } = useProducts()
  const { data: orders } = useOrders()

  const productCountBySlug = useMemo(() => {
    if (!products) return new Map<string, number>()
    const map = new Map<string, number>()
    for (const p of products) {
      if (p.category?.slug) {
        map.set(p.category.slug, (map.get(p.category.slug) ?? 0) + 1)
      }
    }
    return map
  }, [products])

  const lastDelivered = useMemo(
    () => (orders ?? []).find((o) => o.status === 'delivered'),
    [orders],
  )

  if (categoriesPending || productsPending) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-paper">
        <ActivityIndicator color="#220247" size="small" />
      </SafeAreaView>
    )
  }

  const cats = categories ?? []
  const firstName = user?.fullName?.split(' ')[0] ?? ''
  const neighborhood = user?.addressDefault?.text?.split('·').pop()?.trim() ?? 'New York'

  function handleCategoryPress(slug: string) {
    categorySelection.set(slug)
    router.navigate('/(tabs)/catalog')
  }

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-paper">
      <ScrollView contentContainerClassName="px-5 pb-10 pt-5">
        {/* Header: greeting + brand tile */}
        <View className="flex-row items-start justify-between">
          <View className="flex-1 pr-4">
            <Eyebrow className="mb-3">Inicio · {neighborhood}</Eyebrow>
            <Text className="font-sans-semibold text-[36px] leading-[40px] tracking-tight text-ink">
              ¿Qué{' '}
              <Text className="font-sans-italic text-ink">necesitas</Text>
              {firstName ? `,\n${firstName}?` : '?'}
            </Text>
          </View>
          <View className="h-[38px] w-[38px] items-center justify-center bg-brand">
            <BoltIcon size={16} color="#F5E447" />
          </View>
        </View>

        {/* Speed banner */}
        <View className="mt-6">
          <SpeedBanner estimate="30–45 min" zone={neighborhood} />
        </View>

        {/* Categories */}
        <View className="mt-7 flex-col gap-3">
          <Eyebrow>Categorías</Eyebrow>
          {cats.length === 0 ? (
            <Eyebrow className="mt-2">(no hay categorías cargadas)</Eyebrow>
          ) : (
            <View className="flex-row flex-wrap gap-2.5">
              {cats.map((c, i) => (
                <View key={c.id} style={{ width: '48.5%' }}>
                  <CategoryCard
                    category={c}
                    productCount={productCountBySlug.get(c.slug) ?? 0}
                    variant="category"
                    dark={i === 0}
                    onPress={() => handleCategoryPress(c.slug)}
                  />
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Reorder shortcut */}
        {lastDelivered ? (
          <>
            <Hairline className="mt-7" />
            <View className="mt-6">
              <Eyebrow className="mb-3">Tu último pedido</Eyebrow>
              <View className="flex-row items-center gap-3 border border-ink/15 p-3">
                <PlaceholderImage
                  label={lastDelivered.items?.[0]?.product?.name?.slice(0, 3)?.toUpperCase() ?? 'PED'}
                  size={56}
                />
                <View className="flex-1">
                  <Text className="font-sans-semibold text-[14px] text-ink" numberOfLines={1}>
                    {lastDelivered.items?.[0]?.product?.name ?? 'Pedido anterior'}
                    {(lastDelivered.items?.length ?? 0) > 1 ? ` +${(lastDelivered.items?.length ?? 0) - 1}` : ''}
                  </Text>
                  <Text className="font-sans text-[11px] text-ink-muted">
                    Entregado · {formatMoney(lastDelivered.totalAmount ?? '0')}
                  </Text>
                </View>
                <Pressable
                  onPress={() => router.navigate('/(tabs)/catalog')}
                  className="h-9 items-center justify-center border border-ink/40 px-3"
                >
                  <Text className="font-sans-medium text-[10px] uppercase tracking-label text-ink">
                    Repetir →
                  </Text>
                </Pressable>
              </View>
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}
