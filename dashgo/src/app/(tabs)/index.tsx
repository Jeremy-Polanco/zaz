import { useMemo } from 'react'
import { View, Text, ScrollView, ActivityIndicator, Pressable } from 'react-native'
import { useTranslation } from 'react-i18next'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { useCategories, useCurrentUser, useOrders, useProducts } from '../../lib/queries'
import { categorySelection } from '../../lib/category-selection'
import { CategoryCard } from '../../components/CategoryCard'
import { BoltIcon, Eyebrow, Hairline, PlaceholderImage } from '../../components/ui'
import { MaintenanceBanner } from '../../components/MaintenanceBanner'
import { formatMoney } from '../../lib/format'

export default function HomeTab() {
  const { t } = useTranslation('home')
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
        <ActivityIndicator color="#1A1530" size="small" />
      </SafeAreaView>
    )
  }

  const cats = categories ?? []
  const firstName = user?.fullName?.split(' ')[0] ?? ''

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
            <Eyebrow className="mb-3">{t('eyebrow')}</Eyebrow>
            <Text className="font-sans-semibold text-[36px] leading-[40px] tracking-tight text-ink">
              {t('greeting.prefix')}{' '}
              <Text className="font-sans-italic text-ink">{t('greeting.emphasis')}</Text>
              {firstName
                ? t('greeting.suffixWithName', { name: firstName })
                : t('greeting.suffix')}
            </Text>
          </View>
          <View className="h-[38px] w-[38px] items-center justify-center bg-brand">
            <BoltIcon size={16} color="#FF8000" />
          </View>
        </View>

        {/* Bebedero maintenance countdown / alert */}
        <View className="mt-6">
          <MaintenanceBanner />
        </View>

        {/* Categories */}
        <View className="mt-7 flex-col gap-3">
          <Eyebrow>{t('categories.title')}</Eyebrow>
          {cats.length === 0 ? (
            <Eyebrow className="mt-2">{t('categories.empty')}</Eyebrow>
          ) : (
            // Full-width hero cards — one per row, matching the catalog picker.
            // The client asked for the home categories to read as big as the
            // picker's, so they share the `large` CategoryCard.
            <View style={{ gap: 10 }}>
              {cats.map((c, i) => (
                <CategoryCard
                  key={c.id}
                  category={c}
                  productCount={productCountBySlug.get(c.slug) ?? 0}
                  variant="category"
                  dark={i === 0}
                  large
                  onPress={() => handleCategoryPress(c.slug)}
                />
              ))}
            </View>
          )}
        </View>

        {/* Reorder shortcut */}
        {lastDelivered ? (
          <>
            <Hairline className="mt-7" />
            <View className="mt-6">
              <Eyebrow className="mb-3">{t('lastOrder.title')}</Eyebrow>
              <View className="flex-row items-center gap-3 border border-ink/15 p-3">
                <PlaceholderImage
                  label={lastDelivered.items?.[0]?.product?.name?.slice(0, 3)?.toUpperCase() ?? t('lastOrder.placeholder')}
                  size={56}
                />
                <View className="flex-1">
                  <Text className="font-sans-semibold text-[14px] text-ink" numberOfLines={1}>
                    {lastDelivered.items?.[0]?.product?.name ?? t('lastOrder.fallbackName')}
                    {(lastDelivered.items?.length ?? 0) > 1 ? ` +${(lastDelivered.items?.length ?? 0) - 1}` : ''}
                  </Text>
                  <Text className="font-sans text-[13px] text-ink-muted">
                    {t('lastOrder.delivered', { amount: formatMoney(lastDelivered.totalAmount ?? '0') })}
                  </Text>
                </View>
                <Pressable
                  onPress={() => router.navigate('/(tabs)/catalog')}
                  className="min-h-[48px] items-center justify-center border border-ink/40 px-3"
                >
                  <Text className="font-sans-medium text-[12px] uppercase tracking-label text-ink">
                    {t('lastOrder.repeat')}
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
