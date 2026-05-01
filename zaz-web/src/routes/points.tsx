import { createFileRoute, redirect } from '@tanstack/react-router'
import { SectionHeading } from '../components/ui'
import { usePointsBalance, usePointsHistory } from '../lib/queries'
import { formatCents, formatDate } from '../lib/utils'
import type { PointsEntry } from '../lib/types'
import { TOKEN_KEY } from '../lib/api'

export const Route = createFileRoute('/points')({
  beforeLoad: () => {
    if (!localStorage.getItem(TOKEN_KEY)) throw redirect({ to: '/login', search: { next: undefined, ref: undefined } })
  },
  component: PointsPage,
})

function BalanceCard({
  label,
  cents,
  accent,
}: {
  label: string
  cents: number
  accent?: boolean
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
    </div>
  )
}

function typeLabel(e: PointsEntry): string {
  if (e.type === 'earned') {
    if (e.status === 'pending') return 'Ganados · pendiente'
    if (e.status === 'claimable') return 'Ganados · disponibles'
    if (e.status === 'redeemed') return 'Ganados · usados'
    if (e.status === 'expired') return 'Ganados · vencidos'
  }
  if (e.type === 'redeemed') return 'Canjeados en un pedido'
  if (e.type === 'expired') return 'Vencidos'
  return e.type
}

function EntryRow({ entry }: { entry: PointsEntry }) {
  const isNegative = entry.amountCents < 0
  return (
    <li className="grid grid-cols-12 items-center gap-4 border-b border-ink/10 py-4">
      <div className="col-span-3">
        <span className="text-[0.65rem] uppercase tracking-[0.15em] text-ink-muted">
          {formatDate(entry.createdAt)}
        </span>
      </div>
      <div className="col-span-5">
        <p className="text-sm font-medium text-ink">{typeLabel(entry)}</p>
        {entry.status === 'pending' && entry.claimableAt && (
          <p className="mt-0.5 text-[0.65rem] uppercase tracking-[0.12em] text-ink-muted">
            Disponible el {formatDate(entry.claimableAt)}
          </p>
        )}
        {entry.status === 'claimable' && entry.expiresAt && (
          <p className="mt-0.5 text-[0.65rem] uppercase tracking-[0.12em] text-ink-muted">
            Vence el {formatDate(entry.expiresAt)}
          </p>
        )}
      </div>
      <div className="col-span-2">
        <span className="text-[0.65rem] uppercase tracking-[0.12em] text-ink-muted">
          {entry.status}
        </span>
      </div>
      <div className="col-span-2 text-right">
        <span
          className={`display nums text-lg font-semibold ${
            isNegative ? 'text-bad' : 'text-ink'
          }`}
        >
          {isNegative ? '−' : '+'}
          {formatCents(Math.abs(entry.amountCents))}
        </span>
      </div>
    </li>
  )
}

function PointsPage() {
  const { data: balance, isPending: bPending } = usePointsBalance()
  const { data: entries, isPending: hPending } = usePointsHistory()

  if (bPending || hPending) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-20 text-center">
        <span className="eyebrow">Cargando puntos…</span>
      </div>
    )
  }

  return (
    <div className="page-rise mx-auto max-w-6xl px-6 py-12">
      <SectionHeading
        eyebrow="Recompensa"
        title={
          <>
            Mis <span className="italic text-brand">puntos.</span>
          </>
        }
        subtitle="1 punto = $1. Disponibles a 90 días, vencen a 180."
      />

      <div className="mb-10 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <BalanceCard
          label="Disponibles"
          cents={balance?.claimableCents ?? 0}
          accent={(balance?.claimableCents ?? 0) > 0}
        />
        <BalanceCard label="Pendientes" cents={balance?.pendingCents ?? 0} />
        <BalanceCard label="Usados" cents={balance?.redeemedCents ?? 0} />
        <BalanceCard label="Vencidos" cents={balance?.expiredCents ?? 0} />
      </div>

      <div className="border border-ink/15 bg-paper p-6">
        <div className="mb-4 flex items-center justify-between border-b border-ink/10 pb-3">
          <span className="eyebrow">Historial</span>
          <span className="text-[0.65rem] uppercase tracking-[0.15em] text-ink-muted">
            {entries?.length ?? 0} movimiento{(entries?.length ?? 0) === 1 ? '' : 's'}
          </span>
        </div>
        {entries && entries.length > 0 ? (
          <ul className="flex flex-col">
            {entries.map((e) => (
              <EntryRow key={e.id} entry={e} />
            ))}
          </ul>
        ) : (
          <div className="py-12 text-center">
            <span className="eyebrow">Sin movimientos todavía</span>
            <p className="mt-3 text-ink-muted">
              Haz tu primer pedido para empezar a acumular puntos.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
