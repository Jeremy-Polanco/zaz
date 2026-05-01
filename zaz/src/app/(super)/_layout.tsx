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
  ruta: { ios: 'truck.box.fill', android: 'local_shipping' },
  products: { ios: 'square.grid.2x2.fill', android: 'apps' },
  categories: { ios: 'rectangle.stack.fill', android: 'category' },
  promoters: { ios: 'bolt.fill', android: 'bolt' },
  credit: { ios: 'creditcard.fill', android: 'credit_card' },
  profile: { ios: 'person.crop.circle.fill', android: 'account_circle' },
} as const satisfies Record<string, IconName>

export default function SuperLayout() {
  const { data: user, isPending } = useCurrentUser()

  useEffect(() => {
    if (isPending) return
    if (!user) {
      router.replace('/(auth)/login')
      return
    }
    if (user.role !== 'super_admin_delivery') {
      router.replace('/(tabs)')
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
          title: 'Ruta',
          tabBarIcon: ({ focused }) => <TabIcon focused={focused} name={ICONS.ruta} />,
          tabBarLabel: ({ focused }) => <TabLabel focused={focused}>Ruta</TabLabel>,
        }}
      />
      <Tabs.Screen
        name="products"
        options={{
          title: 'Catálogo',
          tabBarIcon: ({ focused }) => <TabIcon focused={focused} name={ICONS.products} />,
          tabBarLabel: ({ focused }) => <TabLabel focused={focused}>Catálogo</TabLabel>,
        }}
      />
      <Tabs.Screen
        name="categories"
        options={{
          title: 'Categorías',
          tabBarIcon: ({ focused }) => <TabIcon focused={focused} name={ICONS.categories} />,
          tabBarLabel: ({ focused }) => <TabLabel focused={focused}>Categorías</TabLabel>,
        }}
      />
      <Tabs.Screen
        name="promoters/index"
        options={{
          title: 'Promotores',
          tabBarIcon: ({ focused }) => <TabIcon focused={focused} name={ICONS.promoters} />,
          tabBarLabel: ({ focused }) => <TabLabel focused={focused}>Promotores</TabLabel>,
        }}
      />
      <Tabs.Screen name="promoters/[id]" options={{ href: null }} />
      <Tabs.Screen
        name="credit/index"
        options={{
          title: 'Crédito',
          tabBarIcon: ({ focused }) => <TabIcon focused={focused} name={ICONS.credit} />,
          tabBarLabel: ({ focused }) => <TabLabel focused={focused}>Crédito</TabLabel>,
        }}
      />
      <Tabs.Screen name="credit/[userId]" options={{ href: null }} />
      <Tabs.Screen name="orders/[orderId]" options={{ href: null }} />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Reparto',
          tabBarIcon: ({ focused }) => <TabIcon focused={focused} name={ICONS.profile} />,
          tabBarLabel: ({ focused }) => <TabLabel focused={focused}>Reparto</TabLabel>,
        }}
      />
    </Tabs>
  )
}
