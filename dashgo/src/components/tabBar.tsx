import { View, Text, Platform } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { SymbolView, type AndroidSymbol } from 'expo-symbols'
import type { SFSymbol } from 'sf-symbols-typescript'
import type { BottomTabNavigationOptions } from '@react-navigation/bottom-tabs'

// Premium bottom tab bar — single source of truth for all three role layouts
// (client / super-admin / promoter), which were previously three copy-pasted
// files that drifted apart. Tuned for an older audience: bigger icons, a
// readable label, and a clear "you are here" pill so the active tab is never
// ambiguous.

const ACTIVE = '#1A1530' // ink
const ACTIVE_ICON = '#CC6600' // accent-dark — warm, high-contrast on the pill
const MUTED = '#6B6488' // ink-muted

export type TabIconName = {
  ios: SFSymbol
  android: AndroidSymbol
}

export function TabBarIcon({ focused, name }: { focused: boolean; name: TabIconName }) {
  return (
    <View
      className={`min-w-[56px] items-center justify-center rounded-full px-4 py-1.5 ${
        focused ? 'bg-accent-light' : ''
      }`}
    >
      <SymbolView
        name={{ ios: name.ios, android: name.android }}
        size={26}
        tintColor={focused ? ACTIVE_ICON : MUTED}
        resizeMode="scaleAspectFit"
        fallback={
          <Text style={{ fontSize: 20, color: focused ? ACTIVE_ICON : MUTED }}>•</Text>
        }
      />
    </View>
  )
}

export function TabBarLabel({ focused, children }: { focused: boolean; children: string }) {
  return (
    <Text
      numberOfLines={1}
      className={`font-sans-medium text-[11px] uppercase tracking-label ${
        focused ? 'text-ink' : 'text-ink-muted'
      }`}
    >
      {children}
    </Text>
  )
}

/**
 * Shared screenOptions for the role Tabs navigators. Resolves the bottom
 * safe-area inset at runtime so the bar clears the home indicator without a
 * hardcoded guess, and lifts the bar onto an elevated surface with a soft
 * shadow for a more premium feel.
 */
export function useTabBarScreenOptions(): BottomTabNavigationOptions {
  const insets = useSafeAreaInsets()
  const bottomInset = insets.bottom
  return {
    headerShown: false,
    tabBarActiveTintColor: ACTIVE,
    tabBarInactiveTintColor: MUTED,
    tabBarShowLabel: true,
    tabBarItemStyle: { paddingTop: 8 },
    tabBarStyle: {
      backgroundColor: '#FFFFFF',
      borderTopColor: 'rgba(26,21,48,0.08)',
      borderTopWidth: 1,
      height: 64 + bottomInset,
      paddingTop: 8,
      paddingBottom: bottomInset > 0 ? bottomInset : 12,
      // Soft elevation so the bar reads as a distinct, premium surface.
      ...Platform.select({
        ios: {
          shadowColor: '#1A1530',
          shadowOffset: { width: 0, height: -2 },
          shadowOpacity: 0.06,
          shadowRadius: 12,
        },
        android: { elevation: 12 },
      }),
    },
  }
}
