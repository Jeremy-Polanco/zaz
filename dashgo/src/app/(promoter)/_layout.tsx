import { useEffect, useState } from 'react'
import { Tabs, router } from 'expo-router'
import { Text } from 'react-native'
import { SymbolView, type AndroidSymbol } from 'expo-symbols'
import type { SFSymbol } from 'sf-symbols-typescript'
import { useCurrentUser } from '../../lib/queries'
import { MoreSheet, type MoreSheetItem } from '../../components/MoreSheet'

const ACCENT = '#1A1530'
const MUTED = '#6B6488'

type IconName = {
  ios: SFSymbol
  android: AndroidSymbol
}

function TabIcon({ focused, name }: { focused: boolean; name: IconName }) {
  return (
    <SymbolView
      name={{ ios: name.ios, android: name.android }}
      size={22}
      tintColor={focused ? ACCENT : MUTED}
      resizeMode="scaleAspectFit"
      fallback={
        <Text style={{ fontSize: 16, color: focused ? ACCENT : MUTED }}>•</Text>
      }
    />
  )
}

function TabLabel({ focused, children }: { focused: boolean; children: string }) {
  return (
    <Text
      numberOfLines={1}
      className={`font-sans text-[10px] uppercase tracking-label ${
        focused ? 'text-ink' : 'text-ink-muted'
      }`}
    >
      {children}
    </Text>
  )
}

const ICONS = {
  panel: { ios: 'bolt.fill', android: 'bolt' },
  commissions: { ios: 'dollarsign.circle.fill', android: 'attach_money' },
  catalog: { ios: 'square.grid.2x2.fill', android: 'apps' },
  more: { ios: 'ellipsis', android: 'more_horiz' },
} as const satisfies Record<string, IconName>

// Overflow options for promoters — surfaced through the "Más" bottom sheet.
const PROMOTER_MORE_ITEMS: MoreSheetItem[] = [
  { label: 'Pagos', icon: { ios: 'arrow.down.circle.fill', android: 'download' }, route: '/(promoter)/payouts' },
  { label: 'Pedidos', icon: { ios: 'bag.fill', android: 'shopping_bag' }, route: '/(promoter)/orders' },
  { label: 'Puntos', icon: { ios: 'star.fill', android: 'star' }, route: '/(promoter)/points' },
  { label: 'Mi cuenta', icon: { ios: 'person.crop.circle.fill', android: 'account_circle' }, route: '/(promoter)/profile' },
]

export default function PromoterLayout() {
  const { data: user, isPending } = useCurrentUser()
  const [moreOpen, setMoreOpen] = useState(false)

  useEffect(() => {
    if (isPending) return
    if (!user) {
      router.replace('/(auth)/login')
      return
    }
    if (user.role === 'super_admin_delivery') {
      router.replace('/(super)')
    } else if (user.role === 'client') {
      router.replace('/(tabs)')
    }
  }, [user, isPending])

  return (
    <>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: ACCENT,
          tabBarInactiveTintColor: MUTED,
          tabBarStyle: {
            backgroundColor: '#FAFAFC',
            borderTopColor: 'rgba(26,21,48,0.10)',
            borderTopWidth: 1,
            height: 72,
            paddingTop: 8,
            paddingBottom: 10,
          },
          tabBarShowLabel: true,
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Panel',
            tabBarIcon: ({ focused }) => <TabIcon focused={focused} name={ICONS.panel} />,
            tabBarLabel: ({ focused }) => <TabLabel focused={focused}>Panel</TabLabel>,
          }}
        />
        <Tabs.Screen
          name="commissions"
          options={{
            title: 'Comisiones',
            tabBarIcon: ({ focused }) => <TabIcon focused={focused} name={ICONS.commissions} />,
            tabBarLabel: ({ focused }) => (
              <TabLabel focused={focused}>Comisiones</TabLabel>
            ),
          }}
        />
        <Tabs.Screen
          name="catalog"
          options={{
            title: 'Catálogo',
            tabBarIcon: ({ focused }) => <TabIcon focused={focused} name={ICONS.catalog} />,
            tabBarLabel: ({ focused }) => <TabLabel focused={focused}>Catálogo</TabLabel>,
          }}
        />
        <Tabs.Screen
          name="more"
          options={{
            title: 'Más',
            tabBarIcon: ({ focused }) => <TabIcon focused={focused} name={ICONS.more} />,
            tabBarLabel: ({ focused }) => <TabLabel focused={focused}>Más</TabLabel>,
          }}
          listeners={{
            tabPress: (e) => {
              e.preventDefault()
              setMoreOpen(true)
            },
          }}
        />

        {/* Overflow screens — reachable via the "Más" sheet, hidden from the bar. */}
        <Tabs.Screen name="payouts" options={{ title: 'Pagos', href: null }} />
        <Tabs.Screen name="orders" options={{ title: 'Pedidos', href: null }} />
        <Tabs.Screen name="points" options={{ title: 'Puntos', href: null }} />
        <Tabs.Screen name="profile" options={{ title: 'Cuenta', href: null }} />
      </Tabs>

      <MoreSheet
        visible={moreOpen}
        onClose={() => setMoreOpen(false)}
        items={PROMOTER_MORE_ITEMS}
      />
    </>
  )
}
