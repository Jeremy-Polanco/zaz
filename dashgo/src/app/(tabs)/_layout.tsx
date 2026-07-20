import { useEffect, useState } from 'react'
import { Tabs, router } from 'expo-router'
import { useTranslation } from 'react-i18next'
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

// Item labels live in the `nav` i18n namespace — these defs carry the KEY and
// are resolved with t() inside the component so language switches re-render.
type MoreItemDef = Omit<MoreSheetItem, 'label'> & { labelKey: string }

// Overflow options for clients — surfaced through the "Más" bottom sheet.
const CLIENT_MORE_ITEMS: MoreItemDef[] = [
  { labelKey: 'more.points', icon: { ios: 'star.fill', android: 'star' }, route: '/(tabs)/points' },
  { labelKey: 'more.credit', icon: { ios: 'creditcard.fill', android: 'credit_card' }, route: '/(tabs)/credit' },
  { labelKey: 'more.subscription', icon: { ios: 'crown.fill', android: 'workspace_premium' }, route: '/(tabs)/subscription' },
  { labelKey: 'more.rentals', icon: { ios: 'drop.fill', android: 'water_drop' }, route: '/(tabs)/alquileres' },
  { labelKey: 'more.myAccount', icon: { ios: 'person.crop.circle.fill', android: 'account_circle' }, route: '/(tabs)/profile' },
]

// Guests (no session) only see the door into the account — every other
// overflow option is account-based and appears after login.
const GUEST_MORE_ITEMS: MoreItemDef[] = [
  { labelKey: 'more.signIn', icon: { ios: 'person.crop.circle.fill', android: 'account_circle' }, route: '/(auth)/login' },
]

export default function TabLayout() {
  const { t } = useTranslation('nav')
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

  const moreItems: MoreSheetItem[] = (isGuest ? GUEST_MORE_ITEMS : CLIENT_MORE_ITEMS).map(
    ({ labelKey, ...item }) => ({ ...item, label: t(labelKey) }),
  )

  return (
    <>
      <Tabs screenOptions={screenOptions}>
        <Tabs.Screen
          name="index"
          options={{
            title: t('tabs.home'),
            href: isClient || isGuest ? '/(tabs)' : null,
            tabBarIcon: ({ focused }) => <TabBarIcon focused={focused} name={ICONS.home} />,
            tabBarLabel: ({ focused }) => <TabBarLabel focused={focused}>{t('tabs.home')}</TabBarLabel>,
          }}
        />
        <Tabs.Screen
          name="catalog"
          options={{
            title: t('tabs.catalog'),
            tabBarIcon: ({ focused }) => <TabBarIcon focused={focused} name={ICONS.catalog} />,
            tabBarLabel: ({ focused }) => <TabBarLabel focused={focused}>{t('tabs.catalog')}</TabBarLabel>,
          }}
        />
        <Tabs.Screen
          name="orders"
          options={{
            title: t('tabs.orders'),
            tabBarIcon: ({ focused }) => <TabBarIcon focused={focused} name={ICONS.orders} />,
            tabBarLabel: ({ focused }) => <TabBarLabel focused={focused}>{t('tabs.orders')}</TabBarLabel>,
          }}
        />
        <Tabs.Screen
          name="more"
          options={{
            title: t('tabs.more'),
            tabBarIcon: ({ focused }) => <TabBarIcon focused={focused} name={ICONS.more} />,
            tabBarLabel: ({ focused }) => <TabBarLabel focused={focused}>{t('tabs.more')}</TabBarLabel>,
          }}
          listeners={{
            tabPress: (e) => {
              e.preventDefault()
              setMoreOpen(true)
            },
          }}
        />

        {/* Overflow screens — reachable via the "Más" sheet, hidden from the bar. */}
        <Tabs.Screen name="points" options={{ title: t('tabs.points'), href: null }} />
        <Tabs.Screen name="credit" options={{ title: t('tabs.credit'), href: null }} />
        <Tabs.Screen name="subscription" options={{ title: t('tabs.subscription'), href: null }} />
        <Tabs.Screen name="alquileres" options={{ title: t('tabs.rentals'), href: null }} />
        <Tabs.Screen name="profile" options={{ title: t('tabs.account'), href: null }} />
      </Tabs>

      <MoreSheet
        visible={moreOpen}
        onClose={() => setMoreOpen(false)}
        items={moreItems}
      />
    </>
  )
}
