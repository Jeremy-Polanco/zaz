import { createFileRoute, isRedirect, Link, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { Button, SectionHeading } from '../components/ui'
import { usePromoterDashboard } from '../lib/queries'
import type {
  AuthUser,
  PromoterCommissionEntry,
  Payout,
  ReferredCustomerSummary,
} from '../lib/types'
import { TOKEN_KEY, api } from '../lib/api'
import { formatCents, formatDate } from '../lib/utils'

export const Route = createFileRoute('/promoter/')({
  beforeLoad: async () => {
    if (!localStorage.getItem(TOKEN_KEY)) throw redirect({ to: '/login', search: { next: undefined, ref: undefined } })
    try {
      const { data: me } = await api.get<AuthUser>('/auth/me')
      if (me.role !== 'promoter') throw redirect({ to: '/' })
    } catch (e) {
      if (isRedirect(e)) throw e
      throw redirect({ to: '/login', search: { next: undefined, ref: undefined } })
    }
  },
  component: PromoterDashboardPage,
})

function CopyChip({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false)
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }
  return (
    <button
      type="button"
      onClick={onCopy}
      className="inline-flex items-center gap-2 border border-ink/20 bg-paper px-3 py-1.5 text-[0.72rem] uppercase tracking-[0.18em] text-ink hover:bg-ink/5"
    >
      {copied ? 'Copiado ✓' : label}
    </button>
  )
}

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

function ReferredRow({ customer }: { customer: ReferredCustomerSummary }) {
  return (
    <tr className="border-b border-ink/10">
      <td className="py-3 pr-3 align-top">
        <p className="text-sm font-medium text-ink">{customer.fullName}</p>
        <p className="mt-0.5 text-[0.62rem] uppercase tracking-[0.14em] text-ink-muted">
          {customer.firstOrderAt
            ? `Primera orden ${formatDate(customer.firstOrderAt)}`
            : 'Aún no pidió'}
        </p>
      </td>
      <td className="py-3 pr-3 text-right align-top nums text-sm text-ink">
        {customer.orderCount}
      </td>
      <td className="py-3 pr-3 text-right align-top nums text-sm text-ink">
        {formatCents(customer.totalSpentCents)}
      </td>
      <td className="py-3 text-right align-top nums text-sm text-brand">
        {formatCents(customer.totalCommissionGeneratedCents)}
      </td>
    </tr>
  )
}

function commissionLabel(entry: PromoterCommissionEntry): string {
  if (entry.type === 'paid_out') return 'Pago recibido'
  if (entry.status === 'pending') return 'Pendiente (a 90 días)'
  if (entry.status === 'claimable') return 'Disponible'
  if (entry.status === 'paid') return 'Pagada'
  return entry.status
}

function CommissionRow({ entry }: { entry: PromoterCommissionEntry }) {
  const negative = entry.amountCents < 0
  return (
    <li className="grid grid-cols-12 items-start gap-3 border-b border-ink/10 py-3">
      <div className="col-span-4">
        <p className="text-sm font-medium text-ink">{commissionLabel(entry)}</p>
        <p className="mt-0.5 text-[0.62rem] uppercase tracking-[0.14em] text-ink-muted">
          {formatDate(entry.createdAt)}
        </p>
      </div>
      <div className="col-span-5">
        {entry.referredUserName ? (
          <p className="text-sm text-ink-muted">
            de{' '}
            <span className="font-medium text-ink">
              {entry.referredUserName}
            </span>
          </p>
        ) : null}
        {entry.status === 'pending' && entry.claimableAt ? (
          <p className="mt-0.5 text-[0.6rem] uppercase tracking-[0.12em] text-ink-muted">
            Disponible el {formatDate(entry.claimableAt)}
          </p>
        ) : null}
      </div>
      <div className="col-span-3 text-right nums text-base font-semibold">
        <span className={negative ? 'text-bad' : 'text-ink'}>
          {negative ? '−' : '+'}
          {formatCents(Math.abs(entry.amountCents))}
        </span>
      </div>
    </li>
  )
}

function PayoutRow({ payout }: { payout: Payout }) {
  return (
    <li className="flex items-start justify-between gap-4 border-b border-ink/10 py-3">
      <div className="flex-1">
        <p className="text-sm font-medium text-ink">
          {formatCents(payout.amountCents)}
        </p>
        <p className="mt-0.5 text-[0.62rem] uppercase tracking-[0.14em] text-ink-muted">
          {formatDate(payout.createdAt)}
        </p>
        {payout.notes ? (
          <p className="mt-1 text-xs text-ink-muted">“{payout.notes}”</p>
        ) : null}
      </div>
      {payout.createdBy ? (
        <span className="text-[0.6rem] uppercase tracking-[0.14em] text-ink-muted">
          {payout.createdBy.fullName}
        </span>
      ) : null}
    </li>
  )
}

