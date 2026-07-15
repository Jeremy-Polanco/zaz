import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { Image } from 'expo-image'
import { API_URL } from '../lib/api'
import type { Category } from '../lib/types'

type Props = {
  category: Category
  productCount: number
  variant?: 'category' | 'all'
  dark?: boolean
  /** Full-width hero size (catalog picker) — scales type/emoji up to match. */
  large?: boolean
  onPress?: () => void
}

export function CategoryCard({ category, productCount, variant = 'category', dark = false, large = false, onPress }: Props) {
  const [showImage, setShowImage] = useState(true)
  const imageUri =
    variant === 'category' && category.imageUrl && showImage
      ? `${API_URL}${category.imageUrl}`
      : null

  const isAll = variant === 'all'

  // Surface
  let surface = 'border-ink/15 bg-paper-deep'
  if (isAll) surface = 'border-accent bg-accent'
  else if (dark) surface = 'border-transparent bg-ink'

  // Label bar colors follow the card surface, never the image — the label
  // lives below the artwork so it stays legible on any category image.
  const eyebrowColor = isAll
    ? 'text-brand-dark/70'
    : dark
      ? 'text-paper/55'
      : 'text-ink-muted'
  const nameColor = isAll ? 'text-brand-dark' : dark ? 'text-paper' : 'text-ink'
  const divider = isAll
    ? 'border-brand-dark/15'
    : dark
      ? 'border-paper/15'
      : 'border-ink/10'

  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: 'rgba(0,0,0,0.08)' }}
      className={`overflow-hidden border ${surface}`}
      style={{ activeOpacity: 0.8 } as object}
    >
      {/* Media canvas — square, artwork only. The label never overlaps it. */}
      <View className="relative aspect-square w-full">
        {imageUri ? (
          <Image
            source={{ uri: imageUri }}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
            contentFit="cover"
            onError={() => setShowImage(false)}
          />
        ) : (
          <View className="flex-1 items-center justify-center">
            {/* Emoji glyphs render taller than their nominal font size — give
                the line box ~1.3× headroom or the icon gets clipped. */}
            <Text
              style={
                large
                  ? { fontSize: 84, lineHeight: 112 }
                  : { fontSize: 44, lineHeight: 60 }
              }
            >
              {isAll ? '🛍️' : (category.iconEmoji ?? '📦')}
            </Text>
          </View>
        )}
      </View>

      {/* Label bar — own row below the artwork */}
      <View className={`border-t ${divider} ${large ? 'px-4 py-3.5' : 'px-2.5 py-2'}`}>
        <Text
          className={`font-sans uppercase tracking-eyebrow ${large ? 'text-[12px]' : 'text-[9px]'} ${eyebrowColor}`}
          numberOfLines={1}
        >
          {productCount} productos
        </Text>
        <Text
          className={`font-sans-semibold ${large ? 'mt-0.5 text-[22px] leading-[26px]' : 'text-[13px] leading-[17px]'} ${nameColor}`}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.75}
        >
          {isAll ? 'Ver todo el catálogo' : category.name}
        </Text>
      </View>
    </Pressable>
  )
}
