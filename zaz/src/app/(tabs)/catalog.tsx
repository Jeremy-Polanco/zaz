import { useEffect, useMemo, useState } from 'react'
import {
  View,
  Text,
  FlatList,
  Pressable,
  ActivityIndicator,
  ScrollView,
  TextInput,
} from 'react-native'
import { Image } from 'expo-image'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { SymbolView } from 'expo-symbols'
import { useCategories, useCurrentUser, useProducts } from '../../lib/queries'
import { cart, useCart } from '../../lib/cart'
import { productImageUrl } from '../../lib/api'
import { formatCents } from '../../lib/format'
import type { Product } from '../../lib/types'
import { categorySelection } from '../../lib/category-selection'

function QtyControl({
  qty,
  onDec,
  onInc,
  small = false,
  disabled,
}: {
  qty: number
  onDec: () => void
  onInc: () => void
  small?: boolean
  disabled?: boolean
}) {
  const heightClass = small ? 'h-8' : 'h-9'
  if (qty === 0) {
    return (
      <Pressable
        onPress={onInc}
        disabled={disabled}
        className={`items-center justify-center border ${heightClass} ${
          disabled ? 'border-ink/15' : 'border-ink/40 active:bg-ink/5'
        }`}
      >
        <Text
          className={`font-sans-medium text-[10px] uppercase tracking-label ${
            disabled ? 'text-ink-muted' : 'text-ink'
          }`}
        >
          Agregar +
        </Text>
      </Pressable>
    )
  }
  return (
    <View className={`flex-row items-center border border-ink/15 ${heightClass}`}>
      <Pressable
        onPress={onDec}
        className={`items-center justify-center ${heightClass} ${small ? 'w-8' : 'w-9'}`}
      >
        <Text className="font-sans-semibold text-[14px] text-ink">−</Text>
      </Pressable>
      <Text
        className="flex-1 text-center font-sans-semibold text-[13px] text-ink"
        style={{ fontVariant: ['tabular-nums'] }}
      >
        {qty}
      </Text>
      <Pressable
        onPress={onInc}
        className={`items-center justify-center ${heightClass} ${small ? 'w-8' : 'w-9'}`}
      >
        <Text className="font-sans-semibold text-[14px] text-ink">+</Text>
      </Pressable>
    </View>
  )
}

/**
 * TypographicPrice — Amazon-style: tiny $ + large integer + superscript cents.
 * Renders e.g. $6⁹⁹ in three sized + offset glyphs.
 */
function TypographicPrice({
  cents,
  size = 'lg',
}: {
  cents: number
  size?: 'lg' | 'md'
}) {
  const value = (cents / 100).toFixed(2)
  const [intPart, centPart] = value.split('.')
  const dollarSize = size === 'lg' ? 11 : 10
  const intSize = size === 'lg' ? 22 : 18
  const centSize = size === 'lg' ? 11 : 10
  const centTop = size === 'lg' ? -8 : -6
  return (
    <View
      className="flex-row items-baseline"
      style={{ fontVariant: ['tabular-nums'] } as object}
    >
      <Text
        className="font-sans-semibold text-ink"
        style={{ fontSize: dollarSize, lineHeight: dollarSize + 2, marginRight: 1 }}
      >
        $
      </Text>
      <Text
        className="font-sans-bold text-ink"
        style={{
          fontSize: intSize,
          lineHeight: intSize,
          letterSpacing: -0.5,
          fontVariant: ['tabular-nums'],
        }}
      >
        {intPart}
      </Text>
      <Text
        className="font-sans-semibold text-ink"
        style={{
          fontSize: centSize,
          lineHeight: centSize + 2,
          marginLeft: 1,
          position: 'relative',
          top: centTop,
          fontVariant: ['tabular-nums'],
        }}
      >
        {centPart}
      </Text>
    </View>
  )
}

