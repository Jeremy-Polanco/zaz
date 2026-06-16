import { createFileRoute, isRedirect, redirect } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { Button, SectionHeading } from '../components/ui'
import {
  useAdminRentals,
  useChargeLateFee,
  useChargeTheftFee,
  useCancelRental,
  useRetryRentalSetup,
  useResetMaintenance,
} from '../lib/queries'
import { TOKEN_KEY, api } from '../lib/api'
import type { AuthUser } from '../lib/types'
import type { AdminRentalResponse, RentalFilter, RentalStatus } from '../lib/types'
import { formatCents } from '../lib/utils'

// ── Route definition ───────────────────────────────────────────────────────────

export const Route = createFileRoute('/super/rentals')({
  beforeLoad: async () => {
    if (!localStorage.getItem(TOKEN_KEY)) {
      throw redirect({ to: '/login', search: { next: undefined, ref: undefined } })
    }
    try {
      const { data: me } = await api.get<AuthUser>('/auth/me')
      if (me.role !== 'super_admin_delivery') throw redirect({ to: '/' })
    } catch (e) {
      if (isRedirect(e)) throw e
      throw redirect({ to: '/login', search: { next: undefined, ref: undefined } })
    }
  },
  component: SuperRentalsPage,
})

// ── Constants ──────────────────────────────────────────────────────────────────

const STATUS_OPTIONS: { value: RentalStatus; label: string }[] = [
  { value: 'active', label: 'Activo' },
  { value: 'past_due', label: 'Atrasado' },
  { value: 'unpaid', label: 'Sin pagar' },
  { value: 'pending_setup', label: 'Setup pendiente' },
  { value: 'canceled', label: 'Cancelado' },
]

function statusBadge(status: RentalStatus): { label: string; cls: string } {
  switch (status) {
    case 'active':
      return { label: 'Activo', cls: 'border-ok/40 bg-ok/10 text-ok' }
    case 'past_due':
      return { label: 'Atrasado', cls: 'border-warn/40 bg-warn/10 text-warn' }
    case 'unpaid':
      return { label: 'Sin pagar', cls: 'border-bad/40 bg-bad/10 text-bad' }
    case 'pending_setup':
      return { label: 'Setup pendiente', cls: 'border-ink/20 bg-ink/5 text-ink-muted' }
    case 'canceled':
      return { label: 'Cancelado', cls: 'border-ink/15 bg-paper-deep text-ink-muted' }
  }
}

// ── Confirmation modal ─────────────────────────────────────────────────────────

type ModalAction = {
  type:
    | 'charge'
    | 'charge-cancel'
    | 'charge-theft'
    | 'charge-theft-cancel'
    | 'cancel'
    | 'retry'
    | 'reset-maintenance'
  rentalId: string
  label: string
}

