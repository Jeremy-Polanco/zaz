import { useMemo } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMyRentals, useProducts, useRequestMaintenance } from '../lib/queries'
import { formatDeliveryDay } from '../lib/utils'
import { Button } from './ui'

/** Whole days from now until `iso` (negative when overdue). */
function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000)
}

/**
 * Bebedero maintenance countdown, rendered below the header for clients.
 *
 * Counts down the 90-day window for the customer's most-due active rental that
 * tracks maintenance. When it expires the SYSTEM creates the maintenance visit
 * by itself (MaintenanceCron), so while a visit is open the banner just tells
 * the customer which day it's scheduled for, with a link to the order — a calm
 * notice, not an alert. Only when there's no scheduled visit does an expired
 * countdown fall back to the alert with a button to request it manually.
 * Renders nothing when there's no maintenance-tracked rental.
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

  // Visita ya generada por el sistema: tiene prioridad sobre la cuenta
  // regresiva y sobre la alerta de vencido (pedir otra no tendría sentido).
  if (due.maintenanceOrderId && due.maintenanceScheduledFor) {
    const orderId = due.maintenanceOrderId
    return (
      <div className="mx-auto w-full max-w-6xl px-6 pt-6">
        <div className="border-l-4 border-ink bg-paper-deep/40 p-5">
          <p className="text-base font-semibold text-ink">
            Mantenimiento del bebedero
          </p>
          <p className="mt-1 text-sm font-semibold text-ink">
            Mantenimiento programado para el{' '}
            {formatDeliveryDay(due.maintenanceScheduledFor)}.
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              navigate({ to: '/orders/$orderId', params: { orderId } })
            }
            className="mt-3"
          >
            Ver pedido →
          </Button>
        </div>
      </div>
    )
  }

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

  // w-full defeats the flex-parent auto-margin shrink; max-w-6xl + px-6 match
  // the catalog products container so the banner lines up with it exactly.
  return (
    <div className="mx-auto w-full max-w-6xl px-6 pt-6">
      {overdue ? (
        <div className="border-l-4 border-bad bg-bad/5 p-5">
          <p className="display text-xl font-semibold text-ink">
            Mantenimiento del bebedero vencido
          </p>
          <p className="mt-2 text-sm text-ink-soft">
            {daysLeft === 0 ? (
              'El mantenimiento vence hoy.'
            ) : (
              <>
                Venció hace{' '}
                <span className="text-base font-semibold text-ink">
                  {Math.abs(daysLeft)}
                </span>{' '}
                {Math.abs(daysLeft) === 1 ? 'día' : 'días'}.
              </>
            )}{' '}
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
            Próximo mantenimiento en{' '}
            <span className="text-base font-semibold text-ink">{daysLeft}</span>{' '}
            {daysLeft === 1 ? 'día' : 'días'}.
          </p>
        </div>
      )}
    </div>
  )
}
