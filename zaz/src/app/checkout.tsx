import { useMemo, useState } from 'react'
import { View, Text, TextInput, Pressable, ScrollView, Alert } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { useCart, cart } from '../lib/cart'
import {
  useCreateOrder,
  useCurrentUser,
  useMyCredit,
  useMySubscription,
  usePointsBalance,
  useProducts,
  useUpdateMe,
} from '../lib/queries'
import { formatCents } from '../lib/format'
import type { PaymentMethod } from '../lib/types'
import { Button, Eyebrow, FieldLabel, Hairline } from '../components/ui'
import { MapPicker } from '../components/MapPicker'
import { requestDeviceLocation, reverseGeocode } from '../lib/geo'

export default function CheckoutScreen() {
  const cartState = useCart()
  const { data: user } = useCurrentUser()
  const { data: products } = useProducts()
  const { data: pointsBalance } = usePointsBalance()
  const { data: creditData } = useMyCredit()
  const { data: subscription } = useMySubscription()
  const createOrder = useCreateOrder()
  const updateMe = useUpdateMe()

  const [addressText, setAddressText] = useState(user?.addressDefault?.text ?? '')
  const [pin, setPin] = useState<{ lat?: number; lng?: number }>({
    lat: user?.addressDefault?.lat,
    lng: user?.addressDefault?.lng,
  })
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash')
  const [usePoints, setUsePoints] = useState(false)
  const [useCredit, setUseCredit] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [locating, setLocating] = useState(false)

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

  const claimableCents = pointsBalance?.claimableCents ?? 0
  const redeemCents = usePoints ? Math.min(claimableCents, subtotalCents) : 0

  // Credit available: only for CLIENT role with usable account
  const creditUsable =
    user?.role === 'client' &&
    creditData &&
    creditData.status !== 'none' &&
    creditData.status !== 'overdue' &&
    creditData.balanceCents !== null &&
    creditData.creditLimitCents !== null
  const availableCreditCents = creditUsable
    ? (creditData!.balanceCents! + creditData!.creditLimitCents!)
    : 0
  const creditAppliedCents = useCredit
    ? Math.min(availableCreditCents, Math.max(0, subtotalCents - redeemCents))
    : 0

  const hasCoords = pin.lat !== undefined && pin.lng !== undefined
  const isActiveSubscriber =
    subscription?.status === 'active' || subscription?.status === 'past_due'

  // Shipping + tax are now quoted by the super admin AFTER the order is placed.
  // The customer sees their subtotal (minus points/credit) as the preview; the
  // final total shows up on the order detail screen once the admin cotizes.
  const previewTotalCents = Math.max(0, subtotalCents - redeemCents - creditAppliedCents)

  const itemCount = useMemo(
    () => lineItems.reduce((sum, li) => sum + li.quantity, 0),
    [lineItems],
  )

  const handleUseMyLocation = async () => {
    setError(null)
    setLocating(true)
    try {
      const coords = await requestDeviceLocation()
      setPin({ lat: coords.lat, lng: coords.lng })
      try {
        const rev = await reverseGeocode(coords.lat, coords.lng)
        setAddressText(rev.text)
      } catch {
        setAddressText(`${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`)
      }
    } catch (e) {
      setError((e as Error).message ?? 'No pudimos obtener tu ubicación')
    } finally {
      setLocating(false)
    }
  }

  const executeOrder = async () => {
    const items = lineItems.map(({ productId, quantity }) => ({
      productId,
      quantity,
    }))
    if (pin.lat === undefined || pin.lng === undefined) {
      setError('Necesitamos tu ubicación para el envío')
      return
    }
    const deliveryAddress = {
      text: addressText.trim(),
      lat: pin.lat,
      lng: pin.lng,
    }

    const currentDefault = user?.addressDefault
    const addressChanged =
      !currentDefault ||
      currentDefault.text !== deliveryAddress.text ||
      currentDefault.lat !== deliveryAddress.lat ||
      currentDefault.lng !== deliveryAddress.lng
    if (addressChanged) {
      updateMe.mutate({ addressDefault: deliveryAddress })
    }

    try {
      const created = await createOrder.mutateAsync({
        items,
        deliveryAddress,
        paymentMethod,
        usePoints,
        useCredit,
      })
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
    if (!addressText.trim() || addressText.trim().length < 3) {
      setError('Ingresa una dirección válida')
      return
    }
    if (!hasCoords) {
      setError('Necesitamos tu ubicación para el envío')
      return
    }

    const paymentLabel = paymentMethod === 'digital' ? 'pago digital' : 'efectivo'

    Alert.alert(
      '¿Confirmas el pedido?',
      `${itemCount} ${itemCount === 1 ? 'producto' : 'productos'} · subtotal ${formatCents(
        previewTotalCents,
      )}\nEntrega en: ${addressText.trim()}\nPago: ${paymentLabel}\n\nEl repartidor te cotiza el envío y te avisamos para confirmar el total.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Sí, confirmar',
          style: 'default',
          onPress: () => {
            void executeOrder()
          },
        },
      ],
    )
  }

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

        {/* 02 · Entrega */}
        <View className="mb-10">
          <View className="mb-4 flex-row items-baseline gap-3">
            <Text className="font-sans-italic text-2xl text-brand">02</Text>
            <Text className="font-sans text-[11px] uppercase tracking-eyebrow text-ink-muted">
              Entrega
            </Text>
          </View>
          <FieldLabel>Dirección</FieldLabel>
          <TextInput
            className="h-11 border-b border-ink/25 pb-1 font-sans text-[16px] text-ink"
            placeholder="Calle, número, apartamento…"
            placeholderTextColor="#6B6488"
            value={addressText}
            onChangeText={setAddressText}
          />
          <View className="mt-3">
            <Button
              variant="outline"
              loading={locating}
              onPress={handleUseMyLocation}
            >
              📍 Usar mi ubicación actual
            </Button>
          </View>
          <Text className="mt-5 mb-2 font-sans text-[10px] uppercase tracking-label text-ink-muted">
            Ajustá el pin para guiar al repartidor
          </Text>
          <MapPicker value={pin} onChange={setPin} />
          {!hasCoords && (
            <Text className="mt-3 font-sans text-[11px] uppercase tracking-label text-bad">
              Necesitamos tu ubicación para el envío
            </Text>
          )}
        </View>

        {/* 03 · Pago */}
        <View className="mb-8">
          <View className="mb-4 flex-row items-baseline gap-3">
            <Text className="font-sans-italic text-2xl text-brand">03</Text>
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

        {/* 04 · Mi crédito */}
        {creditUsable && availableCreditCents > 0 && (
          <View className="mb-8">
            <View className="mb-4 flex-row items-baseline gap-3">
              <Text className="font-sans-italic text-2xl text-brand">04</Text>
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

        {claimableCents > 0 && (
          <View className="mb-8">
            <View className="mb-4 flex-row items-baseline gap-3">
              <Text className="font-sans-italic text-2xl text-brand">05</Text>
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
            {isActiveSubscriber ? (
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
            <Text
              className="font-sans text-[14px] italic text-ink-muted"
              style={{ fontVariant: ['tabular-nums'] }}
            >
              Al cotizar
            </Text>
          </View>
          <View className="flex-row items-baseline justify-between border-t border-ink pt-3">
            <Eyebrow tone="ink">Subtotal</Eyebrow>
            <Text
              className="font-sans-semibold text-[36px] text-brand"
              style={{ fontVariant: ['tabular-nums'] }}
            >
              {formatCents(previewTotalCents)}
            </Text>
          </View>
          <Text className="mt-3 font-sans text-[11px] text-ink-muted">
            El repartidor cotiza el envío y te avisamos para confirmar el total.
          </Text>
        </View>

        {error && (
          <Text className="mt-4 font-sans text-[11px] uppercase tracking-label text-bad">
            {error}
          </Text>
        )}

        <View className="mt-8">
          <Button
            variant="accent"
            size="lg"
            loading={createOrder.isPending}
            disabled={!hasCoords}
            onPress={onSubmit}
          >
            Confirmar pedido →
          </Button>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}
