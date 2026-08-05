import { createFileRoute, isRedirect, redirect } from '@tanstack/react-router'
import { SectionHeading } from '../components/ui'
import { SellerEarningsCard } from '../components/SellerEarningsCard'
import { useCurrentUser, useSellerEarnings } from '../lib/queries'
import { TOKEN_KEY, api } from '../lib/api'
import { isSeller } from '../lib/roles'
import type { AuthUser } from '../lib/types'

export const Route = createFileRoute('/seller/earnings')({
  beforeLoad: async () => {
    if (!localStorage.getItem(TOKEN_KEY)) {
      throw redirect({ to: '/login', search: { next: undefined, ref: undefined } })
    }
    try {
      const { data: me } = await api.get<AuthUser>('/auth/me')
      if (!isSeller(me.role)) throw redirect({ to: '/' })
    } catch (e) {
      if (isRedirect(e)) throw e
      throw redirect({ to: '/login', search: { next: undefined, ref: undefined } })
    }
  },
  component: SellerEarningsPage,
})

function SellerEarningsPage() {
  const { data: me } = useCurrentUser()
  const { data: earnings, isPending } = useSellerEarnings(me?.id ?? null)

  return (
    <div className="page-rise mx-auto max-w-2xl px-6 py-12">
      <SectionHeading eyebrow="Mis ingresos" title="Comisiones" />

      <div className="mt-8">
        {isPending || !earnings ? (
          <p className="text-sm text-ink-muted">Cargando…</p>
        ) : (
          <SellerEarningsCard earnings={earnings} />
        )}
      </div>
    </div>
  )
}
