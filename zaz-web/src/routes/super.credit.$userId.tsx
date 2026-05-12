import { createFileRoute, isRedirect, redirect } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { z } from 'zod'
import {
  useAdminCreditAccount,
  useAdminCreditMovements,
  useAdminSubscriptionPlan,
  useAdjustCredit,
  useActivateAsRental,
  useActivateAsPurchase,
  useCancelSubscriptionAdmin,
  useGrantCredit,
  useManualAdjustment,
  useRecordPayment,
  useRefundCreditOrder,
  useUserSubscription,
} from '../lib/queries'
import { formatCents, formatDate } from '../lib/utils'
import { TOKEN_KEY, api } from '../lib/api'
import type { AuthUser, CreditMovement } from '../lib/types'
import { Button, FieldError, Input, Label, SectionHeading } from '../components/ui'

function dollarsToCents(value: string): number {
  const n = parseFloat(value)
  if (!Number.isFinite(n)) return NaN
  return Math.round(n * 100)
}

function defaultGrantDueDate(): string {
  const d = new Date()
  d.setMonth(d.getMonth() + 3)
  return d.toISOString().slice(0, 10)
}

export const Route = createFileRoute('/super/credit/$userId')({
  validateSearch: z.object({}),
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
  component: SuperCreditDetailPage,
})

function movementTypeLabel(type: string) {
  switch (type) {
    case 'grant': return 'Crédito otorgado'
    case 'charge': return 'Cargo'
    case 'reversal': return 'Reversión'
    case 'payment': return 'Pago'
    case 'adjustment': return 'Ajuste'
    case 'adjustment_increase': return 'Ajuste +'
    case 'adjustment_decrease': return 'Ajuste -'
    default: return type
  }
}

function amountColor(type: CreditMovement['type']): string {
  if (type === 'charge' || type === 'adjustment_decrease') return 'text-red-600'
  if (type === 'adjustment') return 'text-ink-muted'
  return 'text-green-700'
}

function amountSign(type: CreditMovement['type']): string {
  if (type === 'charge' || type === 'adjustment_decrease') return '−'
  if (type === 'adjustment') return '±'
  return '+'
}

function MovementRow({
  mv,
  userId,
  existingReversalOrderIds,
}: {
  mv: CreditMovement
  userId: string
  existingReversalOrderIds: Set<string>
}) {
  const [confirming, setConfirming] = useState(false)
  const refundMut = useRefundCreditOrder(userId, mv.orderId ?? '')

  const canRefund =
    mv.type === 'charge' &&
    mv.orderId != null &&
    !existingReversalOrderIds.has(mv.orderId)

  const handleRefundClick = () => setConfirming(true)
  const handleConfirm = () => {
    setConfirming(false)
    refundMut.mutate(undefined, {
      onError: (err: unknown) => {
        const status = (err as { response?: { status?: number } })?.response?.status
        if (status === 409) {
          alert('Ya fue reembolsado.')
        } else {
          alert('Error al procesar el reembolso. Intenta de nuevo.')
        }
      },
    })
  }
  const handleCancel = () => setConfirming(false)

  return (
    <tr className="border-b border-ink/5">
      <td className="p-3 text-[11px] text-ink-muted">{formatDate(mv.createdAt)}</td>
      <td className="p-3 text-sm">{movementTypeLabel(mv.type)}</td>
      <td className={`p-3 text-right tabular-nums text-sm font-medium ${amountColor(mv.type)}`}>
        {amountSign(mv.type)}{formatCents(mv.amountCents)}
      </td>
      <td className="p-3 text-[11px] text-ink-muted">{mv.orderId ? mv.orderId.slice(0, 8) + '…' : '—'}</td>
      <td className="p-3 text-[11px] text-ink-muted">{mv.note ?? '—'}</td>
      <td className="p-3">
        {canRefund && (
          confirming ? (
            <span className="inline-flex items-center gap-2">
              <button
                onClick={handleConfirm}
                disabled={refundMut.isPending}
                className="text-[11px] font-medium text-red-600 underline disabled:opacity-50"
              >
                {refundMut.isPending ? 'Procesando…' : 'Confirmar'}
              </button>
              <button
                onClick={handleCancel}
                className="text-[11px] text-ink-muted underline"
              >
                Cancelar
              </button>
            </span>
          ) : (
            <button
              onClick={handleRefundClick}
              className="text-[11px] text-brand underline hover:text-brand/80"
            >
              Reembolsar
            </button>
          )
        )}
      </td>
    </tr>
  )
}

