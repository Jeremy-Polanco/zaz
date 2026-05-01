import { View, Text, ScrollView, ActivityIndicator, Share } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, router } from 'expo-router'
import { useInvoice } from '../../../lib/queries'
import { formatDate, formatMoney } from '../../../lib/format'
import { Button, Eyebrow, Hairline } from '../../../components/ui'

export default function InvoiceScreen() {
  const params = useLocalSearchParams<{ orderId: string }>()
  const orderId = typeof params.orderId === 'string' ? params.orderId : ''
  const { data: invoice, isPending, isError, error } = useInvoice(orderId || undefined)

  const share = async () => {
    if (!invoice) return
    const lines = [
      `Factura ${invoice.invoiceNumber}`,
      `Zaz · ${formatDate(invoice.createdAt)}`,
      '',
      ...invoice.items.map(
        (it) =>
          `${it.quantity}× ${it.productName} — ${formatMoney(it.lineTotal)}`,
      ),
      '',
      `Subtotal: ${formatMoney(invoice.subtotal)}`,
      ...(parseFloat(invoice.pointsRedeemed) > 0
        ? [`Descuento por puntos: −${formatMoney(invoice.pointsRedeemed)}`]
        : []),
      `Envío: ${
        parseFloat(invoice.shipping) > 0
          ? formatMoney(invoice.shipping)
          : 'Gratis'
      }`,
      `Impuestos: ${formatMoney(invoice.tax)}`,
      `Total: ${formatMoney(invoice.total)}`,
    ]
    await Share.share({ message: lines.join('\n') })
  }

  if (isPending) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-paper">
        <ActivityIndicator color="#220247" size="small" />
      </SafeAreaView>
    )
  }

  if (isError || !invoice) {
    return (
      <SafeAreaView edges={['top']} className="flex-1 bg-paper">
        <View className="flex-1 items-center justify-center px-6 py-20">
          <Eyebrow className="mb-4">Factura</Eyebrow>
          <Text className="text-center font-sans-semibold text-[28px] leading-[32px] text-ink">
            No disponible
          </Text>
          <Text className="mt-6 max-w-sm text-center text-[14px] leading-[20px] text-ink-muted">
            {(error as Error & {
              response?: { data?: { message?: string } }
            })?.response?.data?.message ??
              'La factura se genera cuando el pedido se marca como entregado.'}
          </Text>
          <View className="mt-10 w-full max-w-xs">
            <Button variant="ink" size="lg" onPress={() => router.back()}>
              Volver
            </Button>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  const taxRatePct = (parseFloat(invoice.taxRate) * 100).toFixed(3)

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-paper">
      <ScrollView contentContainerClassName="px-5 pb-8">
        <View className="flex-row items-center justify-between pt-4">
          <Button variant="ghost" onPress={() => router.back()}>
            ← Volver
          </Button>
          <Button variant="accent" onPress={share}>
            Compartir
          </Button>
        </View>

        <View className="mt-6 border-b-2 border-ink pb-6">
          <Eyebrow>Factura</Eyebrow>
          <Text className="mt-3 font-sans-semibold text-[44px] leading-[48px] text-ink">
            Zaz
          </Text>
          <Text className="mt-1 font-sans text-[11px] uppercase tracking-label text-ink-muted">
            Agua al timbre · New York
          </Text>

          <View className="mt-4 flex-row items-end justify-between">
            <View>
              <Eyebrow>Nº</Eyebrow>
              <Text
                className="mt-1 font-sans-semibold text-[22px] text-ink"
                style={{ fontVariant: ['tabular-nums'] }}
              >
                {invoice.invoiceNumber}
              </Text>
            </View>
            <Text className="font-sans text-[11px] uppercase tracking-label text-ink-muted">
              {formatDate(invoice.createdAt)}
            </Text>
          </View>
        </View>

        <View className="mt-6 flex-row gap-6 border-b border-ink/10 pb-6">
          <View className="flex-1">
            <Eyebrow>Facturado a</Eyebrow>
            <Text className="mt-2 font-sans-semibold text-[18px] text-ink">
              {invoice.customer.fullName}
            </Text>
            <Text className="mt-1 font-sans text-[12px] text-ink-soft">
              {invoice.customer.phone ?? '—'}
            </Text>
          </View>
          <View className="flex-1">
            <Eyebrow>Entrega</Eyebrow>
            <Text className="mt-2 text-[14px] text-ink">
              {invoice.order.deliveryAddress.text}
            </Text>
            <Text className="mt-1 font-sans text-[10px] uppercase tracking-label text-ink-muted">
              {invoice.order.paymentMethod === 'cash'
                ? 'Pago en efectivo'
                : 'Pago digital'}
            </Text>
          </View>
        </View>

        <View className="mt-6">
          <Eyebrow>Detalle</Eyebrow>
          <View className="mt-4">
            {invoice.items.map((item) => (
              <View
                key={item.id}
                className="flex-row items-start justify-between border-b border-ink/10 py-3"
              >
                <View className="flex-1 pr-3">
                  <Text className="font-sans-medium text-[14px] text-ink">
                    {item.productName}
                  </Text>
                  <Text
                    className="mt-0.5 font-sans text-[11px] uppercase tracking-label text-ink-muted"
                    style={{ fontVariant: ['tabular-nums'] }}
                  >
                    {item.quantity} × {formatMoney(item.priceAtOrder)}
                  </Text>
                </View>
                <Text
                  className="font-sans-semibold text-[16px] text-ink"
                  style={{ fontVariant: ['tabular-nums'] }}
                >
                  {formatMoney(item.lineTotal)}
                </Text>
              </View>
            ))}
          </View>
        </View>

        <View className="mt-6 border-t-2 border-ink pt-4">
          <View className="mb-2 flex-row items-baseline justify-between">
            <Text className="font-sans text-[11px] uppercase tracking-label text-ink-muted">
              Subtotal
            </Text>
            <Text
              className="font-sans text-[14px] text-ink"
              style={{ fontVariant: ['tabular-nums'] }}
            >
              {formatMoney(invoice.subtotal)}
            </Text>
          </View>
          {parseFloat(invoice.pointsRedeemed) > 0 && (
            <View className="mb-2 flex-row items-baseline justify-between">
              <Text className="font-sans text-[11px] uppercase tracking-label text-brand">
                Descuento por puntos
              </Text>
              <Text
                className="font-sans text-[14px] text-brand"
                style={{ fontVariant: ['tabular-nums'] }}
              >
                −{formatMoney(invoice.pointsRedeemed)}
              </Text>
            </View>
          )}
          <View className="mb-2 flex-row items-baseline justify-between">
            <Text className="font-sans text-[11px] uppercase tracking-label text-ink-muted">
              Envío
            </Text>
            <Text
              className="font-sans text-[14px] text-ink"
              style={{ fontVariant: ['tabular-nums'] }}
            >
              {parseFloat(invoice.shipping) > 0
                ? formatMoney(invoice.shipping)
                : 'Gratis'}
            </Text>
          </View>
          <View className="mb-3 flex-row items-baseline justify-between">
            <Text className="font-sans text-[11px] uppercase tracking-label text-ink-muted">
              Impuestos ({taxRatePct}%)
            </Text>
            <Text
              className="font-sans text-[14px] text-ink"
              style={{ fontVariant: ['tabular-nums'] }}
            >
              {formatMoney(invoice.tax)}
            </Text>
          </View>
          <View className="flex-row items-baseline justify-between border-t border-ink pt-3">
            <Eyebrow tone="ink">Total</Eyebrow>
            <Text
              className="font-sans-semibold text-[32px] text-brand"
              style={{ fontVariant: ['tabular-nums'] }}
            >
              {formatMoney(invoice.total)}
            </Text>
          </View>
        </View>

        <Hairline className="mt-10" />
        <Text className="mt-6 text-center font-sans text-[10px] uppercase tracking-label text-ink-muted">
          Gracias por tu pedido
        </Text>
        <Text className="mt-1 text-center font-sans text-[10px] uppercase tracking-label text-ink-muted">
          Zaz · zaz.com
        </Text>
      </ScrollView>
    </SafeAreaView>
  )
}
