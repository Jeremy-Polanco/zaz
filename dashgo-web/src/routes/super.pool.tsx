import { createFileRoute, isRedirect, redirect } from '@tanstack/react-router'
import { Card, SectionHeading } from '../components/ui'
import { usePoolDistributions, usePoolSummary } from '../lib/queries'
import { TOKEN_KEY, api } from '../lib/api'
import { isSuperAdmin } from '../lib/roles'
import { formatDistributionDate, quarterLabel } from '../lib/pool'
import { formatCents } from '../lib/utils'
import type { AuthUser } from '../lib/types'

export const Route = createFileRoute('/super/pool')({
  beforeLoad: async () => {
    if (!localStorage.getItem(TOKEN_KEY)) {
      throw redirect({ to: '/login', search: { next: undefined, ref: undefined } })
    }
    try {
      const { data: me } = await api.get<AuthUser>('/auth/me')
      // Solo super admin: el vendedor es staff pero esto no le corresponde.
      if (!isSuperAdmin(me.role)) throw redirect({ to: '/' })
    } catch (e) {
      if (isRedirect(e)) throw e
      throw redirect({ to: '/login', search: { next: undefined, ref: undefined } })
    }
  },
  component: SuperPoolPage,
})

const TH = 'p-3 text-[11px] font-semibold uppercase tracking-wide text-ink-muted'

export function SuperPoolPage() {
  const { data: summary } = usePoolSummary(true)
  const { data: distributions, isPending } = usePoolDistributions()

  return (
    <div className="page-rise mx-auto max-w-4xl px-6 py-12">
      <SectionHeading eyebrow="Panel" title="Pool de asociados" />

      {summary && (
        <Card className="mb-8">
          <span className="eyebrow">{quarterLabel(summary.quarter)} · en curso</span>
          <dl className="mt-4 grid gap-4 sm:grid-cols-4">
            <div>
              <dt className="text-xs uppercase tracking-wide text-ink-muted">Pool</dt>
              <dd className="display mt-1 text-2xl font-semibold text-ink">
                {formatCents(summary.poolCents)}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-ink-muted">
                Asociados
              </dt>
              <dd className="mt-1 text-ink">{summary.associateCount}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-ink-muted">
                Parte estimada
              </dt>
              <dd className="mt-1 text-ink">
                {formatCents(summary.estimatedShareCents)}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-ink-muted">
                Próximo reparto
              </dt>
              <dd className="mt-1 text-ink">
                {formatDistributionDate(summary.nextDistributionAt)}
              </dd>
            </div>
          </dl>
        </Card>
      )}

      <h2 className="display mb-4 text-2xl font-semibold text-ink">Repartos</h2>
      {isPending || !distributions ? (
        <p className="text-sm text-ink-muted">Cargando…</p>
      ) : distributions.length === 0 ? (
        <p className="text-sm text-ink-muted">Aún no se hizo ningún reparto.</p>
      ) : (
        <div className="overflow-x-auto border border-ink/10">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-ink/10 bg-paper-deep">
              <tr>
                <th className={TH}>Trimestre</th>
                <th className={TH}>Total</th>
                <th className={TH}>Asociados</th>
                <th className={TH}>Parte c/u</th>
                <th className={TH}>Arrastre</th>
              </tr>
            </thead>
            <tbody>
              {distributions.map((d) => (
                <tr key={d.id} className="border-b border-ink/5">
                  <td className="p-3 font-medium text-ink">{quarterLabel(d.quarter)}</td>
                  <td className="p-3 text-ink">{formatCents(d.totalCents)}</td>
                  <td className="p-3 text-ink">{d.associateCount}</td>
                  <td className="p-3 text-ink">{formatCents(d.shareCents)}</td>
                  <td className="p-3 text-ink-muted">{formatCents(d.remainderCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
