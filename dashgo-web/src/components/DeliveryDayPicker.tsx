import { useState } from 'react'
import { useSetDeliveryDate } from '../lib/queries'
import { isoDayFromDate } from '../lib/utils'

/** '2026-09-20' → '20/09' — compact for the Acciones column, unlike the long
 * "domingo 20 de septiembre" the Fecha column and the customer page use. */
function shortDay(isoDay: string): string {
  const [, month, day] = isoDay.split('-')
  return `${day}/${month}`
}

/**
 * Compact inline control for the "Acciones" column of the delivery-route
 * table: assigns or clears the day staff plans to deliver an order. Shown for
 * every status except delivered/cancelled (super.orders.tsx guards that).
 *
 * The API notifies the customer itself (push) when the day changes — this
 * component only fires the mutation and lets the cache invalidation refresh
 * the row.
 */
export function DeliveryDayPicker({
  orderId,
  scheduledDeliveryDate,
}: {
  orderId: string
  scheduledDeliveryDate: string | null | undefined
}) {
  const setDeliveryDate = useSetDeliveryDate()
  const [open, setOpen] = useState(false)
  const [day, setDay] = useState(scheduledDeliveryDate ?? '')
  const todayIsoDay = isoDayFromDate(new Date())

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setDay(scheduledDeliveryDate ?? '')
          setOpen(true)
        }}
        className="text-[0.65rem] uppercase tracking-[0.12em] text-brand hover:underline"
      >
        {scheduledDeliveryDate
          ? `📅 ${shortDay(scheduledDeliveryDate)}`
          : '📅 Asignar día'}
      </button>
    )
  }

  const save = async () => {
    await setDeliveryDate.mutateAsync({
      id: orderId,
      scheduledDeliveryDate: day === '' ? null : day,
    })
    setOpen(false)
  }

  const clear = async () => {
    await setDeliveryDate.mutateAsync({
      id: orderId,
      scheduledDeliveryDate: null,
    })
    setDay('')
    setOpen(false)
  }

  return (
    <div className="flex items-center gap-1.5">
      <input
        type="date"
        aria-label="Día de entrega"
        min={todayIsoDay}
        value={day}
        onChange={(e) => setDay(e.target.value)}
        className="h-7 rounded-xs border border-ink/20 bg-paper px-1 text-[0.7rem] text-ink focus:border-ink focus:outline-none"
      />
      <button
        type="button"
        onClick={save}
        disabled={setDeliveryDate.isPending}
        className="text-[0.65rem] uppercase tracking-[0.12em] text-brand hover:underline disabled:opacity-40"
      >
        Guardar
      </button>
      {scheduledDeliveryDate && (
        <button
          type="button"
          onClick={clear}
          disabled={setDeliveryDate.isPending}
          className="text-[0.65rem] uppercase tracking-[0.12em] text-ink-muted hover:text-bad disabled:opacity-40"
        >
          Quitar
        </button>
      )}
      <button
        type="button"
        onClick={() => setOpen(false)}
        aria-label="Cancelar"
        className="text-[0.65rem] text-ink-muted hover:underline"
      >
        ✕
      </button>
    </div>
  )
}
