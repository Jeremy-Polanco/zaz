import { createFileRoute, Link, redirect, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { checkoutSchema, type CheckoutInput } from '../lib/schemas'
import {
  useAuthorizeOrder,
  useConfirmNonStripeOrder,
  useCreateOrder,
  useMyCredit,
  useMySubscription,
  useOrders,
  usePointsBalance,
  useProducts,
} from '../lib/queries'
import { CheckoutCreditStep } from '../components/CheckoutCreditStep'
import { CardAuthForm } from '../components/CardAuthForm'
import { useCurrentUser } from '../lib/auth'
import { useCart, clearCart } from '../lib/cart'
import { Button, Label, Select, SectionHeading } from '../components/ui'
import { formatCents, formatMoney } from '../lib/utils'
import { computeQuotePreviewCents } from '../lib/tax'
import { TOKEN_KEY } from '../lib/api'


export const Route = createFileRoute('/checkout')({
  beforeLoad: () => {
    if (!localStorage.getItem(TOKEN_KEY)) throw redirect({ to: '/login', search: { next: undefined, ref: undefined } })
  },
  component: CheckoutPage,
})

function CheckoutPage() {
  const router = useRouter()
  const { data: user } = useCurrentUser()
  const { items: cart, totalItems } = useCart()
  const { data: products } = useProducts()
  const { data: balance } = usePointsBalance()
  const createOrder = useCreateOrder()
  const confirmOrder = useConfirmNonStripeOrder()
  const authorize = useAuthorizeOrder()
  const { data: orders } = useOrders()

  // When a skip-cotización digital order needs card payment, we collect it
  // inline here (no bounce to the order page's "Autorizar" step) — the customer
  // pays and the order is placed in one flow.
  const [inlinePay, setInlinePay] = useState<{
    orderId: string
    clientSecret: string
    amount: number
  } | null>(null)

  // One order at a time: block checkout while a previous order is still in
  // progress (anything not delivered/cancelled). Mirrors the server guard.
  const activeOrder = orders?.find(
    (o) => o.status !== 'delivered' && o.status !== 'cancelled',
  )

  // While we're placing/paying THIS order, the orders query refetches and the
  // just-created (status 'quoted') order would trip the activeOrder guard above
  // — slamming the "ya tenés un pedido en camino" screen in front of the card
  // payment we're mid-way through. Suppress the blocker until the flow settles.
  const placing =
    createOrder.isPending ||
    authorize.isPending ||
    confirmOrder.isPending ||
    inlinePay !== null

  const cartItems = Object.entries(cart).map(([productId, quantity]) => ({
    productId,
    quantity,
  }))

  const [usePoints, setUsePoints] = useState(false)
  const [useCredit, setUseCredit] = useState(false)
  const { data: creditData } = useMyCredit()
  const { data: subscription } = useMySubscription()
  const isActiveSubscriber =
    subscription?.status === 'active' || subscription?.status === 'past_due'

  // The customer no longer provides a delivery address — the colmado captures
  // and pins the location at delivery time. Checkout is just: cart, payment,
  // perks, confirm.
  const form = useForm<CheckoutInput>({
    resolver: zodResolver(checkoutSchema),
    defaultValues: {
      items: cartItems,
      paymentMethod: 'cash',
      usePoints: false,
      useCredit: false,
    },
  })

  useEffect(() => {
    form.setValue('items', cartItems)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalItems])

  useEffect(() => {
    form.setValue('usePoints', usePoints)
  }, [usePoints, form])

  useEffect(() => {
    form.setValue('useCredit', useCredit)
  }, [useCredit, form])

  const subtotalCents = cartItems.reduce((sum, it) => {
    const p = products?.find((x) => x.id === it.productId)
    return sum + (p ? p.effectivePriceCents * it.quantity : 0)
  }, 0)

  const claimableCents = balance?.claimableCents ?? 0
  const pointsAppliedCents = usePoints
    ? Math.min(claimableCents, subtotalCents)
    : 0

  // Credit applied
  const creditAvailable =
    user?.role === 'client' &&
    creditData &&
    creditData.status !== 'overdue' &&
    creditData.balanceCents !== null &&
    creditData.creditLimitCents !== null
      ? creditData.balanceCents + creditData.creditLimitCents
      : 0
  const creditAppliedCents = useCredit && creditAvailable > 0
    ? Math.min(creditAvailable, subtotalCents)
    : 0

  // Shipping + tax are quoted by the super admin AFTER the order is placed.
  // The subtotal (minus points/credit) is the initial total; the real total
  // shows on the order detail screen once it lands in "quoted".
  const previewTotalCents = Math.max(0, subtotalCents - pointsAppliedCents - creditAppliedCents)
  const previewTotal = previewTotalCents / 100

  // Skip-cotización: when EVERY cart item has requiresQuote=false (e.g. water),
  // the order is auto-quoted at creation — shipping $0, tax computed now. Show
  // the real numbers instead of the "a cotizar" placeholders.
  const allSkipQuote =
    cartItems.length > 0 &&
    cartItems.every(
      (it) => products?.find((x) => x.id === it.productId)?.requiresQuote === false,
    )
  const skipQuoteTaxCents = allSkipQuote
    ? computeQuotePreviewCents({
        subtotalCents,
        shippingCents: 0,
        pointsRedeemedCents: pointsAppliedCents,
      }).taxCents
    : 0
  const skipQuoteTotalCents = previewTotalCents + skipQuoteTaxCents

  if (totalItems === 0) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-5 px-6 py-20 text-center">
        <span className="eyebrow">Carrito vacío</span>
        <p className="display text-4xl leading-tight">
          Todavía no elegiste nada.
        </p>
        <Link to="/catalog">
          <Button variant="accent">Ver catálogo →</Button>
        </Link>
      </div>
    )
  }

  if (activeOrder && !placing) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-5 px-6 py-20 text-center">
        <span className="eyebrow">Pedido en curso</span>
        <p className="display text-4xl leading-tight">
          Ya tenés un pedido en camino.
        </p>
        <p className="text-ink-muted">
          Esperá a que se complete para hacer otro. Te avisamos cuando llegue.
        </p>
        <Link to="/orders/$orderId" params={{ orderId: activeOrder.id }}>
          <Button variant="accent">Ver mi pedido →</Button>
        </Link>
      </div>
    )
  }

  const goToOrder = (orderId: string) => {
    clearCart()
    router.navigate({ to: '/orders/$orderId', params: { orderId } })
  }

  const onSubmit = form.handleSubmit(async (values) => {
    const created = await createOrder.mutateAsync({ ...values, usePoints, useCredit })

    // Skip-cotización orders are auto-quoted at creation (status 'quoted'):
    // nothing for the admin to quote, so we finish payment right here instead
    // of bouncing the customer to the order page. Normal orders (status
    // 'pending_quote') still go to the order page to await the admin's quote.
    const isSkipQuote = created.status === 'quoted'
    const totalCents = Math.round(parseFloat(created.totalAmount) * 100)
    const creditCents = Math.round(parseFloat(created.creditApplied ?? '0') * 100)
    const fullCredit = creditCents > 0 && creditCents >= totalCents

    if (isSkipQuote && created.paymentMethod === 'digital' && !fullCredit) {
      // Authorize the card hold and collect payment inline.
      try {
        const intent = await authorize.mutateAsync(created.id)
        setInlinePay({
          orderId: created.id,
          clientSecret: intent.clientSecret,
          amount: intent.amount,
        })
      } catch {
        // Authorization couldn't be prepared — fall back to the order page,
        // where the customer can retry the "Autorizar pago" step.
        goToOrder(created.id)
      }
      return
    }

    if (isSkipQuote && (created.paymentMethod === 'cash' || fullCredit)) {
      // One-click: no card needed (cash, or fully covered by credit). Confirm
      // now so the customer doesn't need a second tap. Non-blocking.
      try {
        await confirmOrder.mutateAsync(created.id)
      } catch {
        // The order screen still offers a manual confirm.
      }
    }

    goToOrder(created.id)
  })

  // Skip-cotización digital order awaiting inline card payment.
  if (inlinePay) {
    return (
      <div className="page-rise mx-auto max-w-xl px-6 py-12">
        <SectionHeading
          eyebrow="Pago"
          title={
            <>
              Pagá con <span className="italic text-brand">tu tarjeta.</span>
            </>
          }
          subtitle="El monto queda retenido y lo cobramos solo cuando te entreguemos el pedido."
        />
        <CardAuthForm
          clientSecret={inlinePay.clientSecret}
          amountCents={inlinePay.amount}
          onAuthorized={() => goToOrder(inlinePay.orderId)}
        />
      </div>
    )
  }

  return (
    <div className="page-rise mx-auto max-w-6xl px-6 py-12">
      <header className="mb-10 border-b border-ink/15 pb-8">
        <span className="eyebrow">Checkout</span>
        <h1 className="display mt-3 text-5xl font-semibold leading-[0.95] tracking-[-0.03em] sm:text-6xl">
          Confirma
          <br />
          <span className="italic text-brand">tu pedido.</span>
        </h1>
      </header>

      <div className="grid grid-cols-1 gap-12 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <form onSubmit={onSubmit} className="flex flex-col gap-8">
            <section>
              <div className="mb-4 flex items-center gap-3">
                <span className="text-[0.7rem] uppercase tracking-[0.2em] text-ink-muted">
                  01 · Pago
                </span>
                <span className="h-px flex-1 bg-ink/15" />
              </div>
              <Label htmlFor="paymentMethod">Método de pago</Label>
              <Select id="paymentMethod" {...form.register('paymentMethod')}>
                <option value="cash">Efectivo al entregar</option>
                <option value="digital">Pago digital</option>
              </Select>
            </section>

            <CheckoutCreditStep
              userRole={user?.role}
              subtotalCents={subtotalCents}
              useCredit={useCredit}
              onToggle={setUseCredit}
            />

            <section>
              <div className="mb-4 flex items-center gap-3">
                <span className="text-[0.7rem] uppercase tracking-[0.2em] text-ink-muted">
                  02 · Puntos
                </span>
                <span className="h-px flex-1 bg-ink/15" />
              </div>
              <div className="border border-ink/15 bg-paper-deep/30 p-5">
                <div className="flex items-baseline justify-between">
                  <span className="eyebrow">Puntos disponibles</span>
                  <span className="display nums text-2xl font-semibold text-brand">
                    {formatCents(claimableCents)}
                  </span>
                </div>
                {claimableCents > 0 ? (
                  <label className="mt-4 flex cursor-pointer items-start gap-3 border-t border-ink/10 pt-4">
                    <input
                      type="checkbox"
                      checked={usePoints}
                      onChange={(e) => setUsePoints(e.target.checked)}
                      className="mt-1 h-4 w-4 accent-accent"
                    />
                    <span>
                      <span className="text-sm font-medium text-ink">
                        Usar todos mis puntos en este pedido
                      </span>
                      <span className="mt-1 block text-[0.65rem] uppercase tracking-[0.14em] text-ink-muted">
                        Redención total: {formatCents(claimableCents)} · reduce base imponible
                      </span>
                    </span>
                  </label>
                ) : (
                  <p className="mt-3 text-[0.65rem] uppercase tracking-[0.14em] text-ink-muted">
                    Todavía no tienes puntos reclamables. Ganá más con tu próximo pedido.
                  </p>
                )}
              </div>
            </section>

            <p className="border-l-2 border-ink/15 pl-3 text-[0.7rem] uppercase tracking-[0.14em] text-ink-muted">
              Coordinamos la entrega con vos — no hace falta cargar dirección.
            </p>

            {createOrder.isError && (
              <p className="border-l-2 border-bad pl-3 text-sm font-medium text-bad">
                {(createOrder.error as Error & {
                  response?: { data?: { message?: string } }
                })?.response?.data?.message ?? 'No se pudo crear el pedido'}
              </p>
            )}

            <Button
              type="submit"
              size="lg"
              variant="accent"
              disabled={createOrder.isPending || confirmOrder.isPending}
            >
              {createOrder.isPending || confirmOrder.isPending
                ? 'Enviando…'
                : `Confirmar pedido · ${allSkipQuote ? formatCents(skipQuoteTotalCents) : formatMoney(previewTotal)} →`}
            </Button>
          </form>
        </div>

        <aside className="lg:col-span-5 lg:sticky lg:top-24 lg:self-start">
          <div className="border border-ink/15 bg-paper p-6">
            <div className="flex items-center justify-between border-b border-ink/10 pb-4">
              <span className="eyebrow">Resumen</span>
              <span className="text-[0.65rem] uppercase tracking-[0.15em] text-ink-muted">
                {cartItems.length} línea{cartItems.length === 1 ? '' : 's'}
              </span>
            </div>

            <ul className="divide-y divide-ink/5">
              {cartItems.map((it) => {
                const p = products?.find((x) => x.id === it.productId)
                if (!p) return null
                const lineCents = p.effectivePriceCents * it.quantity
                return (
                  <li
                    key={it.productId}
                    className="flex items-start justify-between gap-4 py-4"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-base font-medium text-ink">
                          {p.name}
                        </p>
                        {p.offerActive && p.offerLabel ? (
                          <span className="bg-accent px-1.5 py-0.5 text-[0.55rem] uppercase tracking-[0.12em] text-brand-dark">
                            {p.offerLabel}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 nums text-[0.7rem] uppercase tracking-[0.14em] text-ink-muted">
                        {it.quantity} ×{' '}
                        {p.offerActive ? (
                          <>
                            <span className="line-through">
                              {formatCents(p.basePriceCents)}
                            </span>{' '}
                            <span className="text-brand">
                              {formatCents(p.effectivePriceCents)}
                            </span>
                          </>
                        ) : (
                          formatCents(p.effectivePriceCents)
                        )}
                      </p>
                    </div>
                    <span className="nums shrink-0 text-base font-semibold text-ink">
                      {formatCents(lineCents)}
                    </span>
                  </li>
                )
              })}
            </ul>

            <div className="mt-2 space-y-1 border-t border-ink/10 pt-4">
              <div className="flex items-baseline justify-between">
                <span className="text-[0.7rem] uppercase tracking-[0.15em] text-ink-muted">
                  Subtotal
                </span>
                <span className="nums text-sm font-medium text-ink">
                  {formatCents(subtotalCents)}
                </span>
              </div>
              {pointsAppliedCents > 0 && (
                <div className="flex items-baseline justify-between">
                  <span className="text-[0.7rem] uppercase tracking-[0.15em] text-brand">
                    Descuento por puntos
                  </span>
                  <span className="nums text-sm font-medium text-brand">
                    −{formatCents(pointsAppliedCents)}
                  </span>
                </div>
              )}
              {creditAppliedCents > 0 && (
                <div className="flex items-baseline justify-between">
                  <span className="text-[0.7rem] uppercase tracking-[0.15em] text-brand">
                    Crédito aplicado
                  </span>
                  <span className="nums text-sm font-medium text-brand">
                    −{formatCents(creditAppliedCents)}
                  </span>
                </div>
              )}
              <div className="flex items-baseline justify-between">
                <span className="text-[0.7rem] uppercase tracking-[0.15em] text-ink-muted">
                  Envío
                </span>
                {allSkipQuote ? (
                  <span className="nums text-sm font-medium text-green-600">
                    Gratis
                  </span>
                ) : isActiveSubscriber ? (
                  <span className="nums text-sm font-medium text-green-600">
                    Gratis con tu suscripción
                  </span>
                ) : (
                  <span className="nums text-sm font-medium italic text-ink-muted">
                    A cotizar
                  </span>
                )}
              </div>
              {isActiveSubscriber && (
                <p className="text-[0.65rem] uppercase tracking-[0.12em] text-green-600">
                  Envío gratis con tu suscripción
                </p>
              )}
              <div className="flex items-baseline justify-between">
                <span className="text-[0.7rem] uppercase tracking-[0.15em] text-ink-muted">
                  Impuestos
                </span>
                {allSkipQuote ? (
                  <span className="nums text-sm font-medium text-ink">
                    {formatCents(skipQuoteTaxCents)}
                  </span>
                ) : (
                  <span className="nums text-sm font-medium italic text-ink-muted">
                    Al cotizar
                  </span>
                )}
              </div>
            </div>

            <div className="mt-2 flex items-baseline justify-between border-t-2 border-ink pt-4">
              <span className="eyebrow">{allSkipQuote ? 'Total' : 'Subtotal'}</span>
              <span className="display nums text-3xl font-semibold text-brand">
                {allSkipQuote ? formatCents(skipQuoteTotalCents) : formatMoney(previewTotal)}
              </span>
            </div>

            <p className="mt-4 text-[0.65rem] uppercase tracking-[0.12em] text-ink-muted">
              {allSkipQuote
                ? 'Sin cotización — este es el total final. Confirmás y pagás.'
                : 'El repartidor te cotiza el envío y te avisamos para confirmar el total.'}
            </p>
          </div>
        </aside>
      </div>
    </div>
  )
}
