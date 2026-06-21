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
  ruta: { ios: 'truck.box.fill', android: 'local_shipping' },
  products: { ios: 'square.grid.2x2.fill', android: 'apps' },
  categories: { ios: 'rectangle.stack.fill', android: 'category' },
  more: { ios: 'ellipsis', android: 'more_horiz' },
} as const satisfies Record<string, TabIconName>

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
  const screenOptions = useTabBarScreenOptions()

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
      <Tabs screenOptions={screenOptions}>
        <Tabs.Screen
          name="index"
          options={{
            title: 'Ruta',
            tabBarIcon: ({ focused }) => <TabBarIcon focused={focused} name={ICONS.ruta} />,
            tabBarLabel: ({ focused }) => <TabBarLabel focused={focused}>Ruta</TabBarLabel>,
          }}
        />
        <Tabs.Screen
          name="products"
          options={{
            title: 'Catálogo',
            tabBarIcon: ({ focused }) => <TabBarIcon focused={focused} name={ICONS.products} />,
            tabBarLabel: ({ focused }) => <TabBarLabel focused={focused}>Catálogo</TabBarLabel>,
          }}
        />
        <Tabs.Screen
          name="categories"
          options={{
            title: 'Categorías',
            tabBarIcon: ({ focused }) => <TabBarIcon focused={focused} name={ICONS.categories} />,
            tabBarLabel: ({ focused }) => <TabBarLabel focused={focused}>Categorías</TabBarLabel>,
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
