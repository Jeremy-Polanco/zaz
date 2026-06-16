import { useMemo, useState } from 'react'
import { Modal, Pressable, ScrollView, Text, View } from 'react-native'
import { Eyebrow } from './ui'
import { useCurrentUser, useMyAddresses, useSetActiveLocation } from '../lib/queries'

/**
 * Repartidor location switcher (mobile).
 *
 * Lets a SUPER_ADMIN_DELIVERY driver with multiple saved locations choose which
 * one they're currently dispatching from. The selection sets `active_location_id`
 * on the server, which becomes the shipping origin (ShippingService.getOrigin).
 *
 * Renders nothing unless the user is a repartidor with 2+ locations — there's
 * nothing to choose with zero or one. Mirrors the web LocationSelector and the
 * backend resolution order (active → default → first).
 */
export function LocationSelector() {
  const { data: user } = useCurrentUser()
  const { data: addresses } = useMyAddresses()
  const setActive = useSetActiveLocation()
  const [open, setOpen] = useState(false)

  const currentId = useMemo(() => {
    if (!addresses || addresses.length === 0) return ''
    if (user?.activeLocationId && addresses.some((a) => a.id === user.activeLocationId)) {
      return user.activeLocationId
    }
    return (addresses.find((a) => a.isDefault) ?? addresses[0]).id
  }, [addresses, user?.activeLocationId])

  if (user?.role !== 'super_admin_delivery') return null
  if (!addresses || addresses.length < 2) return null

  const current = addresses.find((a) => a.id === currentId)

  const pick = (id: string) => {
    setOpen(false)
    if (id !== currentId) setActive.mutate(id)
  }

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        disabled={setActive.isPending}
        className="mt-4 flex-row items-center justify-between border border-ink/15 px-4 py-3"
        accessibilityRole="button"
        accessibilityLabel="Cambiar ubicación de despacho"
      >
        <View className="flex-1">
          <Eyebrow>Despacho desde</Eyebrow>
          <Text className="mt-1 font-sans-semibold text-[15px] text-ink" numberOfLines={1}>
            {setActive.isPending ? 'Cambiando…' : current?.label ?? 'Elegir ubicación'}
          </Text>
        </View>
        <Text className="ml-3 font-sans text-[18px] text-ink-soft">⌄</Text>
      </Pressable>

      <Modal
        visible={open}
        animationType="slide"
        transparent
        onRequestClose={() => setOpen(false)}
        presentationStyle="overFullScreen"
      >
        <Pressable className="flex-1 bg-ink/40" onPress={() => setOpen(false)}>
          <View className="flex-1" />
        </Pressable>
        <View
          className="absolute bottom-0 left-0 right-0 max-h-[80%] rounded-t-[20px] bg-paper px-6 pb-10 pt-6"
          style={{ shadowOpacity: 0.2, shadowRadius: 20 }}
        >
          <View className="mx-auto mb-5 h-1 w-12 rounded-full bg-ink/20" />
          <Eyebrow>Ubicación de despacho</Eyebrow>
          <Text className="mt-2 font-sans text-[13px] text-ink-soft">
            La ubicación activa define desde dónde se calcula el envío.
          </Text>

          <ScrollView className="mt-4" showsVerticalScrollIndicator={false}>
            {addresses.map((a) => {
              const active = a.id === currentId
              return (
                <Pressable
                  key={a.id}
                  onPress={() => pick(a.id)}
                  className={`flex-row items-center justify-between border-b border-ink/10 py-4 ${
                    active ? 'opacity-100' : 'opacity-80'
                  }`}
                >
                  <View className="flex-1 pr-3">
                    <Text className="font-sans-semibold text-[16px] text-ink" numberOfLines={1}>
                      {a.label}
                    </Text>
                    <Text className="mt-0.5 font-sans text-[13px] text-ink-soft" numberOfLines={1}>
                      {a.line1}
                    </Text>
                  </View>
                  {active ? (
                    <Text className="font-sans-semibold text-[15px] text-accent">●</Text>
                  ) : null}
                </Pressable>
              )
            })}
          </ScrollView>
        </View>
      </Modal>
    </>
  )
}
