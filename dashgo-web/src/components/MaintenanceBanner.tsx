import { useMemo } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMyRentals, useProducts, useRequestMaintenance } from '../lib/queries'
import { Button } from './ui'

/** Whole days from now until `iso` (negative when overdue). */
function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000)
}

/**
 * Bebedero maintenance countdown, rendered below the header for clients.
 *
 * Counts down the 30-day window for the customer's most-due active rental that
 * tracks maintenance. When it expires it becomes an alert with a button that
 * creates the maintenance-service order. Renders nothing when there's no
 * maintenance-tracked rental.
 */
export function MaintenanceBanner() {
  const navigate = useNavigate()
  const { data: rentals } = useMyRentals()
  const { data: products } = useProducts()
  const requestMaintenance = useRequestMaintenance()

  const due = useMemo(() => {
    const tracked = (rentals ?? []).filter(
      (r) => r.status === 'active' && r.nextMaintenanceAt,
    )
    if (tracked.length === 0) return null
    return tracked.reduce((a, b) =>
      new Date(a.nextMaintenanceAt!).getTime() <=
      new Date(b.nextMaintenanceAt!).getTime()
        ? a
        : b,
    )
  }, [rentals])

  const maintenanceProduct = useMemo(
    () => (products ?? []).find((p) => p.isMaintenanceService && p.isAvailable),
    [products],
  )

  if (!due) return null

  const daysLeft = daysUntil(due.nextMaintenanceAt!)
  const overdue = daysLeft <= 0

  const onRequest = async () => {
    if (!maintenanceProduct) return
    try {
      const order = await requestMaintenance.mutateAsync(maintenanceProduct.id)
      navigate({ to: '/orders/$orderId', params: { orderId: order.id } })
    } catch {
      /* surfaced below via mutation state */
    }
  }

  const errorMessage =
    (
      requestMaintenance.error as
        | { response?: { data?: { message?: string } } }
        | null
        | undefined
    )?.response?.data?.message ?? 'No pudimos crear la orden. Intentá de nuevo.'

  return (
    <div className="mx-auto max-w-7xl px-6 pt-6">
      {overdue ? (
        <div className="border-l-4 border-bad bg-bad/5 p-5">
          <p className="display text-xl font-semibold text-ink">
            Mantenimiento del bebedero vencido
          </p>
          <p className="mt-2 text-sm text-ink-soft">
            {daysLeft === 0
              ? 'El mantenimiento vence hoy.'
              : `Venció hace ${Math.abs(daysLeft)} ${
                  Math.abs(daysLeft) === 1 ? 'día' : 'días'
                }.`}{' '}
            Solicitá la visita de mantenimiento del bebedero.
          </p>
          {maintenanceProduct ? (
            <Button
              variant="accent"
              size="lg"
              onClick={onRequest}
              disabled={requestMaintenance.isPending}
              className="mt-4"
            >
              {requestMaintenance.isPending
                ? 'Creando orden…'
                : 'Solicitar mantenimiento →'}
            </Button>
          ) : (
            <p className="mt-3 text-sm text-ink-muted">
              Contactá a soporte para agendar el mantenimiento.
            </p>
          )}
          {requestMaintenance.isError && (
            <p className="mt-3 text-sm text-bad">{errorMessage}</p>
          )}
        </div>
      ) : (
        <div className="border-l-4 border-ink bg-paper-deep/40 p-5">
          <p className="text-base font-semibold text-ink">
            Mantenimiento del bebedero
          </p>
          <p className="mt-1 text-sm text-ink-soft">
            Próximo mantenimiento en {daysLeft} {daysLeft === 1 ? 'día' : 'días'}.
          </p>
        </div>
      )}
    </div>
  )
}
