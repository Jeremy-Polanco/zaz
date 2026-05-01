import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'
import { useEffect } from 'react'
import { SectionHeading, Button } from '../components/ui'
import {
  useMySubscription,
  useSubscriptionPlan,
  useCreateCheckoutSession,
  useCreatePortalSession,
  useCancelSubscription,
  useReactivateSubscription,
} from '../lib/queries'
import { formatDate } from '../lib/utils'
import { TOKEN_KEY } from '../lib/api'

export const Route = createFileRoute('/subscription')({
  validateSearch: z.object({
    session: z.enum(['success', 'canceled']).optional(),
  }),
  beforeLoad: () => {
    if (!localStorage.getItem(TOKEN_KEY)) {
      throw redirect({ to: '/login', search: { next: undefined, ref: undefined } })
    }
  },
  component: SubscriptionPage,
})

function SubscriptionPage() {
  const { session } = Route.useSearch()
  const { data: sub, isPending: subPending, refetch } = useMySubscription()
  const { data: plan, isPending: planPending } = useSubscriptionPlan()
  const checkout = useCreateCheckoutSession()
  const portal = useCreatePortalSession()
  const cancel = useCancelSubscription()
  const reactivate = useReactivateSubscription()

  // On return from Stripe (success or cancel), refetch subscription state
  useEffect(() => {
    if (session === 'success' || session === 'canceled') {
      void refetch()
    }
  }, [session, refetch])

  if (subPending || planPending) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-20 text-center">
        <span className="eyebrow">Cargando suscripción…</span>
      </div>
    )
  }

  return (
    <div className="page-rise mx-auto max-w-6xl px-6 py-12">
      <SectionHeading
        eyebrow="Mi plan"
        title={
          <>
            Mi <span className="italic text-brand">suscripción.</span>
          </>
        }
        subtitle="Envío gratis en todos tus pedidos."
      />

      {session === 'success' && (
        <div className="mb-6 border border-green-200 bg-green-50 px-5 py-4">
          <p className="text-sm font-medium text-green-800">
            ¡Suscripción activada! Ya puedes disfrutar del envío gratis.
          </p>
        </div>
      )}

      {sub === null || sub === undefined ? (
        /* No subscription */
        <div className="border border-ink/15 bg-paper p-8">
          <p className="mb-1 text-2xl font-semibold text-ink">
            ${plan ? (plan.priceCents / 100).toFixed(2) : '10.00'} / mes
          </p>
          <p className="mb-6 text-base text-ink-muted">
            Envío gratis en todos tus pedidos. Cancela cuando quieras.
          </p>
          <Button
            variant="accent"
            onClick={() => checkout.mutate({})}
            disabled={checkout.isPending}
          >
            {checkout.isPending ? 'Redirigiendo…' : 'Suscribirme'}
          </Button>
        </div>
      ) : sub.status === 'active' && !sub.cancelAtPeriodEnd ? (
        /* Active, auto-renewing */
        <div className="border border-ink/15 bg-paper p-8">
          <div className="mb-4 flex items-center gap-3">
            <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium uppercase tracking-wide text-green-700">
              Activa
            </span>
          </div>
          <p className="mb-6 text-base text-ink-muted">
            Suscripto al plan · Renueva el {formatDate(sub.currentPeriodEnd)}
          </p>
          <div className="flex flex-wrap gap-3">
            <Button
              variant="secondary"
              onClick={() => portal.mutate()}
              disabled={portal.isPending}
            >
              {portal.isPending ? 'Redirigiendo…' : 'Gestionar suscripción'}
            </Button>
            <Button
              variant="ghost"
              onClick={() => cancel.mutate()}
              disabled={cancel.isPending}
            >
              {cancel.isPending ? 'Cancelando…' : 'Cancelar'}
            </Button>
          </div>
        </div>
      ) : sub.status === 'active' && sub.cancelAtPeriodEnd ? (
        /* Active, cancel scheduled */
        <div className="border border-yellow-200 bg-yellow-50 p-8">
          <p className="mb-2 text-base font-medium text-yellow-800">
            Activo hasta {formatDate(sub.currentPeriodEnd)}, no se renovará.
          </p>
          <p className="mb-6 text-sm text-yellow-700">
            Aún tienes envío gratis hasta esa fecha.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button
              variant="accent"
              onClick={() => reactivate.mutate()}
              disabled={reactivate.isPending}
            >
              {reactivate.isPending ? 'Reactivando…' : 'Reactivar'}
            </Button>
            <Button
              variant="secondary"
              onClick={() => portal.mutate()}
              disabled={portal.isPending}
            >
              Gestionar suscripción
            </Button>
          </div>
        </div>
      ) : sub.status === 'past_due' ? (
        /* Past due */
        <div className="border border-red-200 bg-red-50 p-8">
          <p className="mb-2 text-base font-medium text-red-800">
            Tu pago está pendiente. Actualizá tu medio de pago para seguir con el envío gratis.
          </p>
          <Button
            variant="accent"
            onClick={() => portal.mutate()}
            disabled={portal.isPending}
            className="mt-4"
          >
            {portal.isPending ? 'Redirigiendo…' : 'Gestionar suscripción'}
          </Button>
        </div>
      ) : sub.status === 'canceled' ? (
        /* Canceled */
        <div className="border border-ink/15 bg-paper p-8">
          <p className="mb-6 text-base text-ink-muted">Tu suscripción terminó.</p>
          <Button
            variant="accent"
            onClick={() => checkout.mutate({})}
            disabled={checkout.isPending}
          >
            {checkout.isPending ? 'Redirigiendo…' : 'Suscribirme de nuevo'}
          </Button>
        </div>
      ) : (
        /* incomplete / incomplete_expired / unpaid */
        <div className="border border-ink/15 bg-paper p-8">
          <p className="mb-6 text-base text-ink-muted">
            Tu suscripción no está activa. Gestioná tu cuenta para resolverlo.
          </p>
          <Button
            variant="secondary"
            onClick={() => portal.mutate()}
            disabled={portal.isPending}
          >
            {portal.isPending ? 'Redirigiendo…' : 'Gestionar suscripción'}
          </Button>
        </div>
      )}
    </div>
  )
}
