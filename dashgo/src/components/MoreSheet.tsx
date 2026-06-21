import { Modal, Pressable, ScrollView, Text, View } from 'react-native'
import { router } from 'expo-router'
import { SymbolView, type AndroidSymbol } from 'expo-symbols'
import type { SFSymbol } from 'sf-symbols-typescript'
import { Eyebrow } from './ui'

export type MoreSheetItem = {
  label: string
  icon: { ios: SFSymbol; android: AndroidSymbol }
  route: string
}

const ACCENT = '#1A1530'

/**
 * Bottom-sheet "Más opciones" menu — the mobile analog of the web's
 * hamburger→sheet nav. Surfaces every role option that doesn't fit in the
 * bottom tab bar. Styled after LocationBottomSheet (slide-up Modal + overlay
 * + rounded sheet + drag handle).
 */
export function MoreSheet({
  visible,
  onClose,
  items,
}: {
  visible: boolean
  onClose: () => void
  items: MoreSheetItem[]
}) {
  if (!visible) return null

  const go = (route: string) => {
    onClose()
    // Routes are validated by the caller's role list; cast to satisfy the
    // typed-router signature for a heterogeneous set of destinations.
    router.navigate(route as Parameters<typeof router.navigate>[0])
  }

  return (
    <Modal
      visible
      animationType="slide"
      transparent
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
    >
      <Pressable className="flex-1 bg-ink/40" onPress={onClose}>
        <View className="flex-1" />
      </Pressable>
      <View
        className="absolute bottom-0 left-0 right-0 max-h-[88%] rounded-t-[20px] bg-paper px-6 pb-10 pt-6"
        style={{ shadowOpacity: 0.2, shadowRadius: 20 }}
      >
        <View className="mx-auto mb-5 h-1 w-12 rounded-full bg-ink/20" />
        <ScrollView showsVerticalScrollIndicator={false}>
          <Eyebrow className="mb-4">Más opciones</Eyebrow>
          {items.map((item, i) => (
            <Pressable
              key={item.route}
              onPress={() => go(item.route)}
              accessibilityRole="button"
              className={`flex-row items-center gap-4 py-5 active:bg-ink/5 ${
                i > 0 ? 'border-t border-ink/10' : ''
              }`}
            >
              <View className="h-12 w-12 items-center justify-center rounded-xl border border-ink/15 bg-paper-deep">
                <SymbolView
                  name={item.icon}
                  size={24}
                  tintColor={ACCENT}
                  resizeMode="scaleAspectFit"
                  fallback={<Text style={{ fontSize: 18, color: ACCENT }}>•</Text>}
                />
              </View>
              <Text className="flex-1 font-sans-medium text-[18px] text-ink">
                {item.label}
              </Text>
              <SymbolView
                name={{ ios: 'chevron.right', android: 'chevron_right' }}
                size={18}
                tintColor="#6B6488"
                resizeMode="scaleAspectFit"
                fallback={<Text className="text-[20px] text-ink-muted">›</Text>}
              />
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </Modal>
  )
}