// ── Dispenser section ──────────────────────────────────────────────────────────

type DispenserAction = 'rental' | 'purchase' | 'cancel'

function DispenserSection({ userId }: { userId: string }) {
  const { data: subData } = useUserSubscription(userId)
  const { data: plan } = useAdminSubscriptionPlan()
  const rentalMut = useActivateAsRental(userId)
  const purchaseMut = useActivateAsPurchase(userId)
  const cancelMut = useCancelSubscriptionAdmin()

  const [confirm, setConfirm] = useState<DispenserAction | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const subscription = subData?.subscription ?? null
  const hasPaymentMethod = subData?.hasPaymentMethod ?? false
  const purchasePriceConfigured = (plan?.purchasePriceCents ?? 0) > 0

  const canActivateRental = hasPaymentMethod
  const canActivatePurchase = hasPaymentMethod && purchasePriceConfigured

  const isNoSub = !subscription || subscription.status === 'canceled'
  const isRental = subscription != null && subscription.status !== 'canceled' && subscription.model === 'rental'
  const isPurchase = subscription != null && subscription.model === 'purchase'

  const isAnyPending = rentalMut.isPending || purchaseMut.isPending || cancelMut.isPending

  const handleConfirm = () => {
    setActionError(null)
    if (confirm === 'rental') {
      rentalMut.mutate(undefined, {
        onSuccess: () => setConfirm(null),
        onError: (err: unknown) => {
          setActionError((err as { message?: string })?.message ?? 'Error al activar alquiler')
          setConfirm(null)
        },
      })
    } else if (confirm === 'purchase') {
      purchaseMut.mutate(undefined, {
        onSuccess: () => setConfirm(null),
        onError: (err: unknown) => {
          setActionError((err as { message?: string })?.message ?? 'Error al activar compra')
          setConfirm(null)
        },
      })
    } else if (confirm === 'cancel' && subscription) {
      cancelMut.mutate(
        { subscriptionId: subscription.id, userId },
        {
          onSuccess: () => setConfirm(null),
          onError: (err: unknown) => {
            setActionError((err as { message?: string })?.message ?? 'Error al cancelar')
            setConfirm(null)
          },
        },
      )
    } else {
      setConfirm(null)
    }
  }

  return (
    <div className="mt-10 border border-ink/15 bg-paper p-6">
      <h2 className="eyebrow mb-4">Dispenser</h2>

      {/* Confirmation dialog */}
      {confirm && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-sm"
        >
          <div className="mx-4 w-full max-w-md border border-ink/15 bg-paper p-6">
            <h3 className="eyebrow mb-2">
              {confirm === 'rental' ? 'Activar como alquiler'
                : confirm === 'purchase' ? 'Activar como compra'
                : 'Cancelar suscripción'}
            </h3>
            <p className="mb-6 text-sm text-ink-muted">
              {confirm === 'rental' ? '¿Activar alquiler de dispenser para este cliente?'
                : confirm === 'purchase' ? '¿Registrar compra del dispenser para este cliente?'
                : '¿Cancelar el alquiler? Esta acción es irreversible.'}
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
                onClick={() => setConfirm(null)}
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
          className="mb-4 rounded-xs border border-bad/30 bg-bad/5 px-4 py-3 text-sm text-bad"
        >
          {actionError}
        </div>
      )}

      {/* State: no subscription */}
      {isNoSub && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-ink-muted">El cliente no tiene dispenser.</p>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex flex-col gap-1">
              <Button
                variant="primary"
                disabled={!canActivateRental || isAnyPending}
                onClick={() => setConfirm('rental')}
                size="sm"
              >
                Activar como alquiler
              </Button>
              {!hasPaymentMethod && (
                <p className="text-[11px] text-ink-muted">Cliente sin método de pago</p>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <Button
                variant="secondary"
                disabled={!canActivatePurchase || isAnyPending}
                onClick={() => setConfirm('purchase')}
                size="sm"
              >
                Activar como compra
              </Button>
              {!hasPaymentMethod && (
                <p className="text-[11px] text-ink-muted">Cliente sin método de pago</p>
              )}
              {hasPaymentMethod && !purchasePriceConfigured && (
                <p className="text-[11px] text-ink-muted">
                  Configura el precio en /super/subscription primero
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* State: active rental */}
      {isRental && subscription && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium uppercase tracking-wide text-green-700">
              Alquiler activo
            </span>
          </div>
          <p className="text-sm text-ink">
            Alquiler activo desde {formatDate(subscription.currentPeriodStart)}
          </p>
          <p className="text-sm text-ink-muted">
            Próximo cargo: {formatDate(subscription.currentPeriodEnd)}
          </p>
          <Button
            variant="danger"
            size="sm"
            onClick={() => setConfirm('cancel')}
            disabled={isAnyPending}
            className="w-fit"
          >
            Cancelar suscripción
          </Button>
        </div>
      )}

      {/* State: purchased */}
      {isPurchase && subscription && (
        <div className="flex flex-col gap-2">
          <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-medium uppercase tracking-wide text-blue-700 w-fit">
            Comprado
          </span>
          <p className="text-sm text-ink">
            Dispenser comprado el {formatDate(subscription.purchasedAt ?? subscription.currentPeriodStart)}
          </p>
        </div>
      )}
    </div>
  )
}

function SuperCreditDetailPage() {
  const { userId } = Route.useParams()
  const [page, setPage] = useState(1)

  const { data: detail, isPending } = useAdminCreditAccount(userId)
  const { data: movementsPage } = useAdminCreditMovements(userId, page, 50)
  const grantMut = useGrantCredit(userId)
  const paymentMut = useRecordPayment(userId)
  const adjustMut = useAdjustCredit(userId)
  const manualMut = useManualAdjustment(userId)

  const [grantAmount, setGrantAmount] = useState('')
  const [grantNote, setGrantNote] = useState('')
  const [grantDueDate, setGrantDueDate] = useState<string>(defaultGrantDueDate())
  const [grantError, setGrantError] = useState<string | null>(null)

  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentNote, setPaymentNote] = useState('')
  const [paymentError, setPaymentError] = useState<string | null>(null)

  const [newLimit, setNewLimit] = useState('')
  const [newDueDate, setNewDueDate] = useState('')
  const [adjustError, setAdjustError] = useState<string | null>(null)

  const [manualAmount, setManualAmount] = useState('')
  const [manualNote, setManualNote] = useState('')
  const [manualError, setManualError] = useState<string | null>(null)

  const submitGrant = (e: FormEvent) => {
    e.preventDefault()
    const cents = dollarsToCents(grantAmount)
    if (!cents || cents <= 0) {
      setGrantError('Monto inválido')
      return
    }
    setGrantError(null)
    grantMut.mutate(
      {
        amountCents: cents,
        note: grantNote || undefined,
        dueDate: grantDueDate || undefined,
      },
      {
        onSuccess: () => {
          setGrantAmount('')
          setGrantNote('')
          setGrantDueDate(defaultGrantDueDate())
        },
      },
    )
  }

  const submitPayment = (e: FormEvent) => {
    e.preventDefault()
    const cents = dollarsToCents(paymentAmount)
    if (!cents || cents <= 0) {
      setPaymentError('Monto inválido')
      return
    }
    setPaymentError(null)
    paymentMut.mutate(
      { amountCents: cents, note: paymentNote || undefined },
      {
        onSuccess: () => {
          setPaymentAmount('')
          setPaymentNote('')
        },
      },
    )
  }

  const submitAdjust = (e: FormEvent) => {
    e.preventDefault()
    let newLimitCents: number | undefined = undefined
    if (newLimit.trim()) {
      const c = dollarsToCents(newLimit)
      if (!Number.isFinite(c) || c < 0) {
        setAdjustError('Límite inválido')
        return
      }
      newLimitCents = c
    }
    setAdjustError(null)
    adjustMut.mutate({
      newLimitCents,
      dueDate: newDueDate || undefined,
    })
  }

  const submitManual = (e: FormEvent) => {
    e.preventDefault()
    const cents = dollarsToCents(manualAmount)
    if (!Number.isFinite(cents) || cents === 0) {
      setManualError('Monto inválido')
      return
    }
    if (!manualNote.trim()) {
      setManualError('La nota es requerida')
      return
    }
    setManualError(null)
    manualMut.mutate(
      { amountCents: cents, note: manualNote },
      {
        onSuccess: () => {
          setManualAmount('')
          setManualNote('')
        },
      },
    )
  }

  const account = detail?.account

  // Build a set of orderIds that already have a reversal movement, so the
  // refund button can hide itself for already-refunded charges.
  const existingReversalOrderIds = new Set<string>(
    (movementsPage?.items ?? [])
      .filter((mv) => mv.type === 'reversal' && mv.orderId != null)
      .map((mv) => mv.orderId as string),
  )

  const now = new Date()
  const isOverdue =
    account &&
    account.balanceCents < 0 &&
    account.dueDate !== null &&
    new Date(account.dueDate) < now

  if (isPending) {
    return (
      <div className="py-20 text-center">
        <span className="eyebrow">Cargando…</span>
      </div>
    )
  }

  return (
    <div className="page-rise mx-auto max-w-5xl px-6 py-12">
      {/* Header */}
      <div className="mb-8 flex items-start justify-between">
        <div>
          <SectionHeading
            eyebrow="Crédito fiado"
            title={account?.user?.fullName ?? userId}
          />
          <div className="mt-2 flex gap-3">
            <div className="border border-ink/15 bg-paper px-4 py-3">
              <p className="text-[10px] uppercase tracking-wide text-ink-muted">Balance</p>
              <p className={`text-2xl font-semibold tabular-nums ${account && account.balanceCents < 0 ? 'text-red-600' : 'text-ink'}`}>
                {formatCents(account?.balanceCents ?? 0)}
              </p>
            </div>
            <div className="border border-ink/15 bg-paper px-4 py-3">
              <p className="text-[10px] uppercase tracking-wide text-ink-muted">Límite</p>
              <p className="text-2xl font-semibold tabular-nums text-ink">
                {formatCents(account?.creditLimitCents ?? 0)}
              </p>
            </div>
            <div className="border border-ink/15 bg-paper px-4 py-3">
              <p className="text-[10px] uppercase tracking-wide text-ink-muted">Vencimiento</p>
              <p className="text-lg font-semibold text-ink">
                {account?.dueDate ? formatDate(account.dueDate) : '—'}
              </p>
            </div>
            <div className="flex items-center px-2">
              {isOverdue ? (
                <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-medium uppercase tracking-wide text-red-700">Vencido</span>
              ) : account && account.balanceCents < 0 ? (
                <span className="rounded-full bg-yellow-100 px-3 py-1 text-xs font-medium uppercase tracking-wide text-yellow-700">Al día</span>
              ) : (
                <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium uppercase tracking-wide text-green-700">Sin deuda</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Action panels */}
      <div className="mb-10 grid grid-cols-2 gap-4">
        {/* Grant credit */}
        <div className="border border-ink/15 bg-paper p-5">
          <h3 className="eyebrow mb-3">Otorgar crédito</h3>
          <form onSubmit={submitGrant} className="flex flex-col gap-3">
            <div>
              <Label>Monto (USD)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder="50"
                value={grantAmount}
                onChange={(e) => setGrantAmount(e.target.value)}
              />
              <FieldError message={grantError ?? undefined} />
            </div>
            <div>
              <Label>Vencimiento</Label>
              <Input
                type="date"
                value={grantDueDate}
                onChange={(e) => setGrantDueDate(e.target.value)}
              />
              <p className="mt-1 text-[10px] text-ink-muted">
                Solo se aplica en el primer otorgamiento. Para cambiarlo después,
                usa «Ajustar vencimiento».
              </p>
            </div>
            <div>
              <Label>Nota</Label>
              <Input
                value={grantNote}
                onChange={(e) => setGrantNote(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={grantMut.isPending}>Otorgar</Button>
          </form>
        </div>

        {/* Record payment */}
        <div className="border border-ink/15 bg-paper p-5">
          <h3 className="eyebrow mb-3">Registrar pago</h3>
          <form onSubmit={submitPayment} className="flex flex-col gap-3">
            <div>
              <Label>Monto (USD)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder="50"
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
              />
              <FieldError message={paymentError ?? undefined} />
            </div>
            <div>
              <Label>Nota</Label>
              <Input
                value={paymentNote}
                onChange={(e) => setPaymentNote(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={paymentMut.isPending}>Registrar</Button>
          </form>
        </div>

        {/* Adjust limit / due date */}
        <div className="border border-ink/15 bg-paper p-5">
          <h3 className="eyebrow mb-3">Ajustar límite / vencimiento</h3>
          <form onSubmit={submitAdjust} className="flex flex-col gap-3">
            <div>
              <Label>Nuevo límite (USD)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder="Dejar vacío para no cambiar"
                value={newLimit}
                onChange={(e) => setNewLimit(e.target.value)}
              />
              <FieldError message={adjustError ?? undefined} />
            </div>
            <div>
              <Label>Fecha vencimiento</Label>
              <Input
                type="date"
                value={newDueDate}
                onChange={(e) => setNewDueDate(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={adjustMut.isPending}>Guardar</Button>
          </form>
        </div>

        {/* Manual adjustment */}
        <div className="border border-ink/15 bg-paper p-5">
          <h3 className="eyebrow mb-3">Ajuste manual</h3>
          <form onSubmit={submitManual} className="flex flex-col gap-3">
            <div>
              <Label>Monto USD (+ suma, − resta)</Label>
              <Input
                type="number"
                step="0.01"
                placeholder="−10 o 20"
                value={manualAmount}
                onChange={(e) => setManualAmount(e.target.value)}
              />
            </div>
            <div>
              <Label>Nota (requerida)</Label>
              <Input
                value={manualNote}
                onChange={(e) => setManualNote(e.target.value)}
              />
              <FieldError message={manualError ?? undefined} />
            </div>
            <Button type="submit" disabled={manualMut.isPending}>Aplicar ajuste</Button>
          </form>
        </div>
      </div>

      {/* Movements table */}
      <div className="border border-ink/15 bg-paper">
        <div className="flex items-center justify-between border-b border-ink/10 px-4 py-3">
          <span className="eyebrow">Movimientos</span>
          <span className="text-[11px] text-ink-muted">{movementsPage?.totalCount ?? 0} total</span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ink/10">
              {['Fecha', 'Tipo', 'Monto', 'Pedido', 'Nota', ''].map((h) => (
                <th key={h} className="p-3 text-left text-[10px] uppercase tracking-wide text-ink-muted">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(movementsPage?.items ?? []).length === 0 ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-ink-muted">Sin movimientos</td>
              </tr>
            ) : (
              (movementsPage?.items ?? []).map((mv) => (
                <MovementRow
                  key={mv.id}
                  mv={mv}
                  userId={userId}
                  existingReversalOrderIds={existingReversalOrderIds}
                />
              ))
            )}
          </tbody>
        </table>
        {movementsPage && movementsPage.totalPages > 1 && (
          <div className="flex items-center justify-end gap-3 border-t border-ink/10 px-4 py-3">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="text-[11px] text-brand disabled:text-ink-muted"
            >
              Anterior
            </button>
            <span className="text-[11px] text-ink-muted">{page} / {movementsPage.totalPages}</span>
            <button
              disabled={page >= movementsPage.totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="text-[11px] text-brand disabled:text-ink-muted"
            >
              Siguiente
            </button>
          </div>
        )}
      </div>

      {/* Dispenser section */}
      <DispenserSection userId={userId} />
    </div>
  )
}

