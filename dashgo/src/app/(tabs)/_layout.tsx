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
      size={24}
      tintColor={focused ? ACCENT : MUTED}
      resizeMode="scaleAspectFit"
      fallback={
        <Text style={{ fontSize: 18, color: focused ? ACCENT : MUTED }}>
          •
        </Text>
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
  home: { ios: 'house.fill', android: 'home' },
  catalog: { ios: 'square.grid.2x2.fill', android: 'apps' },
  orders: { ios: 'bag.fill', android: 'shopping_bag' },
  more: { ios: 'ellipsis', android: 'more_horiz' },
} as const satisfies Record<string, IconName>

// Overflow options for clients — surfaced through the "Más" bottom sheet.
const CLIENT_MORE_ITEMS: MoreSheetItem[] = [
  { label: 'Puntos', icon: { ios: 'star.fill', android: 'star' }, route: '/(tabs)/points' },
  { label: 'Crédito', icon: { ios: 'creditcard.fill', android: 'credit_card' }, route: '/(tabs)/credit' },
  { label: 'Suscripción', icon: { ios: 'crown.fill', android: 'workspace_premium' }, route: '/(tabs)/subscription' },
  { label: 'Alquileres', icon: { ios: 'drop.fill', android: 'water_drop' }, route: '/(tabs)/alquileres' },
  { label: 'Mi cuenta', icon: { ios: 'person.crop.circle.fill', android: 'account_circle' }, route: '/(tabs)/profile' },
]

export default function TabLayout() {
  const { data: user, isPending } = useCurrentUser()
  const isClient = user?.role === 'client'
  const [moreOpen, setMoreOpen] = useState(false)

  useEffect(() => {
    if (isPending) return
    if (user?.role === 'super_admin_delivery') {
      router.replace('/(super)')
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
            borderTopColor: 'rgba(26,26,26,0.15)',
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
            title: 'Inicio',
            href: isClient ? '/(tabs)' : null,
            tabBarIcon: ({ focused }) => <TabIcon focused={focused} name={ICONS.home} />,
            tabBarLabel: ({ focused }) => <TabLabel focused={focused}>Inicio</TabLabel>,
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
          name="orders"
          options={{
            title: 'Pedidos',
            tabBarIcon: ({ focused }) => <TabIcon focused={focused} name={ICONS.orders} />,
            tabBarLabel: ({ focused }) => <TabLabel focused={focused}>Pedidos</TabLabel>,
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
        <Tabs.Screen name="points" options={{ title: 'Puntos', href: null }} />
        <Tabs.Screen name="credit" options={{ title: 'Crédito', href: null }} />
        <Tabs.Screen name="subscription" options={{ title: 'Suscripción', href: null }} />
        <Tabs.Screen name="alquileres" options={{ title: 'Alquileres', href: null }} />
        <Tabs.Screen name="profile" options={{ title: 'Cuenta', href: null }} />
      </Tabs>

      <MoreSheet
        visible={moreOpen}
        onClose={() => setMoreOpen(false)}
        items={CLIENT_MORE_ITEMS}
      />
    </>
  )
}
