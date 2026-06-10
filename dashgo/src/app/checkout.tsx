import { useMemo, useState } from 'react'
import { View, Text, Pressable, ScrollView } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { useCart, cart } from '../lib/cart'
import {
  useConfirmNonStripeOrder,
  useCreateOrder,
  useCurrentUser,
  useMyCredit,
  useMySubscription,
  useOrders,
  usePointsBalance,
  useProducts,
} from '../lib/queries'
import { formatCents } from '../lib/format'
import { computeQuotePreviewCents } from '../lib/tax'
import type { PaymentMethod } from '../lib/types'
import { Button, Eyebrow, Hairline } from '../components/ui'

// ─── Component ────────────────────────────────────────────────────────────────

export default function CheckoutScreen() {
  const cartState = useCart()
  const { data: user } = useCurrentUser()
  const { data: products } = useProducts()
  const { data: pointsBalance } = usePointsBalance()
  const { data: creditData } = useMyCredit()
  const { data: subscription } = useMySubscription()
  const createOrder = useCreateOrder()
  const confirmOrder = useConfirmNonStripeOrder()
  const { data: orders } = useOrders()

  // One order at a time: block while a previous order is still in progress
  // (anything not delivered/cancelled). Mirrors the server guard.
  const activeOrder = orders?.find(
    (o) => o.status !== 'delivered' && o.status !== 'cancelled',
  )

  const isActiveSubscriber =
    subscription?.status === 'active' || subscription?.status === 'past_due'

  // ── Payment state ──────────────────────────────────────────────────────────
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash')
  const [usePoints, setUsePoints] = useState(false)
  const [useCredit, setUseCredit] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ── Derived values ─────────────────────────────────────────────────────────

  const lineItems = useMemo(() => {
    if (!products) return []
    return Object.entries(cartState.items).map(([productId, qty]) => {
      const product = products.find((p) => p.id === productId)
      return { productId, quantity: qty, product }
    })
  }, [products, cartState])

  const subtotalCents = useMemo(
    () =>
      lineItems.reduce(
        (sum, li) =>
          sum + (li.product ? li.product.effectivePriceCents * li.quantity : 0),
        0,
      ),
    [lineItems],
  )

  const rentalFirstMonthCents = useMemo(
    () =>
      lineItems.reduce(
        (sum, li) =>
          li.product?.pricingMode === 'rental' && li.product.monthlyRentCents
            ? sum + li.product.monthlyRentCents * li.quantity
            : sum,
        0,
      ),
    [lineItems],
  )

  const hasRentalItems = rentalFirstMonthCents > 0

  // Mixed-cart guard: detect when cart has BOTH rental and non-rental products
  const hasMixedCart = useMemo(() => {
    const hasRental = lineItems.some((li) => li.product?.pricingMode === 'rental')
    const hasSinglePayment = lineItems.some((li) => li.product && li.product.pricingMode !== 'rental')
    return hasRental && hasSinglePayment
  }, [lineItems])

  // Monthly recurring total — shown only for pure-rental carts
  const monthlyRecurringCents = useMemo(
    () =>
      hasMixedCart
        ? 0
        : lineItems.reduce(
            (sum, li) =>
              li.product?.pricingMode === 'rental' && li.product.monthlyRentCents
                ? sum + li.product.monthlyRentCents * li.quantity
                : sum,
            0,
          ),
    [lineItems, hasMixedCart],
  )

  const claimableCents = pointsBalance?.claimableCents ?? 0
  const redeemCents = usePoints ? Math.min(claimableCents, subtotalCents) : 0

  const creditUsable =
    user?.role === 'client' &&
    creditData &&
    creditData.status !== 'none' &&
    creditData.status !== 'overdue' &&
    creditData.balanceCents !== null &&
    creditData.creditLimitCents !== null
  const availableCreditCents = creditUsable
    ? creditData!.balanceCents! + creditData!.creditLimitCents!
    : 0
  const creditAppliedCents = useCredit
    ? Math.min(availableCreditCents, Math.max(0, subtotalCents - redeemCents))
    : 0

  const previewTotalCents = Math.max(0, subtotalCents - redeemCents - creditAppliedCents)

  // Skip-cotización: when EVERY cart item has requiresQuote=false (e.g. water),
  // the order is auto-quoted at creation — shipping $0, tax computed now. Show
  // the real numbers instead of the "a cotizar" placeholders.
  const allSkipQuote =
    lineItems.length > 0 &&
    lineItems.every((li) => li.product?.requiresQuote === false)
  const skipQuoteTaxCents = allSkipQuote
    ? computeQuotePreviewCents({
        subtotalCents,
        shippingCents: 0,
        pointsRedeemedCents: redeemCents,
      }).taxCents
    : 0
  const skipQuoteTotalCents = previewTotalCents + skipQuoteTaxCents

  const itemCount = useMemo(
    () => lineItems.reduce((sum, li) => sum + li.quantity, 0),
    [lineItems],
  )

  // ── Order submission ───────────────────────────────────────────────────────

  const executeOrder = async () => {
    const items = lineItems.map(({ productId, quantity }) => ({
      productId,
      quantity,
    }))

    try {
      const created = await createOrder.mutateAsync({
        items,
        paymentMethod,
        usePoints,
        useCredit,
      })

      // One-click: a cash order that's auto-quoted (skip-cotización, e.g. water)
      // already shows its final total — confirm it right away so there's no
      // second "Confirmar" tap on the order screen. Normal/digital orders keep
      // their step (admin quote / payment).
      if (created.status === 'quoted' && created.paymentMethod === 'cash') {
        try {
          await confirmOrder.mutateAsync(created.id)
        } catch {
          // Non-blocking — the order screen still offers a manual confirm.
        }
      }

      cart.clear()
      router.replace({
        pathname: '/orders/[orderId]',
        params: { orderId: created.id },
      })
    } catch (e) {
      setError(
        (e as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? 'No se pudo crear el pedido',
      )
    }
  }

  const onSubmit = () => {
    setError(null)

    // Mixed-cart guard — mirrors server enforcement (Batch C T6.4)
    if (hasMixedCart) {
      setError('No podés combinar productos de alquiler con productos de compra única.')
      return
    }

    // No confirmation step — keep checkout one-tap simple.
    void executeOrder()
  }

  // ── Empty cart guard ───────────────────────────────────────────────────────

  if (lineItems.length === 0) {
    return (
      <SafeAreaView className="flex-1 bg-paper">
        <View className="flex-1 items-center justify-center px-6">
          <Eyebrow>Carrito</Eyebrow>
          <Text className="mt-4 font-sans-semibold text-3xl text-ink">Está vacío.</Text>
          <Text className="mt-2 text-center text-[14px] text-ink-soft">
            Agrega productos desde el catálogo para continuar.
          </Text>
          <View className="mt-8 w-full max-w-[240px]">
            <Button variant="ink" size="lg" onPress={() => router.back()}>
              Volver →
            </Button>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  if (activeOrder) {
    return (
      <SafeAreaView className="flex-1 bg-paper">
        <View className="flex-1 items-center justify-center px-6">
          <Eyebrow>Pedido en curso</Eyebrow>
          <Text className="mt-4 font-sans-semibold text-3xl text-ink">
            Ya tenés uno en camino.
          </Text>
          <Text className="mt-2 text-center text-[14px] text-ink-soft">
            Esperá a que se complete para hacer otro. Te avisamos cuando llegue.
          </Text>
          <View className="mt-8 w-full max-w-[240px]">
            <Button
              variant="ink"
              size="lg"
              onPress={() =>
                router.replace({
                  pathname: '/orders/[orderId]',
                  params: { orderId: activeOrder.id },
                })
              }
            >
              Ver mi pedido →
            </Button>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView edges={['bottom']} className="flex-1 bg-paper">
      <ScrollView contentContainerClassName="px-5 pt-2 pb-8">
        <Eyebrow className="mb-3">Checkout</Eyebrow>
        <Text className="font-sans-semibold text-[36px] leading-[40px] text-ink">
          Casi listo.
        </Text>
        <Text className="mt-2 text-[14px] leading-[20px] text-ink-soft">
          {itemCount} {itemCount === 1 ? 'producto' : 'productos'} para entregar hoy.
        </Text>

        <Hairline className="my-8" />

        {/* 01 · Resumen */}
        <View className="mb-10">
          <View className="mb-4 flex-row items-baseline gap-3">
            <Text className="font-sans-italic text-2xl text-brand">01</Text>
            <Text className="font-sans text-[11px] uppercase tracking-eyebrow text-ink-muted">
              Resumen
            </Text>
          </View>
          {lineItems.map((li) =>
            li.product ? (
              <View
                key={li.productId}
                className="flex-row items-start justify-between border-b border-ink/10 py-3"
              >
                <View className="flex-1 pr-3">
                  <View className="flex-row flex-wrap items-center gap-2">
                    <Text className="font-sans-medium text-[15px] text-ink">
                      {li.product.name}
                    </Text>
                    {li.product.offerActive && li.product.offerLabel && (
                      <View className="bg-accent px-1.5 py-0.5">
                        <Text className="font-sans text-[9px] uppercase tracking-label text-paper">
                          {li.product.offerLabel}
                        </Text>
                      </View>
                    )}
                  </View>
                  {li.product.offerActive ? (
                    <View className="mt-0.5 flex-row items-center gap-2">
                      <Text
                        className="font-sans text-[11px] uppercase tracking-label text-ink-muted"
                        style={{ fontVariant: ['tabular-nums'] }}
                      >
                        {li.quantity} × {formatCents(li.product.effectivePriceCents)}
                      </Text>
                      <Text
                        className="font-sans text-[11px] text-ink-muted line-through"
                        style={{ fontVariant: ['tabular-nums'] }}
                      >
                        {formatCents(li.product.basePriceCents)}
                      </Text>
                    </View>
                  ) : li.product.pricingMode === 'rental' && li.product.monthlyRentCents ? (
                    <View className="mt-0.5">
                      <Text
                        className="font-sans text-[11px] uppercase tracking-label text-ink-muted"
                        style={{ fontVariant: ['tabular-nums'] }}
                      >
                        {formatCents(li.product.monthlyRentCents)} (primer mes)
                      </Text>
                      <Text className="font-sans text-[10px] text-ink-muted">
                        luego {formatCents(li.product.monthlyRentCents)}/mes
                      </Text>
                    </View>
                  ) : (
                    <Text
                      className="mt-0.5 font-sans text-[11px] uppercase tracking-label text-ink-muted"
                      style={{ fontVariant: ['tabular-nums'] }}
                    >
                      {li.quantity} × {formatCents(li.product.effectivePriceCents)}
                    </Text>
                  )}
                </View>
                <Text
                  className={`font-sans-semibold text-[17px] ${li.product.offerActive ? 'text-brand' : 'text-ink'}`}
                  style={{ fontVariant: ['tabular-nums'] }}
                >
                  {formatCents(li.product.effectivePriceCents * li.quantity)}
                </Text>
              </View>
            ) : null,
          )}
        </View>

        {/* 02 · Pago */}
        <View className="mb-8">
          <View className="mb-4 flex-row items-baseline gap-3">
            <Text className="font-sans-italic text-2xl text-brand">02</Text>
            <Text className="font-sans text-[11px] uppercase tracking-eyebrow text-ink-muted">
              Pago
            </Text>
          </View>
          <View className="flex-row gap-3">
            <Pressable
              onPress={() => setPaymentMethod('cash')}
              className={`flex-1 border px-4 py-4 ${
                paymentMethod === 'cash' ? 'border-ink bg-ink' : 'border-ink/20 bg-paper'
              }`}
            >
              <Text
                className={`font-sans text-[10px] uppercase tracking-label ${
                  paymentMethod === 'cash' ? 'text-paper/70' : 'text-ink-muted'
                }`}
              >
                Al recibir
              </Text>
              <Text
                className={`mt-1 font-sans-semibold text-[18px] ${
                  paymentMethod === 'cash' ? 'text-paper' : 'text-ink'
                }`}
              >
                Efectivo
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setPaymentMethod('digital')}
              className={`flex-1 border px-4 py-4 ${
                paymentMethod === 'digital' ? 'border-ink bg-ink' : 'border-ink/20 bg-paper'
              }`}
            >
              <Text
                className={`font-sans text-[10px] uppercase tracking-label ${
                  paymentMethod === 'digital' ? 'text-paper/70' : 'text-ink-muted'
                }`}
              >
                Online
              </Text>
              <Text
                className={`mt-1 font-sans-semibold text-[18px] ${
                  paymentMethod === 'digital' ? 'text-paper' : 'text-ink'
                }`}
              >
                Digital
              </Text>
            </Pressable>
          </View>
        </View>

        {/* 03 · Mi crédito */}
        {creditUsable && availableCreditCents > 0 && (
          <View className="mb-8">
            <View className="mb-4 flex-row items-baseline gap-3">
              <Text className="font-sans-italic text-2xl text-brand">03</Text>
              <Text className="font-sans text-[11px] uppercase tracking-eyebrow text-ink-muted">
                Mi crédito
              </Text>
            </View>
            <Pressable
              onPress={() => setUseCredit((v) => !v)}
              className={`border px-4 py-4 ${
                useCredit ? 'border-accent bg-accent' : 'border-ink/20 bg-paper'
              }`}
            >
              <View className="flex-row items-center justify-between">
                <View className="flex-1 pr-3">
                  <Text
                    className={`font-sans text-[10px] uppercase tracking-label ${
                      useCredit ? 'text-paper/70' : 'text-ink-muted'
                    }`}
                  >
                    Disponible
                  </Text>
                  <Text
                    className={`mt-1 font-sans-semibold text-[18px] ${
                      useCredit ? 'text-paper' : 'text-ink'
                    }`}
                  >
                    Usar {formatCents(availableCreditCents)} en crédito
                  </Text>
                </View>
                <View
                  className={`h-6 w-6 items-center justify-center border-2 ${
                    useCredit ? 'border-paper bg-paper' : 'border-ink/40 bg-transparent'
                  }`}
                >
                  {useCredit && (
                    <Text className="font-sans-semibold text-brand">✓</Text>
                  )}
                </View>
              </View>
            </Pressable>
          </View>
        )}

        {/* 04 · Mis puntos */}
        {claimableCents > 0 && (
          <View className="mb-8">
            <View className="mb-4 flex-row items-baseline gap-3">
              <Text className="font-sans-italic text-2xl text-brand">04</Text>
              <Text className="font-sans text-[11px] uppercase tracking-eyebrow text-ink-muted">
                Mis puntos
              </Text>
            </View>
            <Pressable
              onPress={() => setUsePoints((v) => !v)}
              className={`border px-4 py-4 ${
                usePoints ? 'border-accent bg-accent' : 'border-ink/20 bg-paper'
              }`}
            >
              <View className="flex-row items-center justify-between">
                <View className="flex-1 pr-3">
                  <Text
                    className={`font-sans text-[10px] uppercase tracking-label ${
                      usePoints ? 'text-paper/70' : 'text-ink-muted'
                    }`}
                  >
                    Canje total
                  </Text>
                  <Text
                    className={`mt-1 font-sans-semibold text-[18px] ${
                      usePoints ? 'text-paper' : 'text-ink'
                    }`}
                  >
                    Usar {formatCents(claimableCents)} en puntos
                  </Text>
                </View>
                <View
                  className={`h-6 w-6 items-center justify-center border-2 ${
                    usePoints ? 'border-paper bg-paper' : 'border-ink/40 bg-transparent'
                  }`}
                >
                  {usePoints && (
                    <Text className="font-sans-semibold text-brand">✓</Text>
                  )}
                </View>
              </View>
            </Pressable>
          </View>
        )}

        {/* Total band */}
        <View className="border-t-2 border-ink pt-4">
          <View className="mb-2 flex-row items-baseline justify-between">
            <Text className="font-sans text-[11px] uppercase tracking-label text-ink-muted">
              Subtotal
            </Text>
            <Text
              className="font-sans text-[14px] text-ink"
              style={{ fontVariant: ['tabular-nums'] }}
            >
              {formatCents(subtotalCents)}
            </Text>
          </View>
          {hasRentalItems && (
            <View className="mb-2 flex-row items-baseline justify-between">
              <Text className="font-sans text-[11px] uppercase tracking-label text-brand">
                Primer mes alquiler
              </Text>
              <Text
                className="font-sans text-[14px] text-brand"
                style={{ fontVariant: ['tabular-nums'] }}
              >
                {formatCents(rentalFirstMonthCents)}
              </Text>
            </View>
          )}
          {redeemCents > 0 && (
            <View className="mb-2 flex-row items-baseline justify-between">
              <Text className="font-sans text-[11px] uppercase tracking-label text-brand">
                Descuento por puntos
              </Text>
              <Text
                className="font-sans text-[14px] text-brand"
                style={{ fontVariant: ['tabular-nums'] }}
              >
                −{formatCents(redeemCents)}
              </Text>
            </View>
          )}
          {creditAppliedCents > 0 && (
            <View className="mb-2 flex-row items-baseline justify-between">
              <Text className="font-sans text-[11px] uppercase tracking-label text-brand">
                Crédito aplicado
              </Text>
              <Text
                className="font-sans text-[14px] text-brand"
                style={{ fontVariant: ['tabular-nums'] }}
              >
                −{formatCents(creditAppliedCents)}
              </Text>
            </View>
          )}
          <View className="mb-2 flex-row items-baseline justify-between">
            <Text className="font-sans text-[11px] uppercase tracking-label text-ink-muted">
              Envío
            </Text>
            {allSkipQuote ? (
              <Text className="font-sans text-[14px] text-green-700">Gratis</Text>
            ) : isActiveSubscriber ? (
              <Text className="font-sans text-[14px] text-green-700">
                Gratis con tu suscripción
              </Text>
            ) : (
              <Text
                className="font-sans text-[14px] italic text-ink-muted"
                style={{ fontVariant: ['tabular-nums'] }}
              >
                A cotizar
              </Text>
            )}
          </View>
          <View className="mb-3 flex-row items-baseline justify-between">
            <Text className="font-sans text-[11px] uppercase tracking-label text-ink-muted">
              Impuestos
            </Text>
            {allSkipQuote ? (
              <Text
                className="font-sans text-[14px] text-ink"
                style={{ fontVariant: ['tabular-nums'] }}
              >
                {formatCents(skipQuoteTaxCents)}
              </Text>
            ) : (
              <Text
                className="font-sans text-[14px] italic text-ink-muted"
                style={{ fontVariant: ['tabular-nums'] }}
              >
                Al cotizar
              </Text>
            )}
          </View>
          <View className="flex-row items-baseline justify-between border-t border-ink pt-3">
            <Eyebrow tone="ink">{allSkipQuote ? 'Total' : 'Subtotal'}</Eyebrow>
            <Text
              className="font-sans-semibold text-[36px] text-brand"
              style={{ fontVariant: ['tabular-nums'] }}
            >
              {formatCents(allSkipQuote ? skipQuoteTotalCents : previewTotalCents)}
            </Text>
          </View>
          <Text className="mt-3 font-sans text-[11px] text-ink-muted">
            {allSkipQuote
              ? 'Sin cotización — este es el total final. Confirmás y pagás.'
              : 'El repartidor cotiza el envío y te avisamos para confirmar el total.'}
          </Text>
        </View>

        {/* Monthly recurring disclosure — only for pure-rental carts */}
        {monthlyRecurringCents > 0 && !hasMixedCart && (
          <View className="mt-4 border border-brand/30 bg-brand-light/20 px-4 py-3">
            <Text className="font-sans text-[11px] uppercase tracking-label text-brand">
              Cargo recurrente mensual
            </Text>
            <Text
              className="mt-1 font-sans-semibold text-[18px] text-brand"
              style={{ fontVariant: ['tabular-nums'] }}
            >
              {formatCents(monthlyRecurringCents)}/mes
            </Text>
            <Text className="mt-1 font-sans text-[11px] text-ink-muted">
              A partir del segundo mes, el cargo mensual se aplicará automáticamente.
            </Text>
          </View>
        )}

        {/* Mixed-cart error banner */}
        {hasMixedCart && (
          <View className="mt-4 border border-bad/30 bg-bad/5 px-4 py-3">
            <Text className="font-sans text-[13px] text-bad">
              No podés combinar productos de alquiler con productos de compra única.
            </Text>
            <Text className="mt-1 font-sans text-[11px] text-ink-muted">
              Hacé pedidos separados: uno para alquileres y otro para compras únicas.
            </Text>
          </View>
        )}

        {error && (
          <Text className="mt-4 font-sans text-[11px] uppercase tracking-label text-bad">
            {error}
          </Text>
        )}

        <View className="mt-8">
          <Button
            variant="accent"
            size="lg"
            loading={createOrder.isPending || confirmOrder.isPending}
            disabled={hasMixedCart}
            onPress={onSubmit}
          >
            Confirmar pedido →
          </Button>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}
