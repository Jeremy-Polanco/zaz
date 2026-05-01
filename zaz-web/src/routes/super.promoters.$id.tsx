import { createFileRoute, isRedirect, Link, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { Button, SectionHeading, Textarea } from '../components/ui'
import {
  useCreatePayout,
  usePromoterDashboardAsAdmin,
  usePromoterPayouts,
} from '../lib/queries'
import type {
  AuthUser,
  PromoterCommissionEntry,
  Payout,
  ReferredCustomerSummary,
} from '../lib/types'
import { TOKEN_KEY, api } from '../lib/api'
import { formatCents, formatDate } from '../lib/utils'

export const Route = createFileRoute('/super/promoters/$id')({
  beforeLoad: async () => {
    if (!localStorage.getItem(TOKEN_KEY)) throw redirect({ to: '/login', search: { next: undefined, ref: undefined } })
    try {
      const { data: me } = await api.get<AuthUser>('/auth/me')
      if (me.role !== 'super_admin_delivery') throw redirect({ to: '/' })
    } catch (e) {
      if (isRedirect(e)) throw e
      throw redirect({ to: '/login', search: { next: undefined, ref: undefined } })
    }
  },
  component: SuperPromoterDetailPage,
})

function BalanceCard({
  label,
  cents,
  accent,
  helper,
}: {
  label: string
  cents: number
  accent?: boolean
  helper?: string
}) {
  return (
    <div className="flex flex-col gap-1 border border-ink/15 bg-paper p-5">
      <span className="eyebrow">{label}</span>
      <span
        className={`display nums text-4xl font-semibold ${
          accent ? 'text-brand' : 'text-ink'
        }`}
      >
        {formatCents(cents)}
      </span>
      {helper ? (
        <span className="mt-1 text-[0.62rem] uppercase tracking-[0.15em] text-ink-muted">
          {helper}
        </span>
      ) : null}
    </div>
  )
}

function commissionLabel(e: PromoterCommissionEntry): string {
  if (e.type === 'paid_out') return 'Pago recibido'
  if (e.status === 'pending') return 'Pendiente'
  if (e.status === 'claimable') return 'Disponible'
  if (e.status === 'paid') return 'Pagada'
  return e.status
}

function PayoutRow({ payout }: { payout: Payout }) {
  return (
    <li className="grid grid-cols-12 items-start gap-3 border-b border-ink/10 py-3">
      <div className="col-span-4 text-[0.65rem] uppercase tracking-[0.14em] text-ink-muted">
        {formatDate(payout.createdAt)}
      </div>
      <div className="col-span-5 text-sm text-ink">
        {payout.notes ? `“${payout.notes}”` : '—'}
        {payout.createdBy ? (
          <p className="mt-0.5 text-[0.6rem] uppercase tracking-[0.14em] text-ink-muted">
            por {payout.createdBy.fullName}
          </p>
        ) : null}
      </div>
      <div className="col-span-3 text-right nums text-lg font-semibold text-brand">
        {formatCents(payout.amountCents)}
      </div>
    </li>
  )
}

function ReferredRow({ customer }: { customer: ReferredCustomerSummary }) {
  return (
    <tr className="border-b border-ink/10 align-top">
      <td className="py-3 pr-3">
        <p className="text-sm font-medium text-ink">{customer.fullName}</p>
        <p className="mt-0.5 text-[0.6rem] uppercase tracking-[0.14em] text-ink-muted">
          {customer.firstOrderAt
            ? `Primera orden ${formatDate(customer.firstOrderAt)}`
            : 'Aún no pidió'}
        </p>
      </td>
      <td className="py-3 pr-3 text-right nums text-sm text-ink">
        {customer.orderCount}
      </td>
      <td className="py-3 pr-3 text-right nums text-sm text-ink">
        {formatCents(customer.totalSpentCents)}
      </td>
      <td className="py-3 text-right nums text-sm text-brand">
        {formatCents(customer.totalCommissionGeneratedCents)}
      </td>
    </tr>
  )
}

function PayoutModal({
  promoterName,
  claimableCents,
  onClose,
  onConfirm,
  isPending,
  errorMsg,
}: {
  promoterName: string
  claimableCents: number
  onClose: () => void
  onConfirm: (notes: string) => void
  isPending: boolean
  errorMsg: string | null
}) {
  const [notes, setNotes] = useState('')

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 backdrop-blur-sm sm:items-center">
      <div className="w-full max-w-lg border border-ink/15 bg-paper p-6 shadow-paper">
        <div className="mb-3 flex items-center justify-between">
          <span className="eyebrow">Pagar comisiones</span>
          <button
            type="button"
            className="text-[0.7rem] uppercase tracking-[0.14em] text-ink-muted hover:text-ink"
            onClick={onClose}
            disabled={isPending}
          >
            Cerrar ✕
          </button>
        </div>

        <p className="display text-3xl font-semibold text-ink">
          ¿Pagar{' '}
          <span className="nums text-brand">
            {formatCents(claimableCents)}
          </span>{' '}
          a{' '}
          <span className="italic">{promoterName}</span>
          ?
        </p>

        <p className="mt-3 text-sm text-ink-muted">
          Esta acción marca todas las comisiones disponibles como pagadas y
          registra un pago histórico. No se puede revertir.
        </p>

        <div className="mt-5">
          <label className="eyebrow mb-2 block" htmlFor="notes">
            Notas (opcional)
          </label>
          <Textarea
            id="notes"
            rows={3}
            placeholder="Ej: Paid via Cash App $handle"
            value={notes}
            maxLength={500}
            onChange={(e) => setNotes(e.target.value)}
            disabled={isPending}
          />
        </div>

        {errorMsg ? (
          <p className="mt-3 border-l-2 border-bad pl-3 text-sm font-medium text-bad">
            {errorMsg}
          </p>
        ) : null}

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onClose} disabled={isPending}>
            Cancelar
          </Button>
          <Button
            variant="accent"
            onClick={() => onConfirm(notes.trim())}
            disabled={isPending}
          >
            {isPending ? 'Pagando…' : 'Confirmar pago'}
          </Button>
        </div>
      </div>
    </div>
  )
}

