import { useState } from 'react'
import { View, Text, TextInput, Pressable, ActivityIndicator } from 'react-native'
import type { UserAddress } from '../lib/types'
import {
  useSuperUserAddresses,
  useSetDefaultAddressForUser,
  useDeleteAddressForUser,
  useUpdateAddressForUser,
} from '../lib/queries'
import { FieldLabel } from './ui'

type EditForm = {
  label: string
  line1: string
  line2: string
  building: string
  instructions: string
}

function toForm(a: UserAddress): EditForm {
  return {
    label: a.label,
    line1: a.line1,
    line2: a.line2 ?? '',
    building: a.building ?? '',
    instructions: a.instructions ?? '',
  }
}

const inputCls =
  'h-10 border-b border-ink/25 pb-1 font-sans text-[15px] text-ink'

/**
 * Super-admin panel to view and manage one customer's saved addresses:
 * set-default, edit the text fields, and delete. New locations (with coords)
 * are captured through the order's "Fijar ubicación" flow — the first one
 * auto-saves here. Mirrors the web UserAddressesPanel.
 */
export function UserAddressesPanel({ userId }: { userId: string }) {
  const { data: addresses, isPending } = useSuperUserAddresses(userId)
  const setDefault = useSetDefaultAddressForUser(userId)
  const del = useDeleteAddressForUser(userId)
  const update = useUpdateAddressForUser(userId)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<EditForm | null>(null)

  if (isPending) {
    return (
      <View className="py-3">
        <ActivityIndicator color="#1A1530" size="small" />
      </View>
    )
  }

  if (!addresses || addresses.length === 0) {
    return (
      <Text className="py-2 font-sans text-[13px] text-ink-muted">
        Sin direcciones guardadas. La primera se guarda automáticamente al fijar
        la ubicación de un pedido.
      </Text>
    )
  }

  const startEdit = (a: UserAddress) => {
    setEditingId(a.id)
    setForm(toForm(a))
  }
  const cancelEdit = () => {
    setEditingId(null)
    setForm(null)
  }
  const saveEdit = async (id: string) => {
    if (!form) return
    await update.mutateAsync({
      id,
      label: form.label.trim(),
      line1: form.line1.trim(),
      line2: form.line2.trim() || undefined,
      building: form.building.trim() || undefined,
      instructions: form.instructions.trim() || undefined,
    })
    cancelEdit()
  }

  return (
    <View className="gap-3 pb-2">
      {addresses.map((a) =>
        editingId === a.id && form ? (
          <View key={a.id} className="border border-ink/15 p-3" testID={`edit-${a.id}`}>
            <FieldLabel>Etiqueta</FieldLabel>
            <TextInput
              className={inputCls}
              value={form.label}
              onChangeText={(v) => setForm({ ...form, label: v })}
            />
            <View className="mt-3">
              <FieldLabel>Dirección</FieldLabel>
              <TextInput
                className={inputCls}
                value={form.line1}
                onChangeText={(v) => setForm({ ...form, line1: v })}
              />
            </View>
            <View className="mt-3 flex-row gap-3">
              <View className="flex-1">
                <FieldLabel>Apto / Piso</FieldLabel>
                <TextInput
                  className={inputCls}
                  value={form.line2}
                  onChangeText={(v) => setForm({ ...form, line2: v })}
                />
              </View>
              <View className="flex-1">
                <FieldLabel>Edificio</FieldLabel>
                <TextInput
                  className={inputCls}
                  value={form.building}
                  onChangeText={(v) => setForm({ ...form, building: v })}
                />
              </View>
            </View>
            <View className="mt-3">
              <FieldLabel>Referencia</FieldLabel>
              <TextInput
                className={inputCls}
                value={form.instructions}
                onChangeText={(v) => setForm({ ...form, instructions: v })}
              />
            </View>
            <View className="mt-4 flex-row gap-3">
              <Pressable
                onPress={() => saveEdit(a.id)}
                disabled={update.isPending}
                className="flex-1 items-center justify-center bg-accent py-2.5 active:opacity-80"
              >
                <Text className="font-sans-medium text-[11px] uppercase tracking-label text-brand-dark">
                  {update.isPending ? 'Guardando…' : 'Guardar'}
                </Text>
              </Pressable>
              <Pressable
                onPress={cancelEdit}
                className="flex-1 items-center justify-center border border-ink/25 py-2.5 active:bg-paper-deep"
              >
                <Text className="font-sans-medium text-[11px] uppercase tracking-label text-ink">
                  Cancelar
                </Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View key={a.id} className="border border-ink/15 p-3" testID={`addr-${a.id}`}>
            <View className="flex-row items-center gap-2">
              <Text className="font-sans-semibold text-[15px] text-ink">
                {a.label}
              </Text>
              {a.isDefault && (
                <Text className="font-sans text-[10px] uppercase tracking-label text-brand">
                  Predeterminada
                </Text>
              )}
            </View>
            <Text className="mt-0.5 font-sans text-[13px] text-ink-soft">
              {a.line1}
              {a.line2 ? `, ${a.line2}` : ''}
            </Text>
            {a.building ? (
              <Text className="font-sans text-[12px] text-ink-muted">
                {a.building}
              </Text>
            ) : null}
            {a.instructions ? (
              <Text className="font-sans text-[12px] text-ink-muted">
                {a.instructions}
              </Text>
            ) : null}
            <View className="mt-3 flex-row flex-wrap gap-4">
              {!a.isDefault && (
                <Pressable
                  onPress={() => setDefault.mutate(a.id)}
                  disabled={setDefault.isPending}
                >
                  <Text className="font-sans text-[11px] uppercase tracking-label text-brand">
                    Hacer predeterminada
                  </Text>
                </Pressable>
              )}
              <Pressable onPress={() => startEdit(a)}>
                <Text className="font-sans text-[11px] uppercase tracking-label text-ink-muted">
                  Editar
                </Text>
              </Pressable>
              <Pressable onPress={() => del.mutate(a.id)} disabled={del.isPending}>
                <Text className="font-sans text-[11px] uppercase tracking-label text-bad">
                  Eliminar
                </Text>
              </Pressable>
            </View>
          </View>
        ),
      )}
    </View>
  )
}
