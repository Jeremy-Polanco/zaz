import { useEffect, useMemo, useState } from 'react'
import { View, Text, Pressable, ScrollView } from 'react-native'
import { useTranslation } from 'react-i18next'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { useCart, cart } from '../lib/cart'
import { useStripe } from '@stripe/stripe-react-native'
import {
  useAuthorizeOrder,
  useConfirmNonStripeOrder,
  useCreateOrder,
  useCurrentUser,
  useMyAddresses,
  useMyCredit,
  useMySubscription,
  useOrders,
  usePointsBalance,
  useProducts,
  useUpdateOrderStatus,
} from '../lib/queries'
import { userAddressToGeoAddress } from '../lib/address'
import { formatCents } from '../lib/format'
import { computeQuotePreviewCents } from '../lib/tax'
import type { PaymentMethod } from '../lib/types'
import { Button, Eyebrow, Hairline } from '../components/ui'

// ─── Component ────────────────────────────────────────────────────────────────

export default function CheckoutScreen() {
  const { t } = useTranslation('checkout')
  const cartState = useCart()
  const { data: user, isPending: userPending } = useCurrentUser()

  // Placing an order is account-based (Apple 5.1.1 boundary): guests who
  // reach checkout — e.g. via deep link — are sent to login and bounced
  // straight back here afterwards. The cart survives (module-level state).
  useEffect(() => {
    if (!userPending && !user) {
      router.replace({ pathname: '/(auth)/login', params: { next: '/checkout' } })
    }
  }, [user, userPending])
  const { data: products } = useProducts()
  const { data: pointsBalance } = usePointsBalance()
  const { data: creditData } = useMyCredit()
  const { data: subscription } = useMySubscription()
  const createOrder = useCreateOrder()
  const confirmOrder = useConfirmNonStripeOrder()
  const authorize = useAuthorizeOrder()
  const updateStatus = useUpdateOrderStatus()
  const { initPaymentSheet, presentPaymentSheet } = useStripe()
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
  // Propina — solo pago digital (en efectivo se da en mano). null = sin propina.
  const [tipPercent, setTipPercent] = useState<15 | 18 | 25 | null>(null)
  const [error, setError] = useState<string | null>(null)

  // ── Delivery address state ─────────────────────────────────────────────────
  // Customer-picked delivery address. Defaults to the saved default (then the
  // first) once addresses load; the customer can switch among saved locations.
  // No saved addresses → stays empty and the colmado pins it at delivery time.
  const { data: myAddresses } = useMyAddresses()
  const [selectedAddressId, setSelectedAddressId] = useState<string>('')
  useEffect(() => {
    if (!myAddresses || myAddresses.length === 0) return
    setSelectedAddressId((prev) => {
      if (prev && myAddresses.some((a) => a.id === prev)) return prev
      return (myAddresses.find((a) => a.isDefault) ?? myAddresses[0]).id
    })
  }, [myAddresses])
  const selectedAddress = myAddresses?.find((a) => a.id === selectedAddressId)
  const hasAddresses = (myAddresses?.length ?? 0) > 0
  // True while THIS order is being placed/paid. The just-created (status
  // 'quoted') order refetches into `orders` mid-flow and would otherwise trip
  // the activeOrder guard — slamming the "ya tenés uno en camino" screen in
  // front of the payment sheet. Suppress the blocker until the flow settles.
  const [placing, setPlacing] = useState(false)

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

  // Propina — % del subtotal de productos, sin impuestos. Mirrors the server
  // math in orders.service.create: the tip rides on the total AFTER tax.
  const tipCents =
    paymentMethod === 'digital' && tipPercent
      ? Math.round((subtotalCents * tipPercent) / 100)
      : 0

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
  const skipQuoteTotalCents = previewTotalCents + skipQuoteTaxCents + tipCents

  // Section numbering: Propina appears only for digital, shifting later sections.
  const pagoNo = hasAddresses ? 3 : 2
  const fmtNo = (n: number) => String(n).padStart(2, '0')

  const itemCount = useMemo(
    () => lineItems.reduce((sum, li) => sum + li.quantity, 0),
    [lineItems],
  )

  // ── Order submission ───────────────────────────────────────────────────────

  // Authorizes a skip-cotización digital order via the native PaymentSheet,
  // inline at checkout (no bounce to the order screen's "Autorizar" step).
  // Returns true once the hold is authorized; false on cancel/error.
  const payWithSheet = async (orderId: string): Promise<boolean> => {
    const intent = await authorize.mutateAsync(orderId)
    const initResult = await initPaymentSheet({
      merchantDisplayName: 'Udash',
      paymentIntentClientSecret: intent.clientSecret,
      allowsDelayedPaymentMethods: false,
      returnURL: 'dashgo://stripe-redirect',
    })
    if (initResult.error) {
      setError(initResult.error.message)
      return false
    }
    const sheetResult = await presentPaymentSheet()
    if (sheetResult.error) {
      if (sheetResult.error.code !== 'Canceled') {
        setError(sheetResult.error.message)
      }
      return false
    }
    return true
  }

  const executeOrder = async () => {
    const items = lineItems.map(({ productId, quantity }) => ({
      productId,
      quantity,
    }))

    setPlacing(true)
    try {
      const created = await createOrder.mutateAsync({
        items,
        paymentMethod,
        usePoints,
        useCredit,
        // Propina: digital-only — the server rejects it on cash orders.
        ...(paymentMethod === 'digital' && tipPercent ? { tipPercent } : {}),
        ...(selectedAddress
          ? { deliveryAddress: userAddressToGeoAddress(selectedAddress) }
          : {}),
      })

      // Skip-cotización orders are auto-quoted at creation (status 'quoted'):
      // nothing for the admin to quote, so we finish payment right here. Normal
      // orders (status 'pending_quote') go to the order screen to await a quote.
      const isSkipQuote = created.status === 'quoted'
      const totalCents = Math.round(parseFloat(created.totalAmount) * 100)
      const creditCents = Math.round(
        parseFloat(created.creditApplied ?? '0') * 100,
      )
      const fullCredit = creditCents > 0 && creditCents >= totalCents

      // Digital pay-now: an unpaid digital order must NOT linger. The cart is
      // where an unpaid order lives — so the order only "sticks" once the card
      // is actually authorized. If the customer dismisses the sheet (or the
      // card fails), we cancel the just-created order (server-side this reverses
      // any applied credit/points and re-increments stock) and KEEP the cart so
      // they can pay whenever they want.
      if (isSkipQuote && created.paymentMethod === 'digital' && !fullCredit) {
        const paidOk = await payWithSheet(created.id)
        if (!paidOk) {
          try {
            await updateStatus.mutateAsync({
              id: created.id,
              status: 'cancelled',
            })
          } catch {
            // Best-effort rollback — the order screen / admin can still cancel.
          }
          // Preserve a real failure reason (e.g. card declined) if payWithSheet
          // set one; otherwise show the friendly "cart still here" note.
          setError((prev) => prev ?? t('errors.paymentIncomplete'))
          return // keep the cart, stay on checkout — no order created
        }
        // Authorized → the order is real now.
        cart.clear()
        router.replace({
          pathname: '/orders/[orderId]',
          params: { orderId: created.id, paid: '1' },
        })
        return
      }

      if (isSkipQuote && (created.paymentMethod === 'cash' || fullCredit)) {
        // One-click: no card needed (cash, or fully covered by credit). The
        // server auto-confirms skip-quote orders from here. Non-blocking.
        try {
          await confirmOrder.mutateAsync(created.id)
        } catch {
          // The order screen still offers a manual confirm.
        }
      }

      // Cash / full-credit / quote-required orders: nothing to pay inline, so
      // the order is placed and we hand off to the order screen.
      cart.clear()
      router.replace({
        pathname: '/orders/[orderId]',
        params: { orderId: created.id },
      })
    } catch (e) {
      setError(
        (e as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? t('errors.createFailed'),
      )
    } finally {
      setPlacing(false)
    }
  }

  const onSubmit = () => {
    setError(null)

    // Mixed-cart guard — mirrors server enforcement (Batch C T6.4)
    if (hasMixedCart) {
      setError(t('mixedCart.error'))
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
          <Eyebrow>{t('emptyCart.eyebrow')}</Eyebrow>
          <Text className="mt-4 font-sans-semibold text-3xl text-ink">{t('emptyCart.title')}</Text>
          <Text className="mt-2 text-center text-[14px] text-ink-soft">
            {t('emptyCart.subtitle')}
          </Text>
          <View className="mt-8 w-full max-w-[240px]">
            <Button variant="ink" size="lg" onPress={() => router.back()}>
              {t('emptyCart.back')}
            </Button>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  if (activeOrder && !placing) {
    return (
      <SafeAreaView className="flex-1 bg-paper">
        <View className="flex-1 items-center justify-center px-6">
          <Eyebrow>{t('activeOrder.eyebrow')}</Eyebrow>
          <Text className="mt-4 font-sans-semibold text-3xl text-ink">
            {t('activeOrder.title')}
          </Text>
          <Text className="mt-2 text-center text-[14px] text-ink-soft">
            {t('activeOrder.subtitle')}
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
              {t('activeOrder.viewOrder')}
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
        <Eyebrow className="mb-3">{t('header.eyebrow')}</Eyebrow>
        <Text className="font-sans-semibold text-[36px] leading-[40px] text-ink">
          {t('header.title')}
        </Text>
        <Text className="mt-2 text-[14px] leading-[20px] text-ink-soft">
          {t('header.itemCount', { count: itemCount })}
        </Text>

        <Hairline className="my-8" />

        {/* 01 · Resumen */}
        <View className="mb-10">
          <View className="mb-4 flex-row items-baseline gap-3">
            <Text className="font-sans-italic text-2xl text-brand">01</Text>
            <Text className="font-sans text-[13px] uppercase tracking-eyebrow text-ink-muted">
              {t('summary.title')}
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
                        {t('summary.firstMonth', {
                          amount: formatCents(li.product.monthlyRentCents),
                        })}
                      </Text>
                      <Text className="font-sans text-[12px] text-ink-muted">
                        {t('summary.thenPerMonth', {
                          amount: formatCents(li.product.monthlyRentCents),
                        })}
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

        {/* 02 · Entrega — only when the customer has saved addresses */}
        {hasAddresses && myAddresses ? (
          <View className="mb-8">
            <View className="mb-4 flex-row items-baseline gap-3">
              <Text className="font-sans-italic text-2xl text-brand">02</Text>
              <Text className="font-sans text-[13px] uppercase tracking-eyebrow text-ink-muted">
                {t('delivery.title')}
              </Text>
            </View>
            <View className="gap-2">
              {myAddresses.map((addr) => {
                const selected = addr.id === selectedAddressId
                return (
                  <Pressable
                    key={addr.id}
                    onPress={() => setSelectedAddressId(addr.id)}
                    className={`min-h-[48px] flex-row items-center justify-between border px-4 py-3 ${
                      selected ? 'border-ink bg-ink/5' : 'border-ink/20 bg-paper'
                    }`}
                  >
                    <View className="flex-1 pr-3">
                      <Text className="font-sans-semibold text-[15px] text-ink" numberOfLines={1}>
                        {addr.label}
                        {addr.isDefault ? (
                          <Text className="font-sans text-[10px] uppercase tracking-label text-ink-muted">
                            {'  '}
                            {t('delivery.default')}
                          </Text>
                        ) : null}
                      </Text>
                      <Text className="mt-0.5 font-sans text-[15px] text-ink-muted" numberOfLines={1}>
                        {addr.line1}
                      </Text>
                    </View>
                    <View
                      className={`h-4 w-4 rounded-full border-2 ${
                        selected ? 'border-ink bg-ink' : 'border-ink/30'
                      }`}
                    />
                  </Pressable>
                )
              })}
            </View>
          </View>
        ) : null}

        {/* Pago */}
        <View className="mb-8">
          <View className="mb-4 flex-row items-baseline gap-3">
            <Text className="font-sans-italic text-2xl text-brand">
              {fmtNo(pagoNo)}
            </Text>
            <Text className="font-sans text-[13px] uppercase tracking-eyebrow text-ink-muted">
              {t('payment.title')}
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
                className={`font-sans text-[12px] uppercase tracking-label ${
                  paymentMethod === 'cash' ? 'text-paper/70' : 'text-ink-muted'
                }`}
              >
                {t('payment.cashLabel')}
              </Text>
              <Text
                className={`mt-1 font-sans-semibold text-[18px] ${
                  paymentMethod === 'cash' ? 'text-paper' : 'text-ink'
                }`}
              >
                {t('payment.cash')}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setPaymentMethod('digital')}
              className={`flex-1 border px-4 py-4 ${
                paymentMethod === 'digital' ? 'border-ink bg-ink' : 'border-ink/20 bg-paper'
              }`}
            >
              <Text
                className={`font-sans text-[12px] uppercase tracking-label ${
                  paymentMethod === 'digital' ? 'text-paper/70' : 'text-ink-muted'
                }`}
              >
                {t('payment.digitalLabel')}
              </Text>
              <Text
                className={`mt-1 font-sans-semibold text-[18px] ${
                  paymentMethod === 'digital' ? 'text-paper' : 'text-ink'
                }`}
              >
                {t('payment.digital')}
              </Text>
            </Pressable>
          </View>
        </View>

        {/* Propina — solo pago digital (en efectivo se da en mano) */}
        {paymentMethod === 'digital' && (
          <View className="mb-8">
            <View className="mb-4 flex-row items-baseline gap-3">
              <Text className="font-sans-italic text-2xl text-brand">
                {fmtNo(pagoNo + 1)}
              </Text>
              <Text className="font-sans text-[13px] uppercase tracking-eyebrow text-ink-muted">
                {t('tip.title')}
              </Text>
            </View>
            <View className="flex-row gap-3">
              {([null, 15, 18, 25] as const).map((pct) => {
                const selected = tipPercent === pct
                return (
                  <Pressable
                    key={pct ?? 'none'}
                    onPress={() => setTipPercent(pct)}
                    className={`flex-1 border px-2 py-3 ${
                      selected ? 'border-ink bg-ink' : 'border-ink/20 bg-paper'
                    }`}
                  >
                    <Text
                      className={`text-center font-sans-semibold text-[16px] ${
                        selected ? 'text-paper' : 'text-ink'
                      }`}
                    >
                      {pct ? `${pct}%` : t('tip.none')}
                    </Text>
                    <Text
                      className={`mt-0.5 text-center font-sans text-[11px] ${
                        selected ? 'text-paper/70' : 'text-ink-muted'
                      }`}
                      style={{ fontVariant: ['tabular-nums'] }}
                    >
                      {pct
                        ? formatCents(Math.round((subtotalCents * pct) / 100))
                        : t('tip.noneSubtitle')}
                    </Text>
                  </Pressable>
                )
              })}
            </View>
            <Text className="mt-2 font-sans text-[12px] text-ink-muted">
              {t('tip.note')}
            </Text>
          </View>
        )}

        {/* Mi crédito */}
        {creditUsable && availableCreditCents > 0 && (
          <View className="mb-8">
            <View className="mb-4 flex-row items-baseline gap-3">
              <Text className="font-sans-italic text-2xl text-brand">
                {fmtNo(pagoNo + (paymentMethod === 'digital' ? 2 : 1))}
              </Text>
              <Text className="font-sans text-[13px] uppercase tracking-eyebrow text-ink-muted">
                {t('credit.title')}
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
                    className={`font-sans text-[12px] uppercase tracking-label ${
                      useCredit ? 'text-paper/70' : 'text-ink-muted'
                    }`}
                  >
                    {t('credit.available')}
                  </Text>
                  <Text
                    className={`mt-1 font-sans-semibold text-[18px] ${
                      useCredit ? 'text-paper' : 'text-ink'
                    }`}
                  >
                    {t('credit.use', { amount: formatCents(availableCreditCents) })}
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

        {/* Mis puntos */}
        {claimableCents > 0 && (
          <View className="mb-8">
            <View className="mb-4 flex-row items-baseline gap-3">
              <Text className="font-sans-italic text-2xl text-brand">
                {fmtNo(pagoNo + (paymentMethod === 'digital' ? 3 : 2))}
              </Text>
              <Text className="font-sans text-[13px] uppercase tracking-eyebrow text-ink-muted">
                {t('points.title')}
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
                    className={`font-sans text-[12px] uppercase tracking-label ${
                      usePoints ? 'text-paper/70' : 'text-ink-muted'
                    }`}
                  >
                    {t('points.fullRedeem')}
                  </Text>
                  <Text
                    className={`mt-1 font-sans-semibold text-[18px] ${
                      usePoints ? 'text-paper' : 'text-ink'
                    }`}
                  >
                    {t('points.use', { amount: formatCents(claimableCents) })}
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
            <Text className="font-sans text-[13px] uppercase tracking-label text-ink-muted">
              {t('totals.subtotal')}
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
              <Text className="font-sans text-[13px] uppercase tracking-label text-brand">
                {t('totals.rentalFirstMonth')}
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
              <Text className="font-sans text-[13px] uppercase tracking-label text-brand">
                {t('totals.pointsDiscount')}
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
              <Text className="font-sans text-[13px] uppercase tracking-label text-brand">
                {t('totals.creditApplied')}
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
            <Text className="font-sans text-[13px] uppercase tracking-label text-ink-muted">
              {t('totals.shipping')}
            </Text>
            {allSkipQuote ? (
              <Text className="font-sans text-[14px] text-green-700">{t('totals.free')}</Text>
            ) : isActiveSubscriber ? (
              <Text className="font-sans text-[14px] text-green-700">
                {t('totals.freeWithSubscription')}
              </Text>
            ) : (
              <Text
                className="font-sans text-[14px] italic text-ink-muted"
                style={{ fontVariant: ['tabular-nums'] }}
              >
                {t('totals.toQuote')}
              </Text>
            )}
          </View>
          <View className="mb-3 flex-row items-baseline justify-between">
            <Text className="font-sans text-[13px] uppercase tracking-label text-ink-muted">
              {t('totals.taxes')}
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
                {t('totals.atQuote')}
              </Text>
            )}
          </View>
          {tipCents > 0 && (
            <View className="mb-3 flex-row items-baseline justify-between">
              <Text className="font-sans text-[13px] uppercase tracking-label text-ink-muted">
                {t('totals.tipLine', { percent: tipPercent })}
              </Text>
              <Text
                className="font-sans text-[14px] text-ink"
                style={{ fontVariant: ['tabular-nums'] }}
              >
                {formatCents(tipCents)}
              </Text>
            </View>
          )}
          <View className="flex-row items-baseline justify-between border-t border-ink pt-3">
            <Eyebrow tone="ink">
              {allSkipQuote
                ? t('totals.total')
                : tipCents > 0
                  ? t('totals.partialTotal')
                  : t('totals.subtotal')}
            </Eyebrow>
            <Text
              className="font-sans-semibold text-[36px] text-brand"
              style={{ fontVariant: ['tabular-nums'] }}
            >
              {formatCents(
                allSkipQuote ? skipQuoteTotalCents : previewTotalCents + tipCents,
              )}
            </Text>
          </View>
          <Text className="mt-3 font-sans text-[13px] text-ink-muted">
            {allSkipQuote ? t('totals.finalNote') : t('totals.quoteNote')}
          </Text>
        </View>

        {/* Monthly recurring disclosure — only for pure-rental carts */}
        {monthlyRecurringCents > 0 && !hasMixedCart && (
          <View className="mt-4 border border-brand/30 bg-brand-light/20 px-4 py-3">
            <Text className="font-sans text-[13px] uppercase tracking-label text-brand">
              {t('monthly.title')}
            </Text>
            <Text
              className="mt-1 font-sans-semibold text-[18px] text-brand"
              style={{ fontVariant: ['tabular-nums'] }}
            >
              {t('monthly.amountPerMonth', {
                amount: formatCents(monthlyRecurringCents),
              })}
            </Text>
            <Text className="mt-1 font-sans text-[13px] text-ink-muted">
              {t('monthly.note')}
            </Text>
          </View>
        )}

        {/* Mixed-cart error banner */}
        {hasMixedCart && (
          <View className="mt-4 border border-bad/30 bg-bad/5 px-4 py-3">
            <Text className="font-sans text-[13px] text-bad">
              {t('mixedCart.error')}
            </Text>
            <Text className="mt-1 font-sans text-[13px] text-ink-muted">
              {t('mixedCart.hint')}
            </Text>
          </View>
        )}

        {error && (
          <Text className="mt-4 font-sans text-[13px] uppercase tracking-label text-bad">
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
            {t('submit')}
          </Button>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}
