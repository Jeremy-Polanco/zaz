import { type ReactNode } from 'react'
import { View, Text, Pressable } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { SymbolView } from 'expo-symbols'
import { Display } from './ui'

/**
 * ScreenHeader — the single, premium header used by every pushed / detail
 * screen across all roles.
 *
 * Why it exists:
 *  - Before, only `checkout` and `credit-pay` had a visible back affordance;
 *    every other detail screen relied on the iOS swipe-back gesture alone.
 *    For an audience that skews older, an invisible "swipe from the edge"
 *    gesture is a dead end. This header gives a LARGE, labelled "Atrás"
 *    target (icon + word, ≥48px tall) that nobody can miss.
 *  - It owns its own top safe-area inset, so a screen using it should NOT
 *    also pad the top edge (use `SafeAreaView edges={['bottom']}` or none).
 *
 * Layout:
 *   [ ‹ Atrás ]                         [ right? ]
 *   Big Title
 *   subtitle
 *   ────────────────────────────────────────────
 */
export function ScreenHeader({
  title,
  subtitle,
  onBack,
  backLabel = 'Atrás',
  right,
  showBack = true,
}: {
  title?: string
  subtitle?: string
  /** Override the default `router.back()` behaviour. */
  onBack?: () => void
  backLabel?: string
  /** Optional trailing slot (actions, badges). */
  right?: ReactNode
  showBack?: boolean
}) {
  const insets = useSafeAreaInsets()

  const handleBack = () => {
    if (onBack) {
      onBack()
      return
    }
    if (router.canGoBack()) router.back()
  }

  return (
    <View style={{ paddingTop: insets.top }} className="bg-paper">
      <View className="min-h-[52px] flex-row items-center justify-between px-2 pt-1">
        {showBack ? (
          <Pressable
            onPress={handleBack}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Volver atrás"
            className="h-12 flex-row items-center gap-0.5 rounded-full pl-1 pr-4 active:bg-ink/5"
          >
            <SymbolView
              name={{ ios: 'chevron.left', android: 'arrow_back_ios' }}
              size={22}
              tintColor="#1A1530"
              resizeMode="scaleAspectFit"
              fallback={<Text className="text-[24px] text-ink">‹</Text>}
            />
            <Text className="font-sans-medium text-[17px] text-ink">{backLabel}</Text>
          </Pressable>
        ) : (
          <View className="h-12" />
        )}
        {right ? <View className="pr-2">{right}</View> : null}
      </View>

      {title ? (
        <View className="px-5 pb-4 pt-2">
          <Display className="text-[30px] leading-[34px]">{title}</Display>
          {subtitle ? (
            <Text className="mt-1.5 font-sans text-[16px] leading-[22px] text-ink-soft">
              {subtitle}
            </Text>
          ) : null}
        </View>
      ) : (
        <View className="pb-1" />
      )}
    </View>
  )
}
