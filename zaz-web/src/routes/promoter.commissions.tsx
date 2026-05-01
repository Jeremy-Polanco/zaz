import { createFileRoute, isRedirect, Link, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { Button, SectionHeading } from '../components/ui'
import { usePromoterCommissions } from '../lib/queries'
import type {
  AuthUser,
  PromoterCommissionEntry,
  PromoterCommissionEntryStatus,
} from '../lib/types'
import { TOKEN_KEY, api } from '../lib/api'
import { formatCents, formatDate } from '../lib/utils'

export const Route = createFileRoute('/promoter/commissions')({
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
  component: PromoterCommissionsPage,
})

type FilterValue = PromoterCommissionEntryStatus | 'all'

const FILTERS: { label: string; value: FilterValue }[] = [
  { label: 'Todas', value: 'all' },
  { label: 'Disponibles', value: 'claimable' },
  { label: 'Pendientes', value: 'pending' },
  { label: 'Pagadas', value: 'paid' },
]

function Chip({
  active,
  children,
  onClick,
}: {
  active: boolean
  children: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center border px-3 py-1.5 text-[0.7rem] uppercase tracking-[0.18em] transition-colors ${
        active
          ? 'border-accent bg-accent text-brand-dark'
          : 'border-ink/20 bg-paper text-ink hover:bg-ink/5'
      }`}
    >
      {children}
    </button>
  )
}

function statusLabel(e: PromoterCommissionEntry): string {
  if (e.type === 'paid_out') return 'Pago recibido'
  if (e.status === 'pending') return 'Pendiente'
  if (e.status === 'claimable') return 'Disponible'
  if (e.status === 'paid') return 'Pagada'
  return e.status
}

function CommissionRow({ entry }: { entry: PromoterCommissionEntry }) {
  const negative = entry.amountCents < 0
  return (
    <tr className="border-b border-ink/10 align-top">
      <td className="py-3 pr-3 nums text-[0.7rem] uppercase tracking-[0.12em] text-ink-muted">
        {formatDate(entry.createdAt)}
      </td>
      <td className="py-3 pr-3 text-sm text-ink">{statusLabel(entry)}</td>
      <td className="py-3 pr-3 text-sm text-ink-muted">
        {entry.referredUserName ?? '—'}
      </td>
      <td className="py-3 pr-3 nums text-[0.7rem] uppercase tracking-[0.12em] text-ink-muted">
        {entry.status === 'pending' && entry.claimableAt
          ? `Vesta ${formatDate(entry.claimableAt)}`
          : entry.status === 'paid'
            ? 'Pagada'
            : entry.status === 'claimable'
              ? 'Lista para pago'
              : '—'}
      </td>
      <td
        className={`py-3 text-right nums text-base font-semibold ${
          negative ? 'text-bad' : 'text-ink'
        }`}
      >
        {negative ? '−' : '+'}
        {formatCents(Math.abs(entry.amountCents))}
      </td>
    </tr>
  )
}

function PromoterCommissionsPage() {
  const [filter, setFilter] = useState<FilterValue>('all')
  const [page, setPage] = useState(1)

  const { data, isPending } = usePromoterCommissions({
    status: filter === 'all' ? undefined : filter,
    page,
    pageSize: 25,
  })

  const items = data?.items ?? []

  return (
    <div className="page-rise mx-auto max-w-5xl px-6 py-12">
      <SectionHeading
        eyebrow="Comisiones"
        title={
          <>
            Mis <span className="italic text-brand">comisiones.</span>
          </>
        }
        subtitle="Historial completo de lo que ganaste por referir clientes."
        action={
          <Link to="/promoter">
            <Button variant="ghost" size="sm">
              ← Panel
            </Button>
          </Link>
        }
      />

      <div className="mb-6 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Chip
            key={f.value}
            active={filter === f.value}
            onClick={() => {
              setFilter(f.value)
              setPage(1)
            }}
          >
            {f.label}
          </Chip>
        ))}
      </div>

      <div className="border border-ink/15 bg-paper p-6">
        {isPending ? (
          <div className="py-12 text-center">
            <span className="eyebrow">Cargando…</span>
          </div>
        ) : items.length === 0 ? (
          <div className="py-12 text-center">
            <span className="eyebrow">Sin movimientos</span>
            <p className="mt-3 text-sm text-ink-muted">
              Todavía no hay comisiones para este filtro.
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-ink/15">
                    <th className="pb-2 pr-3 eyebrow">Fecha</th>
                    <th className="pb-2 pr-3 eyebrow">Estado</th>
                    <th className="pb-2 pr-3 eyebrow">Cliente</th>
                    <th className="pb-2 pr-3 eyebrow">Detalle</th>
                    <th className="pb-2 text-right eyebrow">Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((e) => (
                    <CommissionRow key={e.id} entry={e} />
                  ))}
                </tbody>
              </table>
            </div>
            {data && data.totalPages > 1 ? (
              <div className="mt-6 flex items-center justify-between border-t border-ink/10 pt-4">
                <span className="text-[0.62rem] uppercase tracking-[0.15em] text-ink-muted">
                  Página {data.page} de {data.totalPages} · {data.totalCount}{' '}
                  movimientos
                </span>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={data.page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    ← Anterior
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={data.page >= data.totalPages}
                    onClick={() =>
                      setPage((p) => Math.min(data.totalPages, p + 1))
                    }
                  >
                    Siguiente →
                  </Button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}
