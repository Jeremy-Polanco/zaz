import { useEffect } from 'react'
import { Tabs, router } from 'expo-router'
import { Text } from 'react-native'
import { SymbolView } from 'expo-symbols'
import type { SFSymbol } from 'sf-symbols-typescript'
import { useCurrentUser } from '../../lib/queries'

const ACCENT = '#220247'
const MUTED = '#6B6488'

type IconName = {
  ios: SFSymbol
  android: string
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
  points: { ios: 'star.fill', android: 'star' },
  credit: { ios: 'creditcard.fill', android: 'credit_card' },
  profile: { ios: 'person.crop.circle.fill', android: 'account_circle' },
} as const satisfies Record<string, IconName>

export default function TabLayout() {
  const { data: user, isPending } = useCurrentUser()
  const isClient = user?.role === 'client'

  useEffect(() => {
    if (isPending) return
    if (user?.role === 'super_admin_delivery') {
      router.replace('/(super)')
    }
  }, [user, isPending])

  return (
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
        name="points"
        options={{
          title: 'Puntos',
          href: isClient ? null : '/(tabs)/points',
          tabBarIcon: ({ focused }) => <TabIcon focused={focused} name={ICONS.points} />,
          tabBarLabel: ({ focused }) => <TabLabel focused={focused}>Puntos</TabLabel>,
        }}
      />
      <Tabs.Screen
        name="credit"
        options={{
          title: 'Crédito',
          href: isClient ? '/(tabs)/credit' : null,
          tabBarIcon: ({ focused }) => <TabIcon focused={focused} name={ICONS.credit} />,
          tabBarLabel: ({ focused }) => <TabLabel focused={focused}>Crédito</TabLabel>,
        }}
      />
      <Tabs.Screen
        name="subscription"
        options={{
          title: 'Suscripción',
          href: null,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Cuenta',
          tabBarIcon: ({ focused }) => <TabIcon focused={focused} name={ICONS.profile} />,
          tabBarLabel: ({ focused }) => <TabLabel focused={focused}>Cuenta</TabLabel>,
        }}
      />
    </Tabs>
  )
}
