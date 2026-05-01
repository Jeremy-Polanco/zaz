import { useState } from 'react'
import {
  View,
  Text,
  TextInput,
  Modal,
  Pressable,
  Linking,
  Alert,
} from 'react-native'
import type { Order } from '../lib/types'
import { useSetOrderQuote } from '../lib/queries'
import { computeQuotePreviewCents } from '../lib/tax'
import { formatCents } from '../lib/format'
import { Button, Eyebrow, FieldLabel } from './ui'

function openMaps(order: Order) {
  const addr = order.deliveryAddress
  const hasCoords =
    typeof addr.lat === 'number' && typeof addr.lng === 'number'
  const url = hasCoords
    ? `https://www.google.com/maps/dir/?api=1&destination=${addr.lat},${addr.lng}`
    : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(addr.text)}`
  Linking.openURL(url).catch(() => Alert.alert('No se pudo abrir Maps'))
}

function openWaze(order: Order) {
  const addr = order.deliveryAddress
  const hasCoords =
    typeof addr.lat === 'number' && typeof addr.lng === 'number'
  const url = hasCoords
    ? `https://waze.com/ul?ll=${addr.lat},${addr.lng}&navigate=yes`
    : `https://waze.com/ul?q=${encodeURIComponent(addr.text)}&navigate=yes`
  Linking.openURL(url).catch(() => Alert.alert('No se pudo abrir Waze'))
}

export function QuoteBottomSheet({
  order,
  onClose,
}: {
  order: Order
  onClose: () => void
}) {
  const setQuote = useSetOrderQuote()
  const [shippingDollars, setShippingDollars] = useState<string>(
    order.shipping && parseFloat(order.shipping) > 0 ? order.shipping : '',
  )
  const [formError, setFormError] = useState<string | null>(null)

  const parsed = parseFloat(shippingDollars)
  const shippingCents = Number.isFinite(parsed) ? Math.round(parsed * 100) : 0
  const subtotalCents = Math.round(parseFloat(order.subtotal) * 100)
  const pointsRedeemedCents = Math.round(
    parseFloat(order.pointsRedeemed) * 100,
  )
  const preview = computeQuotePreviewCents({
    subtotalCents,
    shippingCents,
    pointsRedeemedCents,
  })

  const submit = async () => {
    setFormError(null)
    if (!Number.isFinite(parsed) || parsed < 0) {
      setFormError('Poné un monto válido en dólares (ej. 5.50)')
      return
    }
    try {
      await setQuote.mutateAsync({ id: order.id, shippingCents })
      onClose()
    } catch (err) {
      setFormError(
        (err as Error & { response?: { data?: { message?: string } } })
          ?.response?.data?.message ?? 'No pudimos enviar la cotización',
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
        className="absolute bottom-0 left-0 right-0 rounded-t-[20px] bg-paper px-6 pb-10 pt-6"
        style={{ shadowOpacity: 0.2, shadowRadius: 20 }}
      >
        <View className="mx-auto mb-5 h-1 w-12 rounded-full bg-ink/20" />
        <Eyebrow>Cotizar envío</Eyebrow>
        <Text className="mt-2 font-sans-semibold text-[22px] text-ink">
          {order.customer?.fullName ?? 'Cliente'}
        </Text>
        <Text className="mt-1 font-sans text-[13px] text-ink-soft">
          {order.deliveryAddress.text}
        </Text>

        <View className="mt-4 flex-row gap-2">
          <Pressable
            onPress={() => openMaps(order)}
            className="flex-1 items-center border border-ink/20 bg-paper py-2 active:bg-paper-deep"
          >
            <Text className="font-sans text-[11px] uppercase tracking-label text-ink">
              Maps ↗
            </Text>
          </Pressable>
          <Pressable
            onPress={() => openWaze(order)}
            className="flex-1 items-center border border-ink/20 bg-paper py-2 active:bg-paper-deep"
          >
            <Text className="font-sans text-[11px] uppercase tracking-label text-ink">
              Waze ↗
            </Text>
          </Pressable>
        </View>

        <View className="mt-5 gap-1 border-y border-ink/10 py-3">
          <View className="flex-row justify-between">
            <Text className="font-sans text-[12px] uppercase tracking-label text-ink-muted">
              Subtotal
            </Text>
            <Text
              className="font-sans text-[13px] text-ink"
              style={{ fontVariant: ['tabular-nums'] }}
            >
              {formatCents(subtotalCents)}
            </Text>
          </View>
          {pointsRedeemedCents > 0 && (
            <View className="flex-row justify-between">
              <Text className="font-sans text-[12px] uppercase tracking-label text-brand">
                Puntos
              </Text>
              <Text
                className="font-sans text-[13px] text-brand"
                style={{ fontVariant: ['tabular-nums'] }}
              >
                −{formatCents(pointsRedeemedCents)}
              </Text>
            </View>
          )}
        </View>

        <View className="mt-4">
          <FieldLabel>Envío (USD)</FieldLabel>
          <TextInput
            className="h-11 border-b border-ink/25 pb-1 font-sans text-[18px] text-ink"
            keyboardType="decimal-pad"
            placeholder="5.50"
            placeholderTextColor="#6B6488"
            value={shippingDollars}
            onChangeText={setShippingDollars}
            autoFocus
          />
          {formError && (
            <Text className="mt-2 font-sans text-[11px] uppercase tracking-label text-bad">
              {formError}
            </Text>
          )}
        </View>

        <View className="mt-5 gap-1 border-t border-ink/10 pt-3">
          <View className="flex-row justify-between">
            <Text className="font-sans text-[12px] uppercase tracking-label text-ink-muted">
              Impuestos (8.887%)
            </Text>
            <Text
              className="font-sans text-[13px] text-ink"
              style={{ fontVariant: ['tabular-nums'] }}
            >
              {formatCents(preview.taxCents)}
            </Text>
          </View>
          <View className="mt-3 flex-row items-baseline justify-between border-t-2 border-ink pt-3">
            <Eyebrow tone="ink">Total</Eyebrow>
            <Text
              className="font-sans-semibold text-[24px] text-brand"
              style={{ fontVariant: ['tabular-nums'] }}
            >
              {formatCents(preview.totalCents)}
            </Text>
          </View>
        </View>

        <View className="mt-6 flex-row gap-3">
          <View className="flex-1">
            <Button
              variant="outline"
              size="lg"
              onPress={onClose}
              loading={setQuote.isPending}
            >
              Cancelar
            </Button>
          </View>
          <View className="flex-1">
            <Button
              variant="accent"
              size="lg"
              onPress={submit}
              loading={setQuote.isPending}
            >
              Enviar →
            </Button>
          </View>
        </View>
      </View>
    </Modal>
  )
}
