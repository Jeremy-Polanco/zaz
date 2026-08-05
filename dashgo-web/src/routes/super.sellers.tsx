import { createFileRoute, isRedirect, redirect } from '@tanstack/react-router'
import { SectionHeading } from '../components/ui'
import { SellerEarningsCard } from '../components/SellerEarningsCard'
import { useSellersPayable } from '../lib/queries'
import { TOKEN_KEY, api } from '../lib/api'
import { isSuperAdmin } from '../lib/roles'
import { formatCents } from '../lib/utils'
import type { AuthUser } from '../lib/types'

export const Route = createFileRoute('/super/sellers')({
  beforeLoad: async () => {
    if (!localStorage.getItem(TOKEN_KEY)) {
      throw redirect({ to: '/login', search: { next: undefined, ref: undefined } })
    }
    try {
      const { data: me } = await api.get<AuthUser>('/auth/me')
      // Solo super admin: esto es la nómina de comisiones.
      if (!isSuperAdmin(me.role)) throw redirect({ to: '/' })
    } catch (e) {
      if (isRedirect(e)) throw e
      throw redirect({ to: '/login', search: { next: undefined, ref: undefined } })
    }
  },
  component: SuperSellersPage,
})

function SuperSellersPage() {
  const { data: rows, isPending } = useSellersPayable()

  const totalCard = (rows ?? []).reduce(
    (s, r) => s + r.byPaymentMethod.card.claimableCents,
    0,
  )
  const totalCash = (rows ?? []).reduce(
    (s, r) => s + r.byPaymentMethod.cash.claimableCents,
    0,
  )

  return (
    <div className="page-rise mx-auto max-w-5xl px-6 py-12">
      <SectionHeading eyebrow="Vendedores" title="A quién pagar" />

      <div className="mt-6 border-l-[3px] border-accent-dark bg-accent-light px-4 py-3">
        <p className="text-sm text-ink">
          De lo cobrable: <strong className="nums">{formatCents(totalCard)}</strong>{' '}
          viene de pagos con <strong>tarjeta</strong> — esa plata entró a la
          empresa y se les debe. Otros{' '}
          <strong className="nums">{formatCents(totalCash)}</strong> vienen de
          órdenes cobradas <strong>en efectivo</strong>; revisá si esa plata ya
          quedó en mano antes de volver a pagarla.
        </p>
      </div>

      {isPending ? (
        <p className="mt-8 text-sm text-ink-muted">Cargando…</p>
      ) : (rows ?? []).length === 0 ? (
        <div className="mt-8 flex flex-col items-center gap-3 border border-dashed border-ink/15 px-8 py-16 text-center">
          <span className="eyebrow">Sin vendedores</span>
          <p className="text-base text-ink-muted">
            Todavía no hay usuarios con rol Vendedor. Se asigna desde Usuarios.
          </p>
        </div>
      ) : (
        <ul className="mt-8 flex flex-col gap-6">
          {(rows ?? []).map((r) => (
            <li key={r.sellerId} className="border border-ink/15 bg-paper p-4">
              <p className="mb-3 text-base font-semibold text-ink">
                {r.fullName}
              </p>
              <SellerEarningsCard earnings={r} compact />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