function ProductCard({ product, qty }: { product: Product; qty: number }) {
  const hasImage = !!product.imageContentType
  const unavailable = !product.isAvailable
  const placeholder = product.name.slice(0, 3).toUpperCase()
  return (
    <View
      className={`flex-1 border border-ink/15 bg-paper ${unavailable ? 'opacity-60' : ''}`}
    >
      {/* Full-bleed image */}
      <View className="relative aspect-square w-full">
        {hasImage ? (
          <Image
            source={{ uri: productImageUrl(product.id, product.imageUpdatedAt) }}
            style={{ width: '100%', height: '100%' }}
            contentFit="cover"
          />
        ) : (
          <View
            className="h-full w-full items-center justify-center border-b border-ink/10"
            style={{
              experimental_backgroundImage:
                'repeating-linear-gradient(135deg, #F0F0F5, #F0F0F5 6px, rgba(26, 21, 48, 0.06) 6px, rgba(26, 21, 48, 0.06) 12px)',
            }}
          >
            <Text
              className="font-sans-semibold uppercase tracking-label text-ink-muted"
              style={{ fontSize: 11, fontFamily: 'ui-monospace' }}
            >
              {placeholder}
            </Text>
          </View>
        )}

        {product.offerActive && (
          <View className="absolute left-1.5 top-1.5 bg-accent px-1.5 py-0.5">
            <Text className="font-sans-semibold text-[8px] uppercase tracking-label text-brand-dark">
              Oferta
            </Text>
          </View>
        )}

        {qty > 0 && (
          <View className="absolute right-1.5 top-1.5 h-6 w-6 items-center justify-center rounded-full bg-brand">
            <Text
              className="font-sans-bold text-[11px] text-paper"
              style={{ fontVariant: ['tabular-nums'] }}
            >
              {qty}
            </Text>
          </View>
        )}
      </View>

      {/* Body */}
      <View className="px-2.5 pb-3 pt-2.5">
        <Text
          className="min-h-[34px] font-sans-medium text-[13px] leading-[17px] text-ink"
          numberOfLines={2}
        >
          {product.name}
        </Text>

        <View className="mt-1.5 flex-row items-baseline gap-2">
          <TypographicPrice cents={product.effectivePriceCents} size="lg" />
          {product.offerActive && (
            <Text
              className="font-sans text-[10px] text-ink-muted line-through"
              style={{ fontVariant: ['tabular-nums'] }}
            >
              {formatCents(product.basePriceCents)}
            </Text>
          )}
        </View>

        <View className="mt-2.5">
          {unavailable ? (
            <Text className="font-sans text-[10px] uppercase tracking-label text-ink-muted">
              Sin stock
            </Text>
          ) : (
            <QtyControl
              qty={qty}
              small
              onDec={() => cart.update(product.id, -1)}
              onInc={() => cart.update(product.id, +1)}
            />
          )}
        </View>
      </View>
    </View>
  )
}

