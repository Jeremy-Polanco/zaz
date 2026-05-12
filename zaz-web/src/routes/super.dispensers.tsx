import {
  createFileRoute,
  isRedirect,
  redirect,
} from '@tanstack/react-router'
import { useState } from 'react'
import { TOKEN_KEY, api } from '../lib/api'
import type { AuthUser, DelinquentSubscription } from '../lib/types'
import {
  useDelinquentSubscriptions,
  useChargeLateFee,
  useCancelSubscriptionAdmin,
} from '../lib/queries'
import { Button, SectionHeading } from '../components/ui'
import { formatCents } from '../lib/utils'

// ── Route definition ───────────────────────────────────────────────────────────

export const Route = createFileRoute('/super/dispensers')({
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
  component: SuperDispensersPage,
})

// ── Confirmation dialog ────────────────────────────────────────────────────────

type ActionType = 'charge' | 'chargeAndCancel' | 'cancel'

interface ConfirmState {
  type: ActionType
  subscriptionId: string
  userId: string
  userName: string
}

function actionLabel(type: ActionType): string {
  if (type === 'charge') return 'Cobrar late fee'
  if (type === 'chargeAndCancel') return 'Cobrar y cancelar'
  return 'Cancelar suscripción'
}

function actionDescription(type: ActionType, userName: string): string {
  if (type === 'charge') return `Cobrar cargo por mora a ${userName}. No cancelará la suscripción.`
  if (type === 'chargeAndCancel') return `Cobrar cargo por mora a ${userName} y cancelar su suscripción de alquiler.`
  return `Cancelar la suscripción de alquiler de ${userName}. Esta acción es irreversible.`
}

// ── Row component ──────────────────────────────────────────────────────────────

function DelinquentRow({
  sub,
  isAnyPending,
  onAction,
}: {
  sub: DelinquentSubscription
  isAnyPending: boolean
  onAction: (state: ConfirmState) => void
}) {
  return (
    <tr className="border-b border-ink/5">
      <td className="p-3">
        <p className="text-sm font-medium text-ink">{sub.userName}</p>
        <p className="text-[11px] text-ink-muted">{sub.userPhone ?? '—'}</p>
      </td>
      <td className="p-3">
        <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
          {sub.daysDelinquent} días
        </span>
      </td>
      <td className="p-3 tabular-nums text-sm text-ink">
        {formatCents(sub.rentalAmountCents)}/mes
      </td>
      <td className="p-3">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            disabled={isAnyPending}
            onClick={() => onAction({ type: 'charge', subscriptionId: sub.subscriptionId, userId: sub.userId, userName: sub.userName })}
            className="rounded-xs border border-ink/20 bg-paper px-3 py-1.5 text-[11px] font-medium text-ink hover:bg-ink/5 disabled:opacity-50"
          >
            Cobrar late fee
          </button>
          <button
            disabled={isAnyPending}
            onClick={() => onAction({ type: 'cancel', subscriptionId: sub.subscriptionId, userId: sub.userId, userName: sub.userName })}
            className="rounded-xs border border-red-200 bg-red-50 px-3 py-1.5 text-[11px] font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            disabled={isAnyPending}
            onClick={() => onAction({ type: 'chargeAndCancel', subscriptionId: sub.subscriptionId, userId: sub.userId, userName: sub.userName })}
            className="rounded-xs border border-orange-200 bg-orange-50 px-3 py-1.5 text-[11px] font-medium text-orange-700 hover:bg-orange-100 disabled:opacity-50"
          >
            Cobrar y cancelar
          </button>
        </div>
      </td>
    </tr>
  )
}

// ── Page component ─────────────────────────────────────────────────────────────

