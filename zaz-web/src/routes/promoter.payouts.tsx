import { createFileRoute, isRedirect, Link, redirect } from '@tanstack/react-router'
import { Button, SectionHeading } from '../components/ui'
import { useMyPayouts } from '../lib/queries'
import type { AuthUser } from '../lib/types'
import { TOKEN_KEY, api } from '../lib/api'
import { formatCents, formatDate } from '../lib/utils'

export const Route = createFileRoute('/promoter/payouts')({
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
  component: PromoterPayoutsPage,
})

function PromoterPayoutsPage() {
  const { data: payouts, isPending } = useMyPayouts()
  const list = payouts ?? []
  const total = list.reduce((sum, p) => sum + p.amountCents, 0)

  return (
    <div className="page-rise mx-auto max-w-4xl px-6 py-12">
      <SectionHeading
        eyebrow="Pagos"
        title={
          <>
            Mis <span className="italic text-brand">pagos.</span>
          </>
        }
        subtitle="Cada vez que el admin te paga, queda registrado acá."
        action={
          <Link to="/promoter">
            <Button variant="ghost" size="sm">
              ← Panel
            </Button>
          </Link>
        }
      />

      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="border border-ink/15 bg-paper p-5">
          <span className="eyebrow">Total recibido</span>
          <p className="display nums mt-2 text-4xl font-semibold text-brand">
            {formatCents(total)}
          </p>
        </div>
        <div className="border border-ink/15 bg-paper p-5">
          <span className="eyebrow">Pagos emitidos</span>
          <p className="display nums mt-2 text-4xl font-semibold text-ink">
            {list.length}
          </p>
        </div>
      </div>

      <div className="border border-ink/15 bg-paper p-6">
        <div className="mb-4 flex items-center justify-between border-b border-ink/10 pb-3">
          <span className="eyebrow">Historial</span>
        </div>
        {isPending ? (
          <div className="py-12 text-center">
            <span className="eyebrow">Cargando…</span>
          </div>
        ) : list.length === 0 ? (
          <div className="py-12 text-center">
            <span className="eyebrow">Sin pagos todavía</span>
            <p className="mt-2 text-sm text-ink-muted">
              Cuando recibas un pago, aparecerá acá.
            </p>
          </div>
        ) : (
          <ul>
            {list.map((payout) => (
              <li
                key={payout.id}
                className="grid grid-cols-12 items-start gap-3 border-b border-ink/10 py-4"
              >
                <div className="col-span-4">
                  <p className="text-[0.7rem] uppercase tracking-[0.14em] text-ink-muted">
                    {formatDate(payout.createdAt)}
                  </p>
                </div>
                <div className="col-span-5">
                  {payout.notes ? (
                    <p className="text-sm text-ink">“{payout.notes}”</p>
                  ) : (
                    <p className="text-sm text-ink-muted">Sin nota.</p>
                  )}
                  {payout.createdBy ? (
                    <p className="mt-1 text-[0.6rem] uppercase tracking-[0.14em] text-ink-muted">
                      Emitido por {payout.createdBy.fullName}
                    </p>
                  ) : null}
                </div>
                <div className="col-span-3 text-right nums text-xl font-semibold text-brand">
                  {formatCents(payout.amountCents)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
