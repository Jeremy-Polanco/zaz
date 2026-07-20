import { createFileRoute, redirect, Link } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api, TOKEN_KEY } from '../lib/api'
import {
  useAuthorizeOrder,
  useConfirmCashOrder,
  useConfirmNonStripeOrder,
} from '../lib/queries'
import { CardAuthForm } from '../components/CardAuthForm'
import { Button, SectionHeading } from '../components/ui'
import { StatusBadge } from '../components/StatusBadge'
import { formatCents, formatMoney } from '../lib/utils'
import type { AuthorizedIntent, Order } from '../lib/types'

export const Route = createFileRoute('/orders/$orderId/')({
  beforeLoad: () => {
    if (!localStorage.getItem(TOKEN_KEY)) throw redirect({ to: '/login', search: { next: undefined, ref: undefined } })
  },
  component: OrderDetailPage,
})

function useOrder(orderId: string) {
  return useQuery<Order>({
    queryKey: ['order', orderId],
    queryFn: async () => (await api.get<Order>(`/orders/${orderId}`)).data,
    // Poll every 10s while the order might still be transitioning on the
    // admin's side (pending_quote → quoted). This keeps the client in sync
    // without needing websockets.
    refetchInterval: (q) => {
      const status = q.state.data?.status
      if (!status) return 10_000
      const liveStatuses = [
        'pending_quote',
        'quoted',
        'pending_validation',
        'confirmed_by_colmado',
        'in_delivery_route',
      ]
      return liveStatuses.includes(status) ? 10_000 : false
    },
    retry: false,
  })
}