function ConfirmModal({
  action,
  isPending,
  onConfirm,
  onClose,
}: {
  action: ModalAction
  isPending: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <button
        type="button"
        onClick={onClose}
        disabled={isPending}
        aria-label="Cerrar"
        className="absolute inset-0 cursor-default"
        style={{ background: 'rgba(26, 21, 48, 0.45)' }}
      />
      {/* Dialog */}
      <div
        role="dialog"
        aria-modal="true"
        className="relative z-10 w-full max-w-md bg-paper p-6"
        style={{ boxShadow: '0 8px 32px rgba(26, 21, 48, 0.18)' }}
      >
        <p className="mb-1 text-[0.65rem] uppercase tracking-[0.14em] text-ink-muted">
          Confirmar acción
        </p>
        <h2 className="display mb-4 text-lg font-semibold text-ink">
          {action.label}
        </h2>
        <p className="mb-6 text-sm text-ink-muted">
          Esta acción no se puede deshacer. ¿Querés continuar?
        </p>
        <div className="flex items-center justify-end gap-3">
          <Button variant="ghost" onClick={onClose} disabled={isPending}>
            Cancelar
          </Button>
          <Button variant="accent" onClick={onConfirm} disabled={isPending}>
            {isPending ? 'Procesando…' : 'Confirmar'}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── RentalRow ──────────────────────────────────────────────────────────────────

function RentalRow({
  rental,
  onAction,
}: {
  rental: AdminRentalResponse
  onAction: (action: ModalAction) => void
}) {
  const badge = statusBadge(rental.status)
  const canCharge =
    (['active', 'past_due', 'unpaid'] as RentalStatus[]).includes(rental.status) &&
    rental.lateFeeCents > 0
  const canChargeCancel =
    (['past_due', 'unpaid'] as RentalStatus[]).includes(rental.status) &&
    rental.lateFeeCents > 0
  // Theft fee: one-time, only while the contract is still open and not yet charged.
  const canChargeTheft =
    (['active', 'past_due', 'unpaid'] as RentalStatus[]).includes(rental.status) &&
    rental.theftFeeCents > 0 &&
    !rental.theftFeeChargedAt
  const canCancel = (['active', 'past_due', 'unpaid', 'pending_setup'] as RentalStatus[]).includes(
    rental.status,
  )
  const canRetry = rental.status === 'pending_setup'
  // Only bebederos that have a running maintenance timer can have it reset.
  const canResetMaintenance = !!rental.nextMaintenanceAt

  const periodEndStr = rental.currentPeriodEnd
    ? new Date(rental.currentPeriodEnd).toLocaleDateString('es', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : '—'

  return (
    <div className="flex flex-col gap-3 border border-ink/10 bg-paper p-4 sm:flex-row sm:items-center sm:justify-between">
      {/* Left: customer + product */}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="display font-semibold text-ink">{rental.userName}</span>
          {rental.userPhone ? (
            <span className="text-[0.65rem] text-ink-muted">{rental.userPhone}</span>
          ) : null}
          <span
            className={`inline-flex items-center border px-1.5 py-0.5 text-[0.6rem] font-medium uppercase tracking-[0.10em] ${badge.cls}`}
          >
            {badge.label}
          </span>
        </div>
        <div className="flex flex-wrap gap-3 text-[0.7rem] uppercase tracking-[0.12em] text-ink-muted">
          <span>{rental.productName}</span>
          <span>·</span>
          <span className="nums">{formatCents(rental.monthlyRentCents)}/mes</span>
          {rental.currentPeriodEnd ? (
            <>
              <span>·</span>
              <span>Período: {periodEndStr}</span>
            </>
          ) : null}
          {rental.daysDelinquent > 0 ? (
            <>
              <span>·</span>
              <span className="text-bad">{rental.daysDelinquent}d atrasado</span>
            </>
          ) : null}
        </div>
      </div>

      {/* Right: action buttons */}
      <div className="flex flex-wrap items-center gap-2">
        {canCharge ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              onAction({
                type: 'charge',
                rentalId: rental.id,
                label: `Cobrar multa de ${formatCents(rental.lateFeeCents)} a ${rental.userName}`,
              })
            }
          >
            Cobrar late fee
          </Button>
        ) : null}
        {canChargeCancel ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              onAction({
                type: 'charge-cancel',
                rentalId: rental.id,
                label: `Cobrar ${formatCents(rental.lateFeeCents)} y cancelar alquiler de ${rental.userName}`,
              })
            }
          >
            Cobrar y cancelar
          </Button>
        ) : null}
        {canChargeTheft ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              onAction({
                type: 'charge-theft-cancel',
                rentalId: rental.id,
                label: `Cobrar multa por robo de ${formatCents(rental.theftFeeCents)} y cancelar alquiler de ${rental.userName}`,
              })
            }
          >
            Cobrar robo
          </Button>
        ) : null}
        {canRetry ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              onAction({
                type: 'retry',
                rentalId: rental.id,
                label: `Reintentar setup para ${rental.userName} — ${rental.productName}`,
              })
            }
          >
            Reintentar setup
          </Button>
        ) : null}
        {canResetMaintenance ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              onAction({
                type: 'reset-maintenance',
                rentalId: rental.id,
                label: `Reiniciar el timer de mantenimiento a 90 días para ${rental.userName}`,
              })
            }
          >
            Reiniciar timer
          </Button>
        ) : null}
        {canCancel ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              onAction({
                type: 'cancel',
                rentalId: rental.id,
                label: `Cancelar alquiler de ${rental.userName} — ${rental.productName}`,
              })
            }
          >
            Cancelar
          </Button>
        ) : null}
      </div>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

