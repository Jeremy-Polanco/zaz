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
  onPress?: () => void
}

export function CategoryCard({ category, productCount, variant = 'category', dark = false, onPress }: Props) {
  const [showImage, setShowImage] = useState(true)
  const imageUri =
    variant === 'category' && category.imageUrl && showImage
      ? `${API_URL}${category.imageUrl}`
      : null

  const isAll = variant === 'all'
  const onLight = !dark && !imageUri && !isAll
  const onDark = dark && !imageUri && !isAll

  // Surface
  let surface = 'border-ink/15 bg-paper-deep'
  if (isAll) surface = 'border-accent bg-accent'
  else if (dark) surface = 'border-transparent bg-ink'

  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: 'rgba(0,0,0,0.08)' }}
      className={`aspect-square overflow-hidden border ${surface}`}
      style={{ activeOpacity: 0.8 } as object}
    >
      {/* Background image */}
      {imageUri ? (
        <Image
          source={{ uri: imageUri }}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          contentFit="cover"
          onError={() => setShowImage(false)}
        />
      ) : null}

      {/* Emoji centered (shown when no image) */}
      {!imageUri ? (
        <View className="flex-1 items-center justify-center">
          <Text className="text-5xl">
            {isAll ? '🛍️' : (category.iconEmoji ?? '📦')}
          </Text>
        </View>
      ) : null}

      {/* Bottom overlay */}
      <View
        className="absolute bottom-0 left-0 right-0 px-2 pb-2 pt-4"
        style={imageUri ? {
          experimental_backgroundImage: 'linear-gradient(to top, rgba(0,0,0,0.6) 0%, transparent 100%)',
        } : undefined}
      >
        <Text
          className={`font-sans text-[9px] uppercase tracking-eyebrow ${
            isAll
              ? 'text-brand-dark/70'
              : imageUri
                ? 'text-paper/80'
                : onDark
                  ? 'text-paper/55'
                  : 'text-ink-muted'
          }`}
          numberOfLines={1}
        >
          {productCount} productos
        </Text>
        <Text
          className={`font-sans-semibold text-[13px] leading-[16px] ${
            isAll
              ? 'text-brand-dark'
              : imageUri
                ? 'text-paper'
                : onDark
                  ? 'text-paper'
                  : 'text-ink'
          }`}
          numberOfLines={2}
        >
          {isAll ? 'Ver todo el catálogo' : category.name}
        </Text>
      </View>
    </Pressable>
  )
}
