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
  ruta: { ios: 'truck.box.fill', android: 'local_shipping' },
  products: { ios: 'square.grid.2x2.fill', android: 'apps' },
  categories: { ios: 'rectangle.stack.fill', android: 'category' },
  more: { ios: 'ellipsis', android: 'more_horiz' },
} as const satisfies Record<string, IconName>

// Overflow options for super admin — surfaced through the "Más" bottom sheet.
const SUPER_MORE_ITEMS: MoreSheetItem[] = [
  { label: 'Promotores', icon: { ios: 'bolt.fill', android: 'bolt' }, route: '/(super)/promoters' },
  { label: 'Crédito', icon: { ios: 'creditcard.fill', android: 'credit_card' }, route: '/(super)/credit' },
  { label: 'Usuarios', icon: { ios: 'person.2.fill', android: 'group' }, route: '/(super)/users' },
  { label: 'Suscripción', icon: { ios: 'crown.fill', android: 'workspace_premium' }, route: '/(super)/subscription' },
  { label: 'Alquileres', icon: { ios: 'drop.fill', android: 'water_drop' }, route: '/(super)/rentals' },
  { label: 'Reparto', icon: { ios: 'person.crop.circle.fill', android: 'account_circle' }, route: '/(super)/profile' },
]

export default function SuperLayout() {
  const { data: user, isPending } = useCurrentUser()
  const [moreOpen, setMoreOpen] = useState(false)

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

        {/* Overflow + detail screens — reachable via the "Más" sheet or pushes, hidden from the bar. */}
        <Tabs.Screen name="promoters/index" options={{ title: 'Promotores', href: null }} />
        <Tabs.Screen name="promoters/[id]" options={{ href: null }} />
        <Tabs.Screen name="credit/index" options={{ title: 'Crédito', href: null }} />
        <Tabs.Screen name="credit/[userId]" options={{ href: null }} />
        <Tabs.Screen name="orders/[orderId]" options={{ href: null }} />
        <Tabs.Screen name="users" options={{ title: 'Usuarios', href: null }} />
        <Tabs.Screen name="subscription" options={{ title: 'Suscripción', href: null }} />
        <Tabs.Screen name="rentals" options={{ title: 'Alquileres', href: null }} />
        <Tabs.Screen name="profile" options={{ title: 'Reparto', href: null }} />
      </Tabs>

      <MoreSheet
        visible={moreOpen}
        onClose={() => setMoreOpen(false)}
        items={SUPER_MORE_ITEMS}
      />
    </>
  )
}
