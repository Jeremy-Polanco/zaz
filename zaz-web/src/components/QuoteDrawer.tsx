import { useEffect, useState } from 'react'
import type { Order } from '../lib/types'
import { useSetOrderQuote } from '../lib/queries'
import { computeQuotePreviewCents } from '../lib/tax'
import { formatCents } from '../lib/utils'
import { Button, FieldError, Input, Label } from './ui'
import { SavedAddressesList } from './SavedAddressesList'

function mapsDeepLink(order: Order): string {
  const addr = order.deliveryAddress
  const hasCoords = typeof addr.lat === 'number' && typeof addr.lng === 'number'
  return hasCoords
    ? `https://www.google.com/maps/dir/?api=1&destination=${addr.lat},${addr.lng}`
    : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(addr.text)}`
}

function wazeDeepLink(order: Order): string {
  const addr = order.deliveryAddress
  const hasCoords = typeof addr.lat === 'number' && typeof addr.lng === 'number'
  return hasCoords
    ? `https://waze.com/ul?ll=${addr.lat},${addr.lng}&navigate=yes`
    : `https://waze.com/ul?q=${encodeURIComponent(addr.text)}&navigate=yes`
}

export function QuoteDrawer({
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

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const parsed = parseFloat(shippingDollars)
  const shippingCents = Number.isFinite(parsed) ? Math.round(parsed * 100) : 0
  const subtotalCents = Math.round(parseFloat(order.subtotal) * 100)
  const pointsRedeemedCents = Math.round(parseFloat(order.pointsRedeemed) * 100)
  const preview = computeQuotePreviewCents({
    subtotalCents,
    shippingCents,
    pointsRedeemedCents,
  })

  const submit = async () => {
    setFormError(null)
    if (!Number.isFinite(parsed) || parsed < 0) {
      setFormError('Poné un monto válido (en dólares, ej. 5.50)')
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
    <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-ink/40">
      <button
        type="button"
        aria-label="Cerrar"
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default"
      />
      <aside className="relative z-10 flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-ink/15 bg-paper p-8">
        <header className="mb-6">
          <span className="eyebrow">Cotizar envío</span>
          <h2 className="display mt-2 text-3xl font-semibold leading-[1] tracking-[-0.02em]">
            {order.customer?.fullName ?? 'Cliente'}
          </h2>
          <p className="mt-2 text-sm text-ink-soft">
            {order.deliveryAddress.text}
          </p>
        </header>

        <div className="mb-6 flex gap-2">
          <a
            href={mapsDeepLink(order)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center border border-ink/20 bg-paper px-3 py-1.5 text-[0.7rem] uppercase tracking-[0.14em] text-ink hover:border-brand hover:text-brand"
          >
            Maps ↗
          </a>
          <a
            href={wazeDeepLink(order)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center border border-ink/20 bg-paper px-3 py-1.5 text-[0.7rem] uppercase tracking-[0.14em] text-ink hover:border-brand hover:text-brand"
          >
            Waze ↗
          </a>
        </div>

        <div className="mb-6 space-y-1 border-y border-ink/10 py-4 text-sm">
          <div className="flex justify-between">
            <span className="text-ink-muted">Subtotal</span>
            <span className="nums">{formatCents(subtotalCents)}</span>
          </div>
          {pointsRedeemedCents > 0 && (
            <div className="flex justify-between">
              <span className="text-brand">Puntos</span>
              <span className="nums text-brand">
                −{formatCents(pointsRedeemedCents)}
              </span>
            </div>
          )}
        </div>

        <div className="mb-4">
          <Label htmlFor="shippingDollars">Envío (USD)</Label>
          <Input
            id="shippingDollars"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            autoFocus
            placeholder="5.50"
            value={shippingDollars}
            onChange={(e) => setShippingDollars(e.target.value)}
          />
          <FieldError message={formError ?? undefined} />
        </div>

        <div className="mb-8 space-y-1 border-t border-ink/10 pt-4 text-sm">
          <div className="flex justify-between">
            <span className="text-ink-muted">Impuestos (8.887%)</span>
            <span className="nums">{formatCents(preview.taxCents)}</span>
          </div>
          <div className="flex items-baseline justify-between border-t-2 border-ink pt-3 mt-3">
            <span className="eyebrow">Total</span>
            <span className="display nums text-2xl font-semibold text-brand">
              {formatCents(preview.totalCents)}
            </span>
          </div>
        </div>

        <section className="mb-8 border-t border-ink/15 pt-6">
          <h3 className="eyebrow mb-3">Direcciones guardadas del cliente</h3>
          <SavedAddressesList userId={order.customerId} />
        </section>

        <div className="mt-auto flex gap-3">
          <Button
            variant="secondary"
            size="lg"
            onClick={onClose}
            disabled={setQuote.isPending}
            className="flex-1"
          >
            Cancelar
          </Button>
          <Button
            variant="accent"
            size="lg"
            onClick={submit}
            disabled={setQuote.isPending}
            className="flex-1"
          >
            {setQuote.isPending ? 'Enviando…' : 'Enviar cotización →'}
          </Button>
        </div>
      </aside>
    </div>
  )
}