function SuperPromoterDetailPage() {
  const { id } = Route.useParams()
  const { data, isPending, isError } = usePromoterDashboardAsAdmin(id)
  const { data: payouts } = usePromoterPayouts(id)
  const createPayout = useCreatePayout()

  const [modalOpen, setModalOpen] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  if (isPending) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-20 text-center">
        <span className="eyebrow">Cargando…</span>
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-20 text-center">
        <span className="eyebrow">Error</span>
        <p className="display mt-3 text-3xl text-ink-muted">
          No pudimos cargar este promotor.
        </p>
        <Link to="/super/promoters" className="mt-5 inline-block">
          <Button variant="ghost">← Volver</Button>
        </Link>
      </div>
    )
  }

  const { promoter, balances, referredCustomers, recentCommissions } = data
  const payoutList = payouts ?? data.payouts

  const handleConfirm = async (notes: string) => {
    setErrorMsg(null)
    try {
      await createPayout.mutateAsync({
        promoterId: id,
        notes: notes.length > 0 ? notes : undefined,
      })
      setModalOpen(false)
    } catch (err) {
      const msg =
        (err as Error & { response?: { data?: { message?: string } } })
          ?.response?.data?.message ?? 'No se pudo emitir el pago'
      setErrorMsg(msg)
    }
  }

  return (
    <div className="page-rise mx-auto max-w-6xl px-6 py-12">
      <SectionHeading
        eyebrow="Promotor · Detalle"
        title={
          <>
            {promoter.fullName.split(' ')[0]}{' '}
            <span className="italic text-brand">
              {promoter.fullName.split(' ').slice(1).join(' ')}
            </span>
          </>
        }
        subtitle={`${promoter.phone ?? '—'} · Código ${promoter.referralCode ?? '—'}`}
        action={
          <Link to="/super/promoters">
            <Button variant="ghost" size="sm">
              ← Promotores
            </Button>
          </Link>
        }
      />

      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <BalanceCard
          label="Disponible para pago"
          cents={balances.claimableCents}
          accent={balances.claimableCents > 0}
          helper="Cobrable ahora"
        />
        <BalanceCard
          label="Pendiente (90 días)"
          cents={balances.pendingCents}
          helper="Vestea a los 90 días"
        />
        <BalanceCard
          label="Pagado en total"
          cents={balances.paidCents}
          helper="Histórico"
        />
      </div>

      <div className="mb-10 border border-ink/15 bg-paper p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <span className="eyebrow">Pagar comisiones</span>
            <p className="display mt-2 text-2xl font-semibold text-ink">
              {balances.claimableCents > 0
                ? `Hay ${formatCents(balances.claimableCents)} disponibles`
                : 'Sin comisiones para pagar'}
            </p>
            <p className="mt-1 text-sm text-ink-muted">
              Al confirmar, todas las comisiones pasan a "pagadas" y se registra
              un pago agrupado.
            </p>
          </div>
          <Button
            variant="accent"
            size="lg"
            disabled={balances.claimableCents <= 0 || createPayout.isPending}
            onClick={() => {
              setErrorMsg(null)
              setModalOpen(true)
            }}
          >
            Pagar ahora
          </Button>
        </div>
      </div>

      <div className="mb-10 border border-ink/15 bg-paper p-6">
        <div className="mb-4 flex items-center justify-between border-b border-ink/10 pb-3">
          <span className="eyebrow">
            Clientes referidos ({referredCustomers.length})
          </span>
        </div>
        {referredCustomers.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-sm text-ink-muted">Sin referidos todavía.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-ink/15">
                  <th className="pb-2 pr-3 eyebrow">Cliente</th>
                  <th className="pb-2 pr-3 text-right eyebrow">Pedidos</th>
                  <th className="pb-2 pr-3 text-right eyebrow">Gastado</th>
                  <th className="pb-2 text-right eyebrow">Comisión</th>
                </tr>
              </thead>
              <tbody>
                {referredCustomers.map((c) => (
                  <ReferredRow key={c.id} customer={c} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="border border-ink/15 bg-paper p-6">
          <div className="mb-4 flex items-center justify-between border-b border-ink/10 pb-3">
            <span className="eyebrow">Últimas comisiones</span>
          </div>
          {recentCommissions.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm text-ink-muted">Sin movimientos todavía.</p>
            </div>
          ) : (
            <ul>
              {recentCommissions.slice(0, 10).map((c) => {
                const negative = c.amountCents < 0
                return (
                  <li
                    key={c.id}
                    className="grid grid-cols-12 items-start gap-3 border-b border-ink/10 py-3"
                  >
                    <div className="col-span-5">
                      <p className="text-sm font-medium text-ink">
                        {commissionLabel(c)}
                      </p>
                      <p className="mt-0.5 text-[0.6rem] uppercase tracking-[0.14em] text-ink-muted">
                        {formatDate(c.createdAt)}
                      </p>
                    </div>
                    <div className="col-span-4 text-sm text-ink-muted">
                      {c.referredUserName ?? '—'}
                    </div>
                    <div className="col-span-3 text-right nums text-base font-semibold">
                      <span className={negative ? 'text-bad' : 'text-ink'}>
                        {negative ? '−' : '+'}
                        {formatCents(Math.abs(c.amountCents))}
                      </span>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="border border-ink/15 bg-paper p-6">
          <div className="mb-4 flex items-center justify-between border-b border-ink/10 pb-3">
            <span className="eyebrow">Pagos emitidos</span>
          </div>
          {payoutList.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm text-ink-muted">Aún no se emitió ningún pago.</p>
            </div>
          ) : (
            <ul>
              {payoutList.map((p) => (
                <PayoutRow key={p.id} payout={p} />
              ))}
            </ul>
          )}
        </div>
      </div>

      {modalOpen ? (
        <PayoutModal
          promoterName={promoter.fullName}
          claimableCents={balances.claimableCents}
          onClose={() => {
            if (!createPayout.isPending) setModalOpen(false)
          }}
          onConfirm={handleConfirm}
          isPending={createPayout.isPending}
          errorMsg={errorMsg}
        />
      ) : null}
    </div>
  )
}
