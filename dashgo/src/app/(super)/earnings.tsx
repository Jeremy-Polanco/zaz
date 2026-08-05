import { ActivityIndicator, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useCurrentUser, useSellerEarnings } from '../../lib/queries'
import { SellerEarningsCard } from '../../components/SellerEarningsCard'
import { Eyebrow, SectionHead } from '../../components/ui'

/**
 * "Mis ingresos" del vendedor. Vive bajo (super) porque el vendedor entra al
 * mismo panel recortado que sus pedidos y sus clientes.
 */
export default function SellerEarningsScreen() {
  const { data: me } = useCurrentUser()
  const isSeller = me?.role === 'seller'
  const { data: earnings, isPending } = useSellerEarnings(
    isSeller ? (me?.id ?? null) : null,
  )

  return (
    <SafeAreaView className="flex-1 bg-paper" edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 48 }}>
        <SectionHead eyebrow="Mis ingresos" title="Comisiones" />

        <View className="mt-6">
          {!isSeller ? (
            <View className="items-center py-10">
              <Eyebrow>Solo vendedores</Eyebrow>
              <Text className="mt-3 text-center font-sans text-[15px] text-ink-soft">
                Esta pantalla muestra las comisiones de un vendedor.
              </Text>
            </View>
          ) : isPending || !earnings ? (
            <ActivityIndicator />
          ) : (
            <SellerEarningsCard earnings={earnings} />
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}
