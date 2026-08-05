import { useEffect, useState } from 'react'
import { Tabs, router } from 'expo-router'
import { useCurrentUser } from '../../lib/queries'
import { MoreSheet, type MoreSheetItem } from '../../components/MoreSheet'
import { isStaff } from '../../lib/roles'
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
  { label: 'Vendedores', icon: { ios: 'bag.fill', android: 'store' }, route: '/(super)/sellers' },
  { label: 'Reparto', icon: { ios: 'person.crop.circle.fill', android: 'account_circle' }, route: '/(super)/profile' },
]

/**
 * Overflow del VENDEDOR. Entra al mismo panel, pero recortado: su cartera de
 * clientes y sus ingresos. El resto (productos, categorías, crédito,
 * suscripción, promotores) no le corresponde y la API se lo rechazaría —
 * mostrarle pestañas que no puede usar es peor que no mostrarlas.
 */
const SELLER_MORE_ITEMS: MoreSheetItem[] = [
  { label: 'Mis clientes', icon: { ios: 'person.2.fill', android: 'group' }, route: '/(super)/users' },
  { label: 'Mis ingresos', icon: { ios: 'dollarsign.circle.fill', android: 'payments' }, route: '/(super)/earnings' },
  { label: 'Mi cuenta', icon: { ios: 'person.crop.circle.fill', android: 'account_circle' }, route: '/(super)/profile' },
]

export default function SuperLayout() {
  const { data: user, isPending } = useCurrentUser()
  const [moreOpen, setMoreOpen] = useState(false)
  const screenOptions = useTabBarScreenOptions()
  const isSellerView = user?.role === 'seller'

  useEffect(() => {
    if (isPending) return
    if (!user) {
      router.replace('/(auth)/login')
      return
    }
    // El vendedor entra al panel: la API le acota todo a su cartera.
    if (!isStaff(user.role)) {
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
            // El vendedor no administra el catálogo global.
            href: isSellerView ? null : undefined,
            tabBarIcon: ({ focused }) => <TabBarIcon focused={focused} name={ICONS.products} />,
            tabBarLabel: ({ focused }) => <TabBarLabel focused={focused}>Catálogo</TabBarLabel>,
          }}
        />
        <Tabs.Screen
          name="categories"
          options={{
            title: 'Categorías',
            href: isSellerView ? null : undefined,
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
        <Tabs.Screen name="sellers" options={{ title: 'Vendedores', href: null }} />
        <Tabs.Screen name="earnings" options={{ title: 'Mis ingresos', href: null }} />
      </Tabs>

      <MoreSheet
        visible={moreOpen}
        onClose={() => setMoreOpen(false)}
        items={isSellerView ? SELLER_MORE_ITEMS : SUPER_MORE_ITEMS}
      />
    </>
  )
}
