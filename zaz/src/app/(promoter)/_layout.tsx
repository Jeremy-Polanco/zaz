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
  panel: { ios: 'bolt.fill', android: 'bolt' },
  commissions: { ios: 'dollarsign.circle.fill', android: 'attach_money' },
  payouts: { ios: 'arrow.down.circle.fill', android: 'download' },
  profile: { ios: 'person.crop.circle.fill', android: 'account_circle' },
} as const satisfies Record<string, IconName>

export default function PromoterLayout() {
  const { data: user, isPending } = useCurrentUser()

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
        name="payouts"
        options={{
          title: 'Pagos',
          tabBarIcon: ({ focused }) => <TabIcon focused={focused} name={ICONS.payouts} />,
          tabBarLabel: ({ focused }) => <TabLabel focused={focused}>Pagos</TabLabel>,
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
      <Tabs.Screen name="catalog" options={{ href: null }} />
      <Tabs.Screen name="points" options={{ href: null }} />
    </Tabs>
  )
}
