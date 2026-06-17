import { useEffect } from 'react'
import type { Order } from '../lib/types'
import { addressDetailParts } from '../lib/address'
import { Button } from './ui'

/**
 * Read-only modal showing the full delivery-address breakdown for an order:
 * the free-text line, the structured fields (house number, building, apto/piso,
 * reference) via addressDetailParts(), and a Maps link when coordinates exist.
 * "Editar" hands off to the OrderLocationDrawer through onEdit.
 */
export function OrderAddressModal({
  order,
  onClose,
  onEdit,
}: {
  order: Order
  onClose: () => void
  onEdit?: () => void
}) {
  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const addr = order.deliveryAddress
  const parts = addressDetailParts(addr)
  const hasCoords =
    typeof addr?.lat === 'number' && typeof addr?.lng === 'number'
  const mapsHref = hasCoords
    ? `https://www.google.com/maps/search/?api=1&query=${addr!.lat},${addr!.lng}`
    : null

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="order-address-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-t-sm border border-ink/15 bg-paper p-6 shadow-paper sm:rounded-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="eyebrow">Dirección de entrega</span>
        <h2
          id="order-address-title"
          className="display mt-3 text-3xl font-semibold leading-[1.05] text-ink"
        >
          {order.customer?.fullName ?? 'Cliente'}
        </h2>

        {addr ? (
          <>
            {addr.text?.trim() ? (
              <p className="mt-4 text-sm leading-relaxed text-ink-soft">
                {addr.text}
              </p>
            ) : null}

            {parts.length > 0 ? (
              <dl className="mt-5 divide-y divide-ink/10 border-t border-ink/10">
                {parts.map((part) => (
                  <div
                    key={part.label}
                    className="flex items-baseline justify-between gap-4 py-2.5"
                  >
                    <dt className="text-[0.7rem] uppercase tracking-[0.12em] text-ink-muted">
                      {part.label}
                    </dt>
                    <dd className="text-right text-sm font-medium text-ink">
                      {part.value}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}

            {mapsHref ? (
              <a
                href={mapsHref}
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-block text-[0.7rem] uppercase tracking-[0.12em] text-brand hover:underline"
              >
                📍 Ver en Maps
              </a>
            ) : null}
          </>
        ) : (
          <p className="mt-4 text-sm leading-relaxed text-ink-muted">
            Sin ubicación aún — fijala al llegar.
          </p>
        )}

        <div className="mt-6 flex items-center gap-3">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cerrar
          </Button>
          {onEdit ? (
            <Button type="button" variant="accent" onClick={onEdit}>
              Editar ubicación →
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