function SuperDispensersPage() {
  const { data: subs, isPending, isError } = useDelinquentSubscriptions()
  const chargeMut = useChargeLateFee()
  const cancelMut = useCancelSubscriptionAdmin()

  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const isAnyPending = chargeMut.isPending || cancelMut.isPending

  const handleAction = (state: ConfirmState) => {
    setConfirmState(state)
    setActionError(null)
  }

  const handleConfirm = () => {
    if (!confirmState) return
    const { type, subscriptionId, userId } = confirmState

    if (type === 'charge') {
      chargeMut.mutate(
        { subscriptionId, alsoCancel: false },
        {
          onSuccess: () => setConfirmState(null),
          onError: (err: unknown) => {
            const msg = (err as { message?: string })?.message ?? 'Error al cobrar late fee'
            setActionError(msg)
            setConfirmState(null)
          },
        },
      )
    } else if (type === 'chargeAndCancel') {
      chargeMut.mutate(
        { subscriptionId, alsoCancel: true },
        {
          onSuccess: () => setConfirmState(null),
          onError: (err: unknown) => {
            const msg = (err as { message?: string })?.message ?? 'Error al cobrar late fee'
            setActionError(msg)
            setConfirmState(null)
          },
        },
      )
    } else {
      cancelMut.mutate(
        { subscriptionId, userId },
        {
          onSuccess: () => setConfirmState(null),
          onError: (err: unknown) => {
            const msg = (err as { message?: string })?.message ?? 'Error al cancelar'
            setActionError(msg)
            setConfirmState(null)
          },
        },
      )
    }
  }

  if (isPending) {
    return (
      <div className="page-rise mx-auto max-w-5xl px-6 py-12">
        <div className="py-20 text-center">
          <span className="eyebrow">Cargando…</span>
        </div>
      </div>
    )
  }

  const items = subs ?? []

  return (
    <div className="page-rise mx-auto max-w-5xl px-6 py-12">
      <SectionHeading
        eyebrow="Super admin"
        title={
          <>
            Dispensers <span className="italic text-brand">morosos.</span>
          </>
        }
        subtitle="Clientes con alquiler de dispenser en mora. Puedes cobrar el cargo por mora, cancelar, o ambos."
      />

      {/* Confirmation modal */}
      {confirmState && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-sm"
        >
          <div className="mx-4 w-full max-w-md border border-ink/15 bg-paper p-6">
            <h2 className="eyebrow mb-2">{actionLabel(confirmState.type)}</h2>
            <p className="mb-6 text-sm text-ink-muted">
              {actionDescription(confirmState.type, confirmState.userName)}
            </p>
            <div className="flex items-center gap-3">
              <Button
                variant="danger"
                onClick={handleConfirm}
                disabled={isAnyPending}
              >
                {isAnyPending ? 'Procesando…' : 'Confirmar'}
              </Button>
              <Button
                variant="secondary"
                onClick={() => setConfirmState(null)}
                disabled={isAnyPending}
              >
                Cancelar
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Error banner */}
      {actionError && (
        <div
          role="alert"
          className="mb-6 rounded-xs border border-bad/30 bg-bad/5 px-4 py-3 text-sm text-bad"
        >
          {actionError}
        </div>
      )}

      {isError && (
        <div
          role="alert"
          className="mb-6 rounded-xs border border-bad/30 bg-bad/5 px-4 py-3 text-sm text-bad"
        >
          Error al cargar la lista de morosos.
        </div>
      )}

      {/* Table or empty state */}
      {items.length === 0 ? (
        <div className="py-20 text-center border border-ink/15 bg-paper">
          <p className="text-ink-muted">No hay clientes morosos</p>
        </div>
      ) : (
        <div className="border border-ink/15 bg-paper">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink/10">
                {['Cliente', 'Días en mora', 'Plan', 'Acciones'].map((h) => (
                  <th
                    key={h}
                    className="p-3 text-left text-[10px] uppercase tracking-wide text-ink-muted"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((sub) => (
                <DelinquentRow
                  key={sub.subscriptionId}
                  sub={sub}
                  isAnyPending={isAnyPending}
                  onAction={handleAction}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
