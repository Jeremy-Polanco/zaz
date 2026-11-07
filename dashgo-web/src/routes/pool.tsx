import { createFileRoute, isRedirect, redirect } from '@tanstack/react-router'
import { Card, SectionHeading } from '../components/ui'
import { useCurrentUser, useMyAssociateBalance, usePoolSummary } from '../lib/queries'
import { TOKEN_KEY, api } from '../lib/api'
import { isAssociate } from '../lib/roles'
import { formatDistributionDate, quarterLabel } from '../lib/pool'
import { formatCents } from '../lib/utils'
import type { AssociateBalanceEntry, AuthUser } from '../lib/types'

export const Route = createFileRoute('/pool')({
  beforeLoad: async () => {
    if (!localStorage.getItem(TOKEN_KEY)) {
      throw redirect({ to: '/login', search: { next: undefined, ref: undefined } })
    }
    try {
      // Solo exige sesión: un ex asociado conserva su saldo y su historial.
      await api.get<AuthUser>('/auth/me')
    } catch (e) {
      if (isRedirect(e)) throw e
      throw redirect({ to: '/login', search: { next: undefined, ref: undefined } })
    }
  },
  component: PoolPage,
})

function entryTitle(entry: AssociateBalanceEntry): string {
  const order = entry.orderId ? ` #${entry.orderId.slice(0, 8).toUpperCase()}` : ''
  switch (entry.type) {
    case 'allocation':
      return entry.quarter
        ? `Reparto del ${quarterLabel(entry.quarter)}`
        : 'Reparto del pool'
    case 'redemption':
      return order ? `Canje en el pedido${order}` : 'Canje en un pedido'
    case 'reversal':
      return order ? `Devolución del pedido${order}` : 'Devolución de un canje'
  }
}

function signedCents(cents: number): string {
  return cents < 0 ? `-${formatCents(-cents)}` : `+${formatCents(cents)}`
}

export function PoolPage() {
  const { data: me } = useCurrentUser()
  const associate = isAssociate(me?.role)
  const { data: balance, isPending: balancePending } = useMyAssociateBalance(true)
  // Un cliente (o ex asociado) pegándole a /pool/summary recibiría 403.
  const { data: summary } = usePoolSummary(associate)

  return (
    <div className="page-rise mx-auto max-w-2xl px-6 py-12">
      <SectionHeading
        eyebrow="Asociados"
        title="Pool de asociados"
        subtitle="Cada trimestre el pool se reparte en partes iguales entre los asociados, como saldo para tus próximos pedidos."
      />

      {associate && summary && (
        <Card className="mb-6">
          <span className="eyebrow">{quarterLabel(summary.quarter)}</span>
          <dl className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs uppercase tracking-wide text-ink-muted">
                Pool del trimestre
              </dt>
              <dd className="display mt-1 text-3xl font-semibold text-ink">
                {formatCents(summary.poolCents)}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-ink-muted">
                Tu parte estimada
              </dt>
              <dd className="display mt-1 text-3xl font-semibold text-ink">
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
            <div>
              <dt className="text-xs uppercase tracking-wide text-ink-muted">
                Asociados
              </dt>
              <dd className="mt-1 text-ink">
                {summary.associateCount}{' '}
                {summary.associateCount === 1 ? 'asociado' : 'asociados'}
              </dd>
            </div>
          </dl>
        </Card>
      )}

      <Card className="mb-6">
        <span className="eyebrow">Tu saldo</span>
        <p className="display mt-2 text-4xl font-semibold text-ink">
          {balancePending || !balance ? '…' : formatCents(balance.balanceCents)}
        </p>
        <p className="mt-2 text-sm text-ink-muted">
          Se aplica solo al pagar un pedido.
        </p>
      </Card>

      <Card>
        <span className="eyebrow">Historial</span>
        {balancePending || !balance ? (
          <p className="mt-4 text-sm text-ink-muted">Cargando…</p>
        ) : balance.entries.length === 0 ? (
          <p className="mt-4 text-sm text-ink-muted">
            Todavía no tienes movimientos.
          </p>
        ) : (
          <ul className="mt-4 flex flex-col divide-y divide-ink/10">
            {balance.entries.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center justify-between gap-4 py-3"
              >
                <div className="flex flex-col">
                  <span className="font-medium text-ink">{entryTitle(entry)}</span>
                  <span className="text-xs text-ink-muted">
                    {formatDistributionDate(entry.createdAt)}
                  </span>
                </div>
                <span
                  className={
                    entry.amountCents < 0
                      ? 'font-medium text-ink-muted'
                      : 'font-medium text-ok'
                  }
                >
                  {signedCents(entry.amountCents)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
