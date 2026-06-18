import { useState } from 'react'
import type { UserAddress } from '../lib/types'
import {
  useSuperUserAddresses,
  useSetDefaultAddressForUser,
  useDeleteAddressForUser,
  useUpdateAddressForUser,
} from '../lib/queries'
import { Button, Input, Label } from './ui'

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

/**
 * Super-admin panel to view and manage a single customer's saved addresses:
 * set-default, edit the text fields, and delete. New locations are captured
 * (with coordinates) through the order's "Fijar ubicación" flow — the first one
 * auto-saves here — so this panel intentionally edits, not pins on a map.
 */
export function UserAddressesPanel({ userId }: { userId: string }) {
  const { data: addresses, isLoading } = useSuperUserAddresses(userId)
  const setDefault = useSetDefaultAddressForUser(userId)
  const del = useDeleteAddressForUser(userId)
  const update = useUpdateAddressForUser(userId)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<EditForm | null>(null)

  if (isLoading) {
    return <p className="text-sm text-ink-muted">Cargando direcciones…</p>
  }

  if (!addresses || addresses.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        Sin direcciones guardadas. La primera se guarda automáticamente al fijar
        la ubicación de un pedido.
      </p>
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
      input: {
        label: form.label.trim(),
        line1: form.line1.trim(),
        line2: form.line2.trim() || undefined,
        building: form.building.trim() || undefined,
        instructions: form.instructions.trim() || undefined,
      },
    })
    cancelEdit()
  }

  return (
    <ul className="space-y-3" data-testid="user-addresses">
      {addresses.map((a) => (
        <li key={a.id} className="border border-ink/15 p-3">
          {editingId === a.id && form ? (
            <div className="space-y-3">
              <div>
                <Label htmlFor={`lbl-${a.id}`}>Etiqueta</Label>
                <Input
                  id={`lbl-${a.id}`}
                  value={form.label}
                  onChange={(e) => setForm({ ...form, label: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor={`l1-${a.id}`}>Dirección</Label>
                <Input
                  id={`l1-${a.id}`}
                  value={form.line1}
                  onChange={(e) => setForm({ ...form, line1: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor={`l2-${a.id}`}>Apto / Piso</Label>
                  <Input
                    id={`l2-${a.id}`}
                    value={form.line2}
                    onChange={(e) => setForm({ ...form, line2: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor={`bld-${a.id}`}>Edificio</Label>
                  <Input
                    id={`bld-${a.id}`}
                    value={form.building}
                    onChange={(e) =>
                      setForm({ ...form, building: e.target.value })
                    }
                  />
                </div>
              </div>
              <div>
                <Label htmlFor={`ref-${a.id}`}>Referencia</Label>
                <Input
                  id={`ref-${a.id}`}
                  value={form.instructions}
                  onChange={(e) =>
                    setForm({ ...form, instructions: e.target.value })
                  }
                />
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="accent"
                  onClick={() => saveEdit(a.id)}
                  disabled={update.isPending}
                >
                  {update.isPending ? 'Guardando…' : 'Guardar'}
                </Button>
                <Button size="sm" variant="secondary" onClick={cancelEdit}>
                  Cancelar
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-ink">{a.label}</span>
                  {a.isDefault && (
                    <span className="text-[0.6rem] uppercase tracking-[0.12em] text-brand">
                      Predeterminada
                    </span>
                  )}
                </div>
                <p className="text-sm text-ink-soft">
                  {a.line1}
                  {a.line2 ? `, ${a.line2}` : ''}
                </p>
                {a.building && (
                  <p className="text-xs text-ink-muted">{a.building}</p>
                )}
                {a.instructions && (
                  <p className="text-xs text-ink-muted">{a.instructions}</p>
                )}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                {!a.isDefault && (
                  <button
                    type="button"
                    onClick={() => setDefault.mutate(a.id)}
                    disabled={setDefault.isPending}
                    className="text-[0.65rem] uppercase tracking-[0.12em] text-brand hover:underline"
                  >
                    Hacer predeterminada
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => startEdit(a)}
                  className="text-[0.65rem] uppercase tracking-[0.12em] text-ink-muted hover:text-brand"
                >
                  Editar
                </button>
                <button
                  type="button"
                  onClick={() => del.mutate(a.id)}
                  disabled={del.isPending}
                  className="text-[0.65rem] uppercase tracking-[0.12em] text-bad hover:underline"
                >
                  Eliminar
                </button>
              </div>
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}