function ProductRow({ product, qty }: { product: Product; qty: number }) {
  const hasImage = !!product.imageContentType
  const unavailable = !product.isAvailable
  return (
    <View
      className={`flex-row items-start gap-4 py-5 ${unavailable ? 'opacity-60' : ''}`}
    >
      <View className="relative h-20 w-20 border border-ink/15 bg-paper-deep">
        {hasImage ? (
          <Image
            source={{ uri: productImageUrl(product.id, product.imageUpdatedAt) }}
            style={{ width: '100%', height: '100%' }}
            contentFit="cover"
          />
        ) : (
          <View className="flex-1 items-center justify-center">
            <Text className="font-sans-semibold text-[11px] uppercase tracking-label text-ink-muted">
              {product.name.slice(0, 3)}
            </Text>
          </View>
        )}
        {product.offerActive && (
          <View className="absolute left-0 top-0 bg-accent px-1.5 py-0.5">
            <Text className="font-sans-semibold text-[9px] uppercase tracking-label text-brand-dark">
              Oferta
            </Text>
          </View>
        )}
      </View>

      <View className="flex-1">
        <Text className="font-sans-semibold text-[16px] leading-[20px] text-ink" numberOfLines={2}>
          {product.name}
        </Text>
        {product.description && (
          <Text className="mt-0.5 text-[12px] leading-[16px] text-ink-soft" numberOfLines={2}>
            {product.description}
          </Text>
        )}
        <View className="mt-2 flex-row items-end justify-between">
          <View className="flex-row items-baseline gap-2">
            <TypographicPrice cents={product.effectivePriceCents} size="md" />
            {product.offerActive && (
              <Text
                className="font-sans text-[11px] text-ink-muted line-through"
                style={{ fontVariant: ['tabular-nums'] }}
              >
                {formatCents(product.basePriceCents)}
              </Text>
            )}
          </View>
          {unavailable ? (
            <Text className="font-sans text-[11px] uppercase tracking-label text-ink-muted">
              Sin stock
            </Text>
          ) : (
            <View style={{ minWidth: 110 }}>
              <QtyControl
                qty={qty}
                onDec={() => cart.update(product.id, -1)}
                onInc={() => cart.update(product.id, +1)}
              />
            </View>
          )}
        </View>
      </View>
    </View>
  )
}

function CategoryChip({
  active,
  onPress,
  label,
}: {
  active: boolean
  onPress: () => void
  label: string
}) {
  // Always render a 1px border so active and inactive chips share the same total
  // height. Active uses an accent border (invisible against the yellow fill)
  // while inactive uses ink-faint visible border.
  return (
    <Pressable
      onPress={onPress}
      className={`h-9 items-center justify-center rounded-xs border px-3.5 ${
        active
          ? 'border-accent bg-accent'
          : 'border-ink/15 bg-transparent'
      }`}
    >
      <Text
        className={`font-sans-semibold text-[11px] uppercase tracking-label ${
          active ? 'text-brand-dark' : 'text-ink-muted'
        }`}
        style={{ lineHeight: 11, includeFontPadding: false } as object}
      >
        {label}
      </Text>
    </Pressable>
  )
}

