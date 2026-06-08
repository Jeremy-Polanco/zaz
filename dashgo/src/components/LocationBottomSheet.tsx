import { useState } from 'react'
import {
  View,
  Text,
  TextInput,
  Modal,
  Pressable,
  ScrollView,
} from 'react-native'
import type { Order } from '../lib/types'
import {
  useCreateAddressForUser,
  useSetOrderDeliveryAddress,
} from '../lib/queries'
import { requestDeviceLocation, reverseGeocode } from '../lib/geo'
import { MapPicker } from './MapPicker'
import { Button, Eyebrow, FieldLabel } from './ui'

/**
 * Super-admin bottom sheet to pin an order's delivery location at delivery
 * time. The customer never enters an address — the colmado captures it here
 * (GPS or map), optionally saving it to the customer's address book.
 *
 * Mirrors the web OrderLocationDrawer behavior, styled after QuoteBottomSheet.
 */
export function LocationBottomSheet({
  order,
  onClose,
}: {
  order: Order
  onClose: () => void
}) {
  const setOrderLocation = useSetOrderDeliveryAddress()
  const createForUser = useCreateAddressForUser(order.customerId)

  const [text, setText] = useState(order.deliveryAddress?.text ?? '')
  const [pin, setPin] = useState<{ lat?: number; lng?: number }>({
    lat: order.deliveryAddress?.lat ?? undefined,
    lng: order.deliveryAddress?.lng ?? undefined,
  })
  const [locating, setLocating] = useState(false)
  const [saveToUser, setSaveToUser] = useState(false)
  const [saveLabel, setSaveLabel] = useState('')
  const [error, setError] = useState<string | null>(null)

  const hasCoords = typeof pin.lat === 'number' && typeof pin.lng === 'number'

  const handleUseMyLocation = async () => {
    setError(null)
    setLocating(true)
    try {
      const coords = await requestDeviceLocation()
      setPin({ lat: coords.lat, lng: coords.lng })
      try {
        const rev = await reverseGeocode(coords.lat, coords.lng)
        setText((prev) => prev || rev.text)
      } catch {
        setText(
          (prev) =>
            prev || `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`,
        )
      }
    } catch (e) {
      setError(
        (e as Error)?.message ?? 'No pudimos obtener tu ubicación',
      )
    } finally {
      setLocating(false)
    }
  }

  const save = async () => {
    setError(null)
    if (pin.lat === undefined || pin.lng === undefined) {
      setError('Marcá la ubicación (usá tu ubicación o el mapa)')
      return
    }
    if (saveToUser && !saveLabel.trim()) {
      setError('Ponle un nombre a la dirección para guardarla')
      return
    }
    try {
      await setOrderLocation.mutateAsync({
        id: order.id,
        text: text.trim(),
        lat: pin.lat,
        lng: pin.lng,
      })
      if (saveToUser && saveLabel.trim() && order.customerId) {
        try {
          await createForUser.mutateAsync({
            label: saveLabel.trim(),
            line1: text.trim() || saveLabel.trim(),
            lat: pin.lat,
            lng: pin.lng,
          })
        } catch {
          // Non-blocking: the order location was set regardless.
        }
      }
      onClose()
    } catch (err) {
      setError(
        (err as Error & { response?: { data?: { message?: string } } })
          ?.response?.data?.message ?? 'No pudimos fijar la ubicación',
      )
    }
  }

  return (
    <Modal
      visible
      animationType="slide"
      transparent
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
    >
      <Pressable className="flex-1 bg-ink/40" onPress={onClose}>
        <View className="flex-1" />
      </Pressable>
      <View
        className="absolute bottom-0 left-0 right-0 max-h-[88%] rounded-t-[20px] bg-paper px-6 pb-10 pt-6"
        style={{ shadowOpacity: 0.2, shadowRadius: 20 }}
      >
        <View className="mx-auto mb-5 h-1 w-12 rounded-full bg-ink/20" />
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <Eyebrow>Fijar ubicación</Eyebrow>
          <Text className="mt-2 font-sans-semibold text-[22px] text-ink">
            {order.customer?.fullName ?? 'Cliente'}
          </Text>
          <Text className="mt-1 font-sans text-[13px] text-ink-soft">
            {order.deliveryAddress?.text
              ? `Actual: ${order.deliveryAddress.text}`
              : 'Sin ubicación — fijala al llegar.'}
          </Text>

          <View className="mt-5">
            <FieldLabel>Dirección</FieldLabel>
            <TextInput
              className="h-11 border-b border-ink/25 pb-1 font-sans text-[16px] text-ink"
              placeholder="Calle, número, referencia…"
              placeholderTextColor="#6B6488"
              value={text}
              onChangeText={setText}
            />
          </View>

          <View className="mt-4 flex-row items-center justify-between">
            <Pressable
              onPress={handleUseMyLocation}
              disabled={locating}
              className="flex-row items-center border border-ink/20 bg-paper px-3 py-2 active:bg-paper-deep"
            >
              <Text className="font-sans text-[11px] uppercase tracking-label text-ink">
                {locating ? 'Ubicando…' : '📍 Usar mi ubicación'}
              </Text>
            </Pressable>
            {hasCoords ? (
              <Text
                className="font-sans text-[11px] uppercase tracking-label text-ink-muted"
                style={{ fontVariant: ['tabular-nums'] }}
              >
                {pin.lat!.toFixed(5)}, {pin.lng!.toFixed(5)}
              </Text>
            ) : (
              <Text className="font-sans text-[11px] uppercase tracking-label text-bad">
                Marcá la ubicación
              </Text>
            )}
          </View>

          <Text className="mb-2 mt-5 font-sans text-[11px] uppercase tracking-label text-ink-muted">
            Ajustá el pin en el mapa
          </Text>
          <MapPicker
            value={pin}
            onChange={({ lat, lng }) => {
              setPin({ lat, lng })
              setError(null)
            }}
          />

          <View className="mt-5">
            <Pressable
              onPress={() => {
                setSaveToUser((v) => !v)
                setError(null)
              }}
              className="flex-row items-center gap-3"
            >
              <View
                className={`h-5 w-5 items-center justify-center border ${
                  saveToUser ? 'border-accent bg-accent' : 'border-ink/30'
                }`}
              >
                {saveToUser && (
                  <Text className="font-sans-semibold text-[12px] text-brand-dark">
                    ✓
                  </Text>
                )}
              </View>
              <Text className="font-sans-medium text-[14px] text-ink">
                Guardar esta dirección al cliente
              </Text>
            </Pressable>
            {saveToUser && (
              <View className="mt-3">
                <FieldLabel>Nombre de la dirección</FieldLabel>
                <TextInput
                  className="h-11 border-b border-ink/25 pb-1 font-sans text-[16px] text-ink"
                  placeholder="Ej. Casa, Trabajo"
                  placeholderTextColor="#6B6488"
                  value={saveLabel}
                  onChangeText={setSaveLabel}
                />
              </View>
            )}
          </View>

          {error && (
            <Text className="mt-4 font-sans text-[11px] uppercase tracking-label text-bad">
              {error}
            </Text>
          )}

          <View className="mt-6 flex-row gap-3">
            <View className="flex-1">
              <Button
                variant="outline"
                size="lg"
                onPress={onClose}
                loading={setOrderLocation.isPending}
              >
                Cancelar
              </Button>
            </View>
            <View className="flex-1">
              <Button
                variant="accent"
                size="lg"
                onPress={save}
                loading={setOrderLocation.isPending}
                disabled={!hasCoords}
              >
                Guardar →
              </Button>
            </View>
          </View>
        </ScrollView>
      </View>
    </Modal>
  )
}
