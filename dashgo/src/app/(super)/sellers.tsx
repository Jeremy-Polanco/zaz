import { ActivityIndicator, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useSellersPayable } from '../../lib/queries'
import { SellerEarningsCard } from '../../components/SellerEarningsCard'
import { Eyebrow, SectionHead } from '../../components/ui'
import { formatCents } from '../../lib/format'

/**
 * A quién pagarle. Espejo de dashgo-web/src/routes/super.sellers.tsx.
 *
 * El aviso de arriba no es adorno: mezclar tarjeta y efectivo en un solo total
 * es exactamente cómo se termina pagando dos veces la misma comisión.
 */
export default function SuperSellersScreen() {
  const { data: rows, isPending } = useSellersPayable()

  const totalCard = (rows ?? []).reduce(
    (s, r) => s + r.byPaymentMethod.card.claimableCents,
    0,
  )
  const totalCash = (rows ?? []).reduce(
    (s, r) => s + r.byPaymentMethod.cash.claimableCents,
    0,
  )

  return (
    <SafeAreaView className="flex-1 bg-paper" edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 48 }}>
        <SectionHead eyebrow="Vendedores" title="A quién pagar" />

        <View className="mt-4 border-l-[3px] border-accent-dark bg-accent-light px-3 py-3">
          <Text className="font-sans text-[13px] leading-snug text-ink">
            De lo cobrable, {formatCents(totalCard)} viene de pagos con{' '}
            <Text className="font-sans-semibold">tarjeta</Text> — esa plata entró
            a la empresa y se les debe. Otros {formatCents(totalCash)} vienen de
            órdenes cobradas <Text className="font-sans-semibold">en efectivo</Text>
            ; revisá si esa plata ya quedó en mano antes de volver a pagarla.
          </Text>
        </View>

        {isPending ? (
          <ActivityIndicator className="mt-10" />
        ) : (rows ?? []).length === 0 ? (
          <View className="mt-10 items-center py-10">
            <Eyebrow>Sin vendedores</Eyebrow>
            <Text className="mt-3 text-center font-sans text-[15px] text-ink-soft">
              Todavía no hay usuarios con rol Vendedor. Se asigna desde
              Usuarios.
            </Text>
          </View>
        ) : (
          <View className="mt-6 gap-5">
            {(rows ?? []).map((r) => (
              <View
                key={r.sellerId}
                className="border border-ink/15 bg-paper p-3"
              >
                <Text className="mb-3 font-sans-semibold text-[16px] text-ink">
                  {r.fullName}
                </Text>
                <SellerEarningsCard earnings={r} compact />
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}