function SuperRentalsPage() {
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [customerSearch, setCustomerSearch] = useState('')
  const [filters, setFilters] = useState<RentalFilter>({ page: 1, pageSize: 25 })
  const [pendingAction, setPendingAction] = useState<ModalAction | null>(null)

  const { data: rentals, isPending } = useAdminRentals(filters)
  const chargeMutation = useChargeLateFee()
  const theftMutation = useChargeTheftFee()
  const cancelMutation = useCancelRental()
  const retryMutation = useRetryRentalSetup()
  const resetMaintenanceMutation = useResetMaintenance()

  const isMutating =
    chargeMutation.isPending ||
    theftMutation.isPending ||
    cancelMutation.isPending ||
    retryMutation.isPending ||
    resetMaintenanceMutation.isPending

  // Summary computed from the already-fetched rentals — no extra request.
  const summary = useMemo(() => {
    const list = rentals ?? []
    const alDia = list.filter((r) => r.status === 'active')
    const debiendo = list.filter(
      (r) => r.status === 'past_due' || r.status === 'unpaid',
    )
    const rentAtRiskCents = debiendo.reduce(
      (sum, r) => sum + r.monthlyRentCents,
      0,
    )
    return {
      alDiaCount: alDia.length,
      debiendoCount: debiendo.length,
      rentAtRiskCents,
    }
  }, [rentals])

  const handleStatusChange = (value: string) => {
    setStatusFilter(value)
    setFilters((f) => ({ ...f, status: value ? [value] : undefined, page: 1 }))
  }

  const handleCustomerSearch = (value: string) => {
    setCustomerSearch(value)
    setFilters((f) => ({ ...f, userId: value || undefined, page: 1 }))
  }

  const handleConfirm = async () => {
    if (!pendingAction) return
    try {
      if (pendingAction.type === 'charge') {
        await chargeMutation.mutateAsync({ rentalId: pendingAction.rentalId, alsoCancel: false })
      } else if (pendingAction.type === 'charge-cancel') {
        await chargeMutation.mutateAsync({ rentalId: pendingAction.rentalId, alsoCancel: true })
      } else if (pendingAction.type === 'charge-theft') {
        await theftMutation.mutateAsync({ rentalId: pendingAction.rentalId, alsoCancel: false })
      } else if (pendingAction.type === 'charge-theft-cancel') {
        await theftMutation.mutateAsync({ rentalId: pendingAction.rentalId, alsoCancel: true })
      } else if (pendingAction.type === 'cancel') {
        await cancelMutation.mutateAsync(pendingAction.rentalId)
      } else if (pendingAction.type === 'retry') {
        await retryMutation.mutateAsync(pendingAction.rentalId)
      } else if (pendingAction.type === 'reset-maintenance') {
        await resetMaintenanceMutation.mutateAsync(pendingAction.rentalId)
      }
    } catch (e) {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'No se pudo completar la acción'
      alert(msg)
    } finally {
      setPendingAction(null)
    }
  }

  if (isPending) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-20 text-center">
        <span className="eyebrow">Cargando…</span>
      </div>
    )
  }

  return (
    <>
      <div className="page-rise mx-auto max-w-6xl px-6 py-12">
        <SectionHeading
          eyebrow="Panel · Alquileres"
          title={
            <>
              Alquileres <span className="italic text-brand">activos.</span>
            </>
          }
          subtitle={`${rentals?.length ?? 0} resultado${rentals?.length === 1 ? '' : 's'}.`}
        />

        {/* Summary — derived from the fetched rentals, no extra request */}
        <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="border border-ink/10 bg-paper p-4">
            <p className="text-[0.6rem] uppercase tracking-[0.14em] text-ink-muted">
              Al día
            </p>
            <p className="display nums mt-1 text-2xl font-semibold text-ok">
              {summary.alDiaCount}
            </p>
          </div>
          <div className="border border-ink/10 bg-paper p-4">
            <p className="text-[0.6rem] uppercase tracking-[0.14em] text-ink-muted">
              Debiendo
            </p>
            <p className="display nums mt-1 text-2xl font-semibold text-bad">
              {summary.debiendoCount}
            </p>
          </div>
          <div className="border border-ink/10 bg-paper p-4">
            <p className="text-[0.6rem] uppercase tracking-[0.14em] text-ink-muted">
              Renta mensual en riesgo
            </p>
            <p className="display nums mt-1 text-2xl font-semibold text-ink">
              {formatCents(summary.rentAtRiskCents)}
            </p>
          </div>
        </div>

        {/* Filter bar */}
        <div className="mb-6 flex flex-wrap items-center gap-3">
          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={(e) => handleStatusChange(e.target.value)}
            className="border border-ink/15 bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-brand"
            aria-label="Filtrar por estado"
          >
            <option value="">Todos los estados</option>
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          {/* Customer search */}
          <input
            type="text"
            value={customerSearch}
            onChange={(e) => handleCustomerSearch(e.target.value)}
            placeholder="Buscar cliente por nombre…"
            className="border border-ink/15 bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-brand"
          />

          {(statusFilter || customerSearch) ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setStatusFilter('')
                setCustomerSearch('')
                setFilters({ page: 1, pageSize: 25 })
              }}
            >
              Limpiar filtros
            </Button>
          ) : null}
        </div>

        {/* List */}
        {!rentals || rentals.length === 0 ? (
          <div className="flex flex-col items-center gap-4 border border-dashed border-ink/20 py-20 text-center">
            <span className="eyebrow">Sin resultados</span>
            <p className="display text-2xl text-ink-muted">
              No hay alquileres registrados
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {rentals.map((r) => (
              <RentalRow key={r.id} rental={r} onAction={setPendingAction} />
            ))}
          </div>
        )}
      </div>

      {/* Confirmation modal — rendered outside .page-rise to avoid transform containing-block */}
      {pendingAction ? (
        <ConfirmModal
          action={pendingAction}
          isPending={isMutating}
          onConfirm={handleConfirm}
          onClose={() => setPendingAction(null)}
        />
      ) : null}
    </>
  )
}