function PromoterDashboardPage() {
  const { data, isPending, isError } = usePromoterDashboard()

  if (isPending) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-20 text-center">
        <span className="eyebrow">Cargando panel…</span>
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-20 text-center">
        <span className="eyebrow">Error</span>
        <p className="display mt-3 text-3xl text-ink-muted">
          No pudimos cargar tu panel.
        </p>
      </div>
    )
  }

  const { promoter, balances, referredCustomers, recentCommissions, payouts } =
    data

  return (
    <div className="page-rise mx-auto max-w-6xl px-6 py-12">
      <SectionHeading
        eyebrow="Panel · Promotor"
        title={
          <>
            Hola,{' '}
            <span className="italic text-brand">
              {promoter.fullName.split(' ')[0]}.
            </span>
          </>
        }
        subtitle="Tus referidos, comisiones y pagos. Todo en un lugar."
      />

      <div className="mb-10 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <BalanceCard
          label="Disponible para pago"
          cents={balances.claimableCents}
          accent={balances.claimableCents > 0}
          helper="Lo puedes cobrar ahora"
        />
        <BalanceCard
          label="Pendiente (90 días)"
          cents={balances.pendingCents}
          helper="Vestea a los 90 días"
        />
        <BalanceCard
          label="Pagado en total"
          cents={balances.paidCents}
          helper="Histórico recibido"
        />
      </div>

      <div className="mb-10 grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="border border-ink/15 bg-paper p-6">
          <span className="eyebrow">Tu código</span>
          <p className="display mt-3 nums text-5xl font-bold tracking-[0.2em] text-brand">
            {promoter.referralCode ?? '—'}
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            {promoter.referralCode ? (
              <CopyChip label="Copiar código" text={promoter.referralCode} />
            ) : null}
            <CopyChip label="Copiar link" text={promoter.shareUrl} />
          </div>
          <p className="mt-4 break-all text-[0.7rem] uppercase tracking-[0.14em] text-ink-muted">
            {promoter.shareUrl}
          </p>
        </div>

        <div className="border border-ink/15 bg-paper p-6">
          <span className="eyebrow">Referidos</span>
          <p className="display mt-3 text-6xl font-semibold leading-none text-ink">
            {data.referredCount}
          </p>
          <p className="mt-4 max-w-sm text-sm text-ink-muted">
            Cada vez que alguien se registra con tu código, sumas un referido.
            Ganas cuando sus pedidos son entregados.
          </p>
          <div className="mt-4 flex gap-3">
            <Link to="/promoter/commissions">
              <Button size="sm" variant="secondary">
                Ver comisiones
              </Button>
            </Link>
            <Link to="/promoter/payouts">
              <Button size="sm" variant="ghost">
                Historial de pagos
              </Button>
            </Link>
          </div>
        </div>
      </div>

      <div className="mb-10 border border-ink/15 bg-paper p-6">
        <div className="mb-4 flex items-center justify-between border-b border-ink/10 pb-3">
          <span className="eyebrow">Clientes referidos</span>
          <span className="text-[0.62rem] uppercase tracking-[0.15em] text-ink-muted">
            {referredCustomers.length} persona
            {referredCustomers.length === 1 ? '' : 's'}
          </span>
        </div>
        {referredCustomers.length === 0 ? (
          <div className="py-10 text-center">
            <span className="eyebrow">Sin referidos todavía</span>
            <p className="mt-2 text-sm text-ink-muted">
              Comparte tu código y empieza a ganar comisiones.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-ink/15">
                  <th className="pb-2 pr-3 eyebrow">Cliente</th>
                  <th className="pb-2 pr-3 text-right eyebrow">Pedidos</th>
                  <th className="pb-2 pr-3 text-right eyebrow">Total gastado</th>
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
            <Link
              to="/promoter/commissions"
              className="text-[0.62rem] uppercase tracking-[0.15em] text-brand hover:underline"
            >
              Ver todo →
            </Link>
          </div>
          {recentCommissions.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm text-ink-muted">Sin comisiones todavía.</p>
            </div>
          ) : (
            <ul>
              {recentCommissions.slice(0, 10).map((c) => (
                <CommissionRow key={c.id} entry={c} />
              ))}
            </ul>
          )}
        </div>

        <div className="border border-ink/15 bg-paper p-6">
          <div className="mb-4 flex items-center justify-between border-b border-ink/10 pb-3">
            <span className="eyebrow">Pagos recibidos</span>
            <Link
              to="/promoter/payouts"
              className="text-[0.62rem] uppercase tracking-[0.15em] text-brand hover:underline"
            >
              Ver todo →
            </Link>
          </div>
          {payouts.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm text-ink-muted">
                Sin pagos todavía. El admin te avisa cuando se emita.
              </p>
            </div>
          ) : (
            <ul>
              {payouts.map((p) => (
                <PayoutRow key={p.id} payout={p} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
