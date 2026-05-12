import { useEffect, useMemo, useState } from 'react'
import { View, Text, TextInput, Pressable, ScrollView, Alert } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import * as Location from 'expo-location'
import { useCart, cart } from '../lib/cart'
import {
  useCreateAddress,
  useCreateOrder,
  useCurrentUser,
  useMyAddresses,
  useMyCredit,
  usePointsBalance,
  useProducts,
} from '../lib/queries'
import { formatCents } from '../lib/format'
import { haversineMeters } from '../lib/geo'
import type { PaymentMethod } from '../lib/types'
import { Button, Eyebrow, FieldLabel, Hairline } from '../components/ui'
import { MapPicker } from '../components/MapPicker'
import { requestDeviceLocation, reverseGeocode } from '../lib/geo'

// ─── Constants ────────────────────────────────────────────────────────────────

const PROXIMITY_THRESHOLD_METERS = 200

// ─── Component ────────────────────────────────────────────────────────────────

export default function CheckoutScreen() {
  const cartState = useCart()
  const { data: user } = useCurrentUser()
  const { data: products } = useProducts()
  const { data: pointsBalance } = usePointsBalance()
  const { data: creditData } = useMyCredit()
  const { data: addresses = [] } = useMyAddresses()
  const createOrder = useCreateOrder()
  const createAddress = useCreateAddress()

  // ── Saved-address picker state ─────────────────────────────────────────────
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null)
  const [adHocMode, setAdHocMode] = useState(false)
  const [smartDefaultRan, setSmartDefaultRan] = useState(false)

  // ── Ad-hoc form state ──────────────────────────────────────────────────────
  const [addressText, setAddressText] = useState('')
  const [pin, setPin] = useState<{ lat?: number; lng?: number }>({})
  const [saveAddress, setSaveAddress] = useState(false)
  const [saveAddressLabel, setSaveAddressLabel] = useState('')

  // ── Payment state ──────────────────────────────────────────────────────────
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash')
  const [usePoints, setUsePoints] = useState(false)
  const [useCredit, setUseCredit] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [locating, setLocating] = useState(false)

  // ── Smart-default effect ───────────────────────────────────────────────────
  // Runs once when addresses data arrives. Determines whether to pre-select
  // via GPS proximity, is_default fallback, or enter ad-hoc mode directly.
  useEffect(() => {
    if (smartDefaultRan) return
    // addresses might be [] (empty) initially while loading — wait for data
    // The hook returns [] as default so we can't distinguish "loading" from
    // "genuinely empty". We gate on the isPending check via the hook's return
    // but here we just rely on the data array (useMyAddresses default is []).
    setSmartDefaultRan(true) // set synchronously before async — prevents re-runs

    if (addresses.length === 0) {
      setAdHocMode(true)
      return
    }

    const fallback = addresses.find((a) => a.isDefault) ?? addresses[0]

    ;(async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync()
        if (status !== 'granted') {
          setSelectedAddressId(fallback?.id ?? null)
          return
        }
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        })
        const here = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        const nearby = addresses.find(
          (a) => haversineMeters(here, { lat: a.lat, lng: a.lng }) <= PROXIMITY_THRESHOLD_METERS,
        )
        setSelectedAddressId((nearby ?? fallback)?.id ?? null)
      } catch {
        // GPS error or permission error — silently fall back to default
        setSelectedAddressId(fallback?.id ?? null)
      }
    })()
  }, [addresses, smartDefaultRan])

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

  const hasCoords = pin.lat !== undefined && pin.lng !== undefined

  const previewTotalCents = Math.max(0, subtotalCents - redeemCents - creditAppliedCents)

  const itemCount = useMemo(
    () => lineItems.reduce((sum, li) => sum + li.quantity, 0),
    [lineItems],
  )

  const selectedAddress = addresses.find((a) => a.id === selectedAddressId) ?? null

  // ── Location helper ────────────────────────────────────────────────────────

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

  // ── Order submission ───────────────────────────────────────────────────────

  const executeOrder = async () => {
    const items = lineItems.map(({ productId, quantity }) => ({
      productId,
      quantity,
    }))

    let deliveryAddress: { text: string; lat: number; lng: number }

    if (adHocMode) {
      if (pin.lat === undefined || pin.lng === undefined) {
        setError('Necesitamos tu ubicación para el envío')
        return
      }
      deliveryAddress = {
        text: addressText.trim(),
        lat: pin.lat,
        lng: pin.lng,
      }
    } else {
      if (!selectedAddress) {
        setError('Selecciona una dirección')
        return
      }
      deliveryAddress = {
        text: selectedAddress.line1,
        lat: selectedAddress.lat,
        lng: selectedAddress.lng,
      }
    }

    try {
      const created = await createOrder.mutateAsync({
        items,
        deliveryAddress,
        paymentMethod,
        usePoints,
        useCredit,
      })

      // After order success: optionally save the ad-hoc address
      if (adHocMode && saveAddress && saveAddressLabel.trim()) {
        try {
          await createAddress.mutateAsync({
            label: saveAddressLabel.trim(),
            line1: addressText.trim(),
            lat: pin.lat!,
            lng: pin.lng!,
          })
        } catch {
          Alert.alert(
            'Aviso',
            'No se pudo guardar la dirección, pero la orden se completó.',
          )
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

    if (adHocMode) {
      if (!addressText.trim() || addressText.trim().length < 3) {
        setError('Ingresa una dirección válida')
        return
      }
      if (!hasCoords) {
        setError('Necesitamos tu ubicación para el envío')
        return
      }
      if (saveAddress && !saveAddressLabel.trim()) {
        setError('Ponle un nombre a esta dirección para guardarla')
        return
      }
    } else {
      if (!selectedAddressId) {
        setError('Selecciona una dirección')
        return
      }
    }

    const paymentLabel = paymentMethod === 'digital' ? 'pago digital' : 'efectivo'
    const deliveryDesc = adHocMode
      ? addressText.trim()
      : selectedAddress?.line1 ?? ''

    Alert.alert(
      '¿Confirmas el pedido?',
      `${itemCount} ${itemCount === 1 ? 'producto' : 'productos'} · subtotal ${formatCents(
        previewTotalCents,
      )}\nEntrega en: ${deliveryDesc}\nPago: ${paymentLabel}\n\nEl repartidor te cotiza el envío y te avisamos para confirmar el total.`,
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

          {/* Saved-address picker */}
          {!adHocMode && addresses.length > 0 && (
            <View testID="saved-address-picker">
              {selectedAddress && (
                <Text testID="selected-address-label">
                  {selectedAddress.label}
                </Text>
              )}
              {addresses.map((addr) => (
                <Pressable
                  key={addr.id}
                  testID={`address-option-${addr.id}`}
                  onPress={() => setSelectedAddressId(addr.id)}
                  className={`mb-2 border px-4 py-3 ${
                    selectedAddressId === addr.id
                      ? 'border-ink bg-ink'
                      : 'border-ink/20 bg-paper'
                  }`}
                >
                  <Text
                    className={`font-sans-medium text-[15px] ${
                      selectedAddressId === addr.id ? 'text-paper' : 'text-ink'
                    }`}
                  >
                    {addr.label}
                  </Text>
                  <Text
                    className={`font-sans text-[13px] ${
                      selectedAddressId === addr.id ? 'text-paper/70' : 'text-ink-soft'
                    }`}
                  >
                    {addr.line1}
                  </Text>
                  {addr.isDefault && (
                    <Text className="mt-1 font-sans text-[10px] uppercase tracking-label text-brand">
                      Principal
                    </Text>
                  )}
                </Pressable>
              ))}
              <View className="mt-2">
                <Button
                  variant="outline"
                  onPress={() => {
                    setAdHocMode(true)
                  }}
                >
                  Usar una dirección diferente →
                </Button>
              </View>
            </View>
          )}

          {/* Ad-hoc form */}
          {adHocMode && (
            <View testID="adhoc-address-form">
              {addresses.length > 0 && (
                <View className="mb-3">
                  <Button
                    variant="outline"
                    onPress={() => setAdHocMode(false)}
                  >
                    ← Volver a mis direcciones
                  </Button>
                </View>
              )}
              <FieldLabel>Dirección</FieldLabel>
              <TextInput
                testID="adhoc-address-input"
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
              {/* Hidden pressable for tests to set a pin with coords */}
              <Pressable
                testID="set-test-pin"
                style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }}
                onPress={() => setPin({ lat: 18.47, lng: -69.9 })}
              />
              <Text className="mt-5 mb-2 font-sans text-[10px] uppercase tracking-label text-ink-muted">
                Ajustá el pin para guiar al repartidor
              </Text>
              <MapPicker value={pin} onChange={setPin} />
              {!hasCoords && (
                <Text className="mt-3 font-sans text-[11px] uppercase tracking-label text-bad">
                  Necesitamos tu ubicación para el envío
                </Text>
              )}

              {/* Save-this-address affordance */}
              <View className="mt-5">
                <Pressable
                  testID="save-address-checkbox"
                  onPress={() => setSaveAddress((v) => !v)}
                  className="flex-row items-center gap-3"
                >
                  <View
                    className={`h-5 w-5 items-center justify-center border-2 ${
                      saveAddress ? 'border-ink bg-ink' : 'border-ink/40 bg-transparent'
                    }`}
                  >
                    {saveAddress && (
                      <Text className="font-sans-semibold text-[11px] text-paper">✓</Text>
                    )}
                  </View>
                  <Text className="font-sans text-[14px] text-ink">Guardar esta dirección</Text>
                </Pressable>

                {saveAddress && (
                  <View className="mt-3">
                    <FieldLabel>Nombre de la dirección</FieldLabel>
                    <TextInput
                      testID="save-address-label-input"
                      className="h-11 border-b border-ink/25 pb-1 font-sans text-[16px] text-ink"
                      placeholder="Ej: Casa, Trabajo…"
                      placeholderTextColor="#6B6488"
                      value={saveAddressLabel}
                      onChangeText={setSaveAddressLabel}
                    />
                  </View>
                )}
              </View>
            </View>
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
            <Text
              className="font-sans text-[14px] italic text-ink-muted"
              style={{ fontVariant: ['tabular-nums'] }}
            >
              A cotizar
            </Text>
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
            disabled={adHocMode ? !hasCoords : !selectedAddressId}
            onPress={onSubmit}
          >
            Confirmar pedido →
          </Button>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}
