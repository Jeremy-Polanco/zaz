import { useEffect, useState } from 'react'
import { Tabs, router } from 'expo-router'
import { useCurrentUser } from '../../lib/queries'
import { MoreSheet, type MoreSheetItem } from '../../components/MoreSheet'
import {
  TabBarIcon,
  TabBarLabel,
  useTabBarScreenOptions,
  type TabIconName,
} from '../../components/tabBar'

const ICONS = {
  home: { ios: 'house.fill', android: 'home' },
  catalog: { ios: 'square.grid.2x2.fill', android: 'apps' },
  orders: { ios: 'bag.fill', android: 'shopping_bag' },
  more: { ios: 'ellipsis', android: 'more_horiz' },
} as const satisfies Record<string, TabIconName>

// Overflow options for clients — surfaced through the "Más" bottom sheet.
const CLIENT_MORE_ITEMS: MoreSheetItem[] = [
  { label: 'Puntos', icon: { ios: 'star.fill', android: 'star' }, route: '/(tabs)/points' },
  { label: 'Crédito', icon: { ios: 'creditcard.fill', android: 'credit_card' }, route: '/(tabs)/credit' },
  { label: 'Suscripción', icon: { ios: 'crown.fill', android: 'workspace_premium' }, route: '/(tabs)/subscription' },
  { label: 'Alquileres', icon: { ios: 'drop.fill', android: 'water_drop' }, route: '/(tabs)/alquileres' },
  { label: 'Mi cuenta', icon: { ios: 'person.crop.circle.fill', android: 'account_circle' }, route: '/(tabs)/profile' },
]

// Guests (no session) only see the door into the account — every other
// overflow option is account-based and appears after login.
const GUEST_MORE_ITEMS: MoreSheetItem[] = [
  { label: 'Iniciar sesión', icon: { ios: 'person.crop.circle.fill', android: 'account_circle' }, route: '/(auth)/login' },
]

export default function TabLayout() {
  const { data: user, isPending } = useCurrentUser()
  const isClient = user?.role === 'client'
  // Guests share the client tab bar — browse is public, account tabs prompt login.
  const isGuest = !user
  const [moreOpen, setMoreOpen] = useState(false)
  const screenOptions = useTabBarScreenOptions()

  useEffect(() => {
    if (isPending) return
    if (user?.role === 'super_admin_delivery') {
      router.replace('/(super)')
    }
  }, [user, isPending])

  return (
    <>
      <Tabs screenOptions={screenOptions}>
        <Tabs.Screen
          name="index"
          options={{
            title: 'Inicio',
            href: isClient || isGuest ? '/(tabs)' : null,
            tabBarIcon: ({ focused }) => <TabBarIcon focused={focused} name={ICONS.home} />,
            tabBarLabel: ({ focused }) => <TabBarLabel focused={focused}>Inicio</TabBarLabel>,
          }}
        />
        <Tabs.Screen
          name="catalog"
          options={{
            title: 'Catálogo',
            tabBarIcon: ({ focused }) => <TabBarIcon focused={focused} name={ICONS.catalog} />,
            tabBarLabel: ({ focused }) => <TabBarLabel focused={focused}>Catálogo</TabBarLabel>,
          }}
        />
        <Tabs.Screen
          name="orders"
          options={{
            title: 'Pedidos',
            tabBarIcon: ({ focused }) => <TabBarIcon focused={focused} name={ICONS.orders} />,
            tabBarLabel: ({ focused }) => <TabBarLabel focused={focused}>Pedidos</TabBarLabel>,
          }}
        />
        <Tabs.Screen
          name="more"
          options={{
            title: 'Más',
            tabBarIcon: ({ focused }) => <TabBarIcon focused={focused} name={ICONS.more} />,
            tabBarLabel: ({ focused }) => <TabBarLabel focused={focused}>Más</TabBarLabel>,
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
        items={isGuest ? GUEST_MORE_ITEMS : CLIENT_MORE_ITEMS}
      />
    </>
  )
}