function OrderDetailPage() {
  const { orderId } = Route.useParams()
  const { data: order, isPending, error } = useOrder(orderId)
  const confirmCash = useConfirmCashOrder()
  const confirmNonStripe = useConfirmNonStripeOrder()
  const authorize = useAuthorizeOrder()
  const qc = useQueryClient()
  const [authIntent, setAuthIntent] = useState<AuthorizedIntent | null>(null)
  // Bridges the brief window between a successful client-side card
  // authorization and the webhook flipping the order out of `quoted` (when
  // authorizedAt — the durable truth — gets set). Checkout's inline auth and the
  // recovery form below write `order-paid:<id>` to sessionStorage on success.
  const [justPaid, setJustPaid] = useState(
    () => sessionStorage.getItem(`order-paid:${orderId}`) === '1',
  )

  if (isPending) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-20 text-center">
        <span className="eyebrow">Cargando pedido…</span>
      </div>
    )
  }
  if (error || !order) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-20 text-center">
        <p className="text-bad">No pudimos cargar el pedido.</p>
        <Link to="/orders">
          <Button variant="secondary" className="mt-4">
            Ver mis pedidos
          </Button>
        </Link>
      </div>
    )
  }

  const subtotalCents = Math.round(parseFloat(order.subtotal) * 100)
  const shippingCents = Math.round(parseFloat(order.shipping) * 100)
  const taxCents = Math.round(parseFloat(order.tax) * 100)
  const pointsCents = Math.round(parseFloat(order.pointsRedeemed) * 100)
  const totalCents = Math.round(parseFloat(order.totalAmount) * 100)
  const creditAppliedCents = Math.round(
    parseFloat(order.creditApplied ?? '0') * 100,
  )
  // CRIT-2: when credit covers the whole quoted total, the order must NOT be
  // routed through Stripe authorize. Use >= to absorb any rounding noise.
  const isFullCredit =
    creditAppliedCents > 0 && creditAppliedCents >= totalCents
  const stripeAmountCents = Math.max(0, totalCents - creditAppliedCents)

  const onConfirmCash = async () => {
    await confirmCash.mutateAsync(order.id)
  }

  const onConfirmFullCredit = async () => {
    await confirmNonStripe.mutateAsync(order.id)
  }

  const onAuthorize = async () => {
    const res = await authorize.mutateAsync(order.id)
    setAuthIntent(res)
  }

  return (
    <div className="page-rise mx-auto max-w-3xl px-6 py-12">
      <SectionHeading
        eyebrow={`Pedido · ${order.id.slice(0, 8)}`}
        title={
          <>
            Tu <span className="italic text-brand">pedido</span>
          </>
        }
      />

      <div className="mb-8 flex items-center gap-3">
        <StatusBadge
          status={order.status}
          label={
            order.status === 'quoted'
              ? order.paymentMethod === 'digital'
                ? 'Por pagar'
                : 'Por confirmar'
              : undefined
          }
        />
        <span className="text-[0.7rem] uppercase tracking-[0.14em] text-ink-muted">
          {order.paymentMethod === 'cash' ? 'Pago en efectivo' : 'Pago digital'}
        </span>
      </div>

      {order.status === 'pending_quote' && (
        <div className="mb-8 border-l-4 border-accent bg-accent/5 p-5">
          <p className="display text-xl font-semibold">
            Esperando cotización del repartidor…
          </p>
          <p className="mt-2 text-sm text-ink-soft">
            Ya vimos tu pedido. En breve te mandamos el costo del envío. Esta
            página se actualiza sola.
          </p>
        </div>
      )}

      {order.status === 'quoted' && order.paymentMethod === 'cash' && (
        <div className="mb-8 border-l-4 border-accent bg-accent/5 p-5">
          <p className="display text-xl font-semibold">
            Total — {formatCents(totalCents)}
          </p>
          <p className="mt-2 text-sm text-ink-soft">
            Confirma tu pedido y el repartidor sale a entregártelo. Pagas en
            efectivo al recibir.
          </p>
          <Button
            variant="accent"
            size="lg"
            onClick={onConfirmCash}
            disabled={confirmCash.isPending}
            className="mt-4"
          >
            {confirmCash.isPending
              ? 'Confirmando…'
              : `Confirmar pedido · ${formatCents(totalCents)} →`}
          </Button>
          {confirmCash.isError && (
            <p className="mt-3 text-sm text-bad">
              No pudimos confirmar el pedido. Intentá de nuevo.
            </p>
          )}
        </div>
      )}

      {order.status === 'quoted' &&
        order.paymentMethod === 'digital' &&
        isFullCredit && (
          <div className="mb-8 border-l-4 border-accent bg-accent/5 p-5">
            <p className="display text-xl font-semibold">
              Total — {formatCents(totalCents)}
            </p>
            <p className="mt-2 text-sm text-ink-soft">
              Este pedido se cubre 100% con tu crédito —{' '}
              {formatCents(creditAppliedCents)}. No se requiere pago con
              tarjeta.
            </p>
            <Button
              variant="accent"
              size="lg"
              onClick={onConfirmFullCredit}
              disabled={confirmNonStripe.isPending}
              className="mt-4"
            >
              {confirmNonStripe.isPending
                ? 'Confirmando…'
                : `Confirmar pedido · ${formatCents(totalCents)} →`}
            </Button>
            {confirmNonStripe.isError && (
              <p className="mt-3 text-sm text-bad">
                No pudimos confirmar el pedido. Intentá de nuevo.
              </p>
            )}
          </div>
        )}

      {/*
        Skip-cotización digital order whose card WAS authorized — show a
        processing state (no pay button) while the webhook advances quoted →
        pending_validation → confirmed. Gated on REAL authorization: authorizedAt
        (the webhook's durable signal) or justPaid (the in-flight window right
        after a successful client-side auth). NOT on stripePaymentIntentId — an
        intent exists the moment we prepare payment, BEFORE the customer
        authorizes, so keying off it told "ya autorizamos" to people who never
        actually paid (e.g. abandoned the card sheet).
      */}
      {(order.status === 'quoted' || order.status === 'pending_validation') &&
        order.paymentMethod === 'digital' &&
        !isFullCredit &&
        order.skipQuote &&
        (order.authorizedAt || justPaid) && (
          <div className="mb-8 border-l-4 border-accent bg-accent/5 p-5">
            <p className="display text-xl font-semibold">Procesando tu pago…</p>
            <p className="mt-2 text-sm text-ink-soft">
              Ya autorizamos el cobro en tu tarjeta. Estamos confirmando tu
              pedido — esta página se actualiza sola.
            </p>
          </div>
        )}

      {/*
        Recovery: a skip-cotización order that is NOT authorized yet — the
        customer abandoned the inline payment, whether or not an intent was
        already prepared. Let them finish here instead of getting stuck on a
        misleading "procesando". Re-authorizing is safe: the intent is created
        with a stable idempotency key (order_<id>_intent), so it returns the same
        PaymentIntent rather than a second charge.
      */}
      {order.status === 'quoted' &&
        order.paymentMethod === 'digital' &&
        !isFullCredit &&
        order.skipQuote &&
        !order.authorizedAt &&
        !justPaid && (
          <div className="mb-8 border-l-4 border-accent bg-accent/5 p-5">
            <p className="display text-xl font-semibold">
              Completá tu pago — total {formatCents(totalCents)}
            </p>
            {creditAppliedCents > 0 && (
              <p className="mt-2 text-sm text-brand">
                Crédito aplicado: −{formatCents(creditAppliedCents)} · Pago con
                tarjeta: {formatCents(stripeAmountCents)}
              </p>
            )}
            <p className="mt-2 text-sm text-ink-soft">
              Quedó un paso pendiente. Autorizá el cobro en tu tarjeta — el monto
              queda retenido y lo cobramos solo cuando te entreguemos el pedido.
            </p>
            {!authIntent ? (
              <Button
                variant="accent"
                size="lg"
                onClick={onAuthorize}
                disabled={authorize.isPending}
                className="mt-4"
              >
                {authorize.isPending
                  ? 'Preparando…'
                  : `Pagar ahora · ${formatCents(stripeAmountCents)} →`}
              </Button>
            ) : (
              <CardAuthForm
                clientSecret={authIntent.clientSecret}
                amountCents={stripeAmountCents}
                returnUrl={`${window.location.origin}/orders/${order.id}`}
                onAuthorized={() => {
                  sessionStorage.setItem(`order-paid:${order.id}`, '1')
                  setJustPaid(true)
                  qc.invalidateQueries({ queryKey: ['order', order.id] })
                  qc.invalidateQueries({ queryKey: ['orders'] })
                }}
              />
            )}
          </div>
        )}

      {/*
        Normal (quote-required) digital orders: shipping is quoted by the admin
        AFTER the order is placed, so the customer authorizes payment here once
        the quote lands. This is the intended flow for these orders.
      */}
      {order.status === 'quoted' &&
        order.paymentMethod === 'digital' &&
        !isFullCredit &&
        !order.skipQuote && (
        <div className="mb-8 border-l-4 border-accent bg-accent/5 p-5">
          <p className="display text-xl font-semibold">
            Total a pagar — {formatCents(totalCents)}
          </p>
          {creditAppliedCents > 0 && (
            <p className="mt-2 text-sm text-brand">
              Crédito aplicado: −{formatCents(creditAppliedCents)} · Pago con
              tarjeta: {formatCents(stripeAmountCents)}
            </p>
          )}
          <p className="mt-2 text-sm text-ink-soft">
            Autorizá el cobro en tu tarjeta. El monto queda retenido y lo
            cobramos solo cuando te entreguemos el pedido.
          </p>
          {!authIntent ? (
            <Button
              variant="accent"
              size="lg"
              onClick={onAuthorize}
              disabled={authorize.isPending}
              className="mt-4"
            >
              {authorize.isPending
                ? 'Preparando…'
                : `Pagar · ${formatCents(stripeAmountCents)} →`}
            </Button>
          ) : (
            <CardAuthForm
              clientSecret={authIntent.clientSecret}
              amountCents={stripeAmountCents}
              returnUrl={`${window.location.origin}/orders/${order.id}`}
              onAuthorized={() => {
                // Webhook moves the order to PENDING_VALIDATION (and auto-confirms
                // skip-quote orders). Refetch so the UI reflects the new status.
                qc.invalidateQueries({ queryKey: ['order', order.id] })
                qc.invalidateQueries({ queryKey: ['orders'] })
              }}
            />
          )}
        </div>
      )}

      {(order.status === 'confirmed_by_colmado' ||
        order.status === 'in_delivery_route') && (
        <div className="mb-8 border-l-4 border-ink bg-paper-deep/40 p-5">
          <p className="display text-xl font-semibold">
            {order.status === 'confirmed_by_colmado' &&
              'Listo para salir a entregar.'}
            {order.status === 'in_delivery_route' && 'En camino a tu puerta.'}
          </p>
        </div>
      )}

      {order.status === 'delivered' && (
        <div className="mb-8">
          <Link
            to="/orders/$orderId/invoice"
            params={{ orderId: order.id }}
            className="text-sm font-medium text-accent hover:underline"
          >
            Ver factura ↗
          </Link>
        </div>
      )}

      <section className="border border-ink/15 bg-paper p-6">
        <span className="eyebrow">Resumen</span>
        <h2 className="display mt-2 text-2xl font-semibold">
          {order.items.length} producto
          {order.items.length === 1 ? '' : 's'}
        </h2>
        <ul className="mt-4 divide-y divide-ink/10 border-t border-ink/10">
          {order.items.map((it) => (
            <li
              key={it.id}
              className="flex items-center justify-between gap-4 py-3"
            >
              <div className="flex items-baseline gap-2">
                <span className="nums font-semibold text-ink">
                  {it.quantity}×
                </span>
                <span className="text-ink-soft">
                  {it.product?.name ?? it.productId.slice(0, 8)}
                </span>
              </div>
              <span className="nums text-sm font-medium">
                {formatMoney(
                  (parseFloat(it.priceAtOrder) * it.quantity).toFixed(2),
                )}
              </span>
            </li>
          ))}
        </ul>

        <div className="mt-6 space-y-1 border-t border-ink/10 pt-4 text-sm">
          <div className="flex justify-between">
            <span className="text-ink-muted">Subtotal</span>
            <span className="nums">{formatCents(subtotalCents)}</span>
          </div>
          {pointsCents > 0 && (
            <div className="flex justify-between">
              <span className="text-brand">Puntos</span>
              <span className="nums text-brand">
                −{formatCents(pointsCents)}
              </span>
            </div>
          )}
          {creditAppliedCents > 0 && (
            <div className="flex justify-between">
              <span className="text-brand">Crédito aplicado</span>
              <span className="nums text-brand">
                −{formatCents(creditAppliedCents)}
              </span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-ink-muted">Envío</span>
            <span className="nums">
              {order.status === 'pending_quote' ? (
                <span className="italic text-ink-muted">A cotizar</span>
              ) : (
                formatCents(shippingCents)
              )}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-ink-muted">Impuestos</span>
            <span className="nums">
              {order.status === 'pending_quote' ? (
                <span className="italic text-ink-muted">Al cotizar</span>
              ) : (
                formatCents(taxCents)
              )}
            </span>
          </div>
          {parseFloat(order.tip ?? '0') > 0 && (
            <div className="flex justify-between">
              <span className="text-ink-muted">Propina</span>
              <span className="nums">
                {formatCents(Math.round(parseFloat(order.tip!) * 100))}
              </span>
            </div>
          )}
          <div className="flex items-baseline justify-between border-t-2 border-ink pt-3 mt-3">
            <span className="eyebrow">Total</span>
            <span className="display nums text-2xl font-semibold text-brand">
              {order.status === 'pending_quote' ? (
                <span className="italic text-ink-muted">A cotizar</span>
              ) : (
                formatCents(totalCents)
              )}
            </span>
          </div>
        </div>
      </section>
    </div>
  )
}
