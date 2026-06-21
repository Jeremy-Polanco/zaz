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
  panel: { ios: 'bolt.fill', android: 'bolt' },
  commissions: { ios: 'dollarsign.circle.fill', android: 'attach_money' },
  catalog: { ios: 'square.grid.2x2.fill', android: 'apps' },
  more: { ios: 'ellipsis', android: 'more_horiz' },
} as const satisfies Record<string, TabIconName>

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
  const screenOptions = useTabBarScreenOptions()

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
      <Tabs screenOptions={screenOptions}>
        <Tabs.Screen
          name="index"
          options={{
            title: 'Panel',
            tabBarIcon: ({ focused }) => <TabBarIcon focused={focused} name={ICONS.panel} />,
            tabBarLabel: ({ focused }) => <TabBarLabel focused={focused}>Panel</TabBarLabel>,
          }}
        />
        <Tabs.Screen
          name="commissions"
          options={{
            title: 'Comisiones',
            tabBarIcon: ({ focused }) => <TabBarIcon focused={focused} name={ICONS.commissions} />,
            tabBarLabel: ({ focused }) => (
              <TabBarLabel focused={focused}>Comisiones</TabBarLabel>
            ),
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