export default function CatalogTab() {
  const { data: user } = useCurrentUser()
  const { data: products, isPending, refetch, isRefetching } = useProducts()
  const { data: categories } = useCategories()
  const cartState = useCart()
  const [activeSlug, setActiveSlug] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('grid')
  const [query, setQuery] = useState('')

  // Consume any pending category slug from the home tab handoff
  useEffect(() => {
    const slug = categorySelection.consume()
    if (slug !== null) {
      setActiveSlug(slug)
    }
  }, [])

  const firstName = user?.fullName?.split(' ')[0] ?? ''
  const neighborhood =
    user?.addressDefault?.text?.split('·').pop()?.trim() ?? 'Washington Heights'

  const totalCents = useMemo(() => {
    if (!products) return 0
    return products.reduce((sum, p) => {
      const q = cartState.items[p.id] ?? 0
      return sum + q * p.effectivePriceCents
    }, 0)
  }, [products, cartState])

  const itemsCount = useMemo(
    () => Object.values(cartState.items).reduce((a, b) => a + b, 0),
    [cartState],
  )

  const q = query.trim().toLowerCase()

  const filtered = useMemo(() => {
    let list = products ?? []
    if (activeSlug) {
      list = list.filter((p) => p.category?.slug === activeSlug)
    }
    if (q !== '') {
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.description ?? '').toLowerCase().includes(q),
      )
    }
    return list
  }, [products, activeSlug, q])

  // Suggested = products outside current view, offers first, max 4
  const suggested = useMemo(() => {
    if (!products || q !== '') return []
    const inFilter = new Set(filtered.map((p) => p.id))
    return products
      .filter((p) => !inFilter.has(p.id) && p.isAvailable)
      .sort((a, b) => Number(b.offerActive) - Number(a.offerActive))
      .slice(0, 4)
  }, [products, filtered, q])

  // In grid mode, pad odd-count lists so the last row still has 2 columns —
  // otherwise a lone product card stretches to full width and the aspect-square
  // image becomes huge. The spacer renders as an invisible flex-1 view.
  const SPACER_ID = '__spacer__'
  const gridData = useMemo(() => {
    if (viewMode !== 'grid') return filtered
    if (filtered.length % 2 === 0) return filtered
    return [...filtered, { id: SPACER_ID } as Product]
  }, [filtered, viewMode])

  if (isPending) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-paper">
        <ActivityIndicator color="#220247" size="small" />
      </SafeAreaView>
    )
  }

  const renderHeader = () => (
    <View>
      {/* Search bar + view toggle */}
      <View className="flex-row items-center gap-2.5 px-4 pb-3 pt-3">
        <View className="h-10 flex-1 flex-row items-center gap-2 rounded-full border border-ink/15 bg-paper-deep px-3">
          <SymbolView
            name={{ ios: 'magnifyingglass', android: 'search' }}
            size={14}
            tintColor="#6B6488"
            resizeMode="scaleAspectFit"
            fallback={<Text className="text-[14px] text-ink-muted">⌕</Text>}
          />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Buscar productos…"
            placeholderTextColor="#6B6488"
            className="flex-1 font-sans text-[13px] text-ink"
            autoCapitalize="none"
            returnKeyType="search"
          />
          <Pressable className="p-1">
            <SymbolView
              name={{ ios: 'camera.fill', android: 'photo_camera' }}
              size={16}
              tintColor="#6B6488"
              resizeMode="scaleAspectFit"
              fallback={<Text className="text-ink-muted">📷</Text>}
            />
          </Pressable>
          <Pressable className="p-1">
            <SymbolView
              name={{ ios: 'mic.fill', android: 'mic' }}
              size={15}
              tintColor="#6B6488"
              resizeMode="scaleAspectFit"
              fallback={<Text className="text-ink-muted">🎙</Text>}
            />
          </Pressable>
        </View>
        <Pressable
          onPress={() => setViewMode((v) => (v === 'list' ? 'grid' : 'list'))}
          className="h-10 w-10 items-center justify-center border border-ink/15 bg-paper-deep"
          accessibilityLabel={viewMode === 'list' ? 'Cambiar a grilla' : 'Cambiar a lista'}
        >
          <SymbolView
            name={
              viewMode === 'list'
                ? { ios: 'square.grid.2x2', android: 'apps' }
                : { ios: 'list.bullet', android: 'list' }
            }
            size={16}
            tintColor="#1A1530"
            resizeMode="scaleAspectFit"
            fallback={<Text className="text-ink">{viewMode === 'list' ? '▦' : '☰'}</Text>}
          />
        </Pressable>
      </View>

      {/* Category chips */}
      {(categories?.length ?? 0) > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingBottom: 10 }}
          className="border-b border-ink/10"
        >
          <CategoryChip
            active={activeSlug === null}
            onPress={() => setActiveSlug(null)}
            label="Todos"
          />
          {(categories ?? []).map((c) => (
            <CategoryChip
              key={c.id}
              active={activeSlug === c.slug}
              onPress={() => setActiveSlug(c.slug)}
              label={`${c.iconEmoji ?? ''} ${c.name}`.trim()}
            />
          ))}
        </ScrollView>
      )}

      {/* Greeting / contextual strip */}
      <View className="flex-row items-end justify-between px-4 pb-1 pt-3.5">
        <View className="flex-1 pr-2">
          <Text className="font-sans text-[10px] uppercase tracking-eyebrow text-ink-muted">
            {neighborhood}
          </Text>
          <Text
            className="mt-0.5 font-sans-semibold text-[15px] tracking-tight text-ink"
            numberOfLines={1}
          >
            {q
              ? `${filtered.length} resultado${filtered.length === 1 ? '' : 's'} para "${query}"`
              : firstName
                ? `Hola, ${firstName}.`
                : 'Hola.'}
          </Text>
        </View>
        <Text
          className="font-sans text-[11px] text-ink-muted"
          style={{ fontVariant: ['tabular-nums'] }}
        >
          {filtered.length} ítems
        </Text>
      </View>
    </View>
  )

  const renderFooter = () => {
    if (viewMode !== 'grid' || q !== '' || suggested.length === 0) return null
    return (
      <View className="mt-4 px-2">
        <Text className="mb-2.5 px-2 font-sans-semibold text-[16px] tracking-tight text-ink">
          Ítems que te pueden interesar
        </Text>
        <View className="flex-row flex-wrap" style={{ gap: 8 }}>
          {suggested.map((p) => (
            <View
              key={p.id}
              style={{ width: '48.5%' }}
            >
              <ProductCard
                product={p}
                qty={cartState.items[p.id] ?? 0}
              />
            </View>
          ))}
        </View>
      </View>
    )
  }

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-paper">
      <FlatList
        key={viewMode}
        data={viewMode === 'grid' ? gridData : filtered}
        keyExtractor={(p) => p.id}
        numColumns={viewMode === 'grid' ? 2 : 1}
        columnWrapperStyle={
          viewMode === 'grid'
            ? { gap: 8, paddingHorizontal: 8, marginBottom: 8 }
            : undefined
        }
        contentContainerClassName={viewMode === 'grid' ? 'pb-40' : 'px-5 pb-40'}
        ItemSeparatorComponent={
          viewMode === 'list' ? () => <View className="h-px bg-ink/10" /> : undefined
        }
        ListHeaderComponent={renderHeader}
        renderItem={({ item }) => {
          if (item.id === SPACER_ID) return <View style={{ flex: 1 }} />
          return viewMode === 'list' ? (
            <ProductRow product={item} qty={cartState.items[item.id] ?? 0} />
          ) : (
            <ProductCard product={item} qty={cartState.items[item.id] ?? 0} />
          )
        }}
        ListEmptyComponent={
          <View className="items-center px-8 py-16">
            <Text className="font-sans text-[10px] uppercase tracking-eyebrow text-ink-muted">
              {q ? 'Sin resultados' : 'Catálogo vacío'}
            </Text>
            <Text className="mt-3 text-center text-[14px] text-ink-soft">
              {q
                ? 'Sin resultados. Prueba con otra palabra.'
                : activeSlug
                  ? 'No hay productos en esta categoría.'
                  : 'No hay productos disponibles ahora mismo.'}
            </Text>
          </View>
        }
        ListFooterComponent={renderFooter}
        refreshing={isRefetching}
        onRefresh={refetch}
        keyboardShouldPersistTaps="handled"
      />

      {itemsCount > 0 && (
        <View className="absolute bottom-20 left-3 right-3 flex-row items-center gap-3 bg-ink px-3 py-3">
          <View className="h-9 w-9 items-center justify-center bg-accent">
            <Text
              className="font-sans-bold text-[15px] text-brand-dark"
              style={{ fontVariant: ['tabular-nums'] }}
            >
              {itemsCount}
            </Text>
          </View>
          <View className="flex-1">
            <Text className="font-sans text-[9px] uppercase tracking-label text-paper/55">
              En carrito
            </Text>
            <Text
              className="mt-0.5 font-sans-semibold text-[18px] text-paper"
              style={{ fontVariant: ['tabular-nums'] }}
            >
              {formatCents(totalCents)}
            </Text>
          </View>
          <Pressable
            className="h-10 items-center justify-center bg-accent px-4 active:bg-accent-dark"
            onPress={() => router.push('/checkout')}
          >
            <Text className="font-sans-semibold text-[11px] uppercase tracking-label text-brand-dark">
              Checkout →
            </Text>
          </Pressable>
        </View>
      )}
    </SafeAreaView>
  )
}
