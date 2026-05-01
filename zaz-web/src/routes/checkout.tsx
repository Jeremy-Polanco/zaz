import { createFileRoute, Link, redirect, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { checkoutSchema, type CheckoutInput } from '../lib/schemas'
import {
  useCreateOrder,
  useMyCredit,
  useMySubscription,
  usePointsBalance,
  useProducts,
  useUpdateMe,
} from '../lib/queries'
import { CheckoutCreditStep } from '../components/CheckoutCreditStep'
import { useCurrentUser } from '../lib/auth'
import { useCart, clearCart } from '../lib/cart'
import { Button, FieldError, Input, Label, Select } from '../components/ui'
import { MapPicker } from '../components/MapPicker'
import { formatCents, formatMoney } from '../lib/utils'
import { TOKEN_KEY } from '../lib/api'
import { requestBrowserLocation, reverseGeocode } from '../lib/geo'


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
  const updateMe = useUpdateMe()

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
  const [locating, setLocating] = useState(false)
  const [locateError, setLocateError] = useState<string | null>(null)

  const form = useForm<CheckoutInput>({
    resolver: zodResolver(checkoutSchema),
    defaultValues: {
      items: cartItems,
      paymentMethod: 'cash',
      deliveryAddress: {
        text: user?.addressDefault?.text ?? '',
        lat: user?.addressDefault?.lat as number | undefined,
        lng: user?.addressDefault?.lng as number | undefined,
      },
      usePoints: false,
      useCredit: false,
    },
  })

  useEffect(() => {
    if (user?.addressDefault) {
      form.setValue('deliveryAddress', {
        text: user.addressDefault.text,
        lat: user.addressDefault.lat as number,
        lng: user.addressDefault.lng as number,
      })
    }
  }, [user, form])

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

  const address = form.watch('deliveryAddress')
  const hasCoords =
    typeof address?.lat === 'number' && typeof address?.lng === 'number'

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

  // Shipping + tax are now quoted by the super admin AFTER the order is placed.
  // The subtotal (minus points) is what we show as the initial total; the real
  // total is displayed on the order detail screen once it lands in "quoted".
  const previewTotalCents = Math.max(0, subtotalCents - pointsAppliedCents - creditAppliedCents)
  const previewTotal = previewTotalCents / 100

  const handleUseMyLocation = async () => {
    setLocateError(null)
    setLocating(true)
    try {
      const coords = await requestBrowserLocation()
      let text = `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`
      try {
        const rev = await reverseGeocode(coords.lat, coords.lng)
        text = rev.text
      } catch {
        // keep coordinate fallback
      }
      form.setValue('deliveryAddress', {
        text,
        lat: coords.lat,
        lng: coords.lng,
      }, { shouldValidate: true })
    } catch (e) {
      setLocateError(
        (e as GeolocationPositionError)?.message ??
          'No pudimos obtener tu ubicación',
      )
    } finally {
      setLocating(false)
    }
  }

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

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      if (
        values.deliveryAddress.lat !== user?.addressDefault?.lat ||
        values.deliveryAddress.lng !== user?.addressDefault?.lng ||
        values.deliveryAddress.text !== user?.addressDefault?.text
      ) {
        updateMe.mutate({ addressDefault: values.deliveryAddress })
      }
    } catch {
      // non-blocking
    }
    const created = await createOrder.mutateAsync({ ...values, usePoints, useCredit })
    clearCart()
    router.navigate({ to: '/orders/$orderId', params: { orderId: created.id } })
  })

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
                  01 · Entrega
                </span>
                <span className="h-px flex-1 bg-ink/15" />
              </div>
              <Label htmlFor="addressText">Dirección de entrega</Label>
              <Input
                id="addressText"
                placeholder="Ej. 1234 Broadway, Washington Heights"
                {...form.register('deliveryAddress.text')}
              />
              <FieldError
                message={form.formState.errors.deliveryAddress?.text?.message}
              />

              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={handleUseMyLocation}
                  disabled={locating}
                >
                  {locating ? 'Ubicando…' : '📍 Usar mi ubicación'}
                </Button>
                {hasCoords ? (
                  <span className="nums text-[0.65rem] uppercase tracking-[0.14em] text-ink-muted">
                    {address!.lat!.toFixed(5)}, {address!.lng!.toFixed(5)}
                  </span>
                ) : (
                  <span className="text-[0.65rem] uppercase tracking-[0.14em] text-bad">
                    Necesitamos tu ubicación para calcular el envío
                  </span>
                )}
              </div>
              {locateError && (
                <p className="mt-2 border-l-2 border-bad pl-3 text-sm text-bad">
                  {locateError}
                </p>
              )}
              <FieldError
                message={
                  form.formState.errors.deliveryAddress?.lat?.message ??
                  form.formState.errors.deliveryAddress?.lng?.message
                }
              />

              <p className="mt-6 mb-2 text-[0.7rem] uppercase tracking-[0.18em] text-ink-muted">
                Ajustá el pin en el mapa para guiar al repartidor
              </p>
              <MapPicker
                value={{
                  lat: form.watch('deliveryAddress.lat'),
                  lng: form.watch('deliveryAddress.lng'),
                }}
                onChange={({ lat, lng }) => {
                  form.setValue('deliveryAddress.lat', lat, { shouldValidate: true })
                  form.setValue('deliveryAddress.lng', lng, { shouldValidate: true })
                }}
              />
            </section>

            <section>
              <div className="mb-4 flex items-center gap-3">
                <span className="text-[0.7rem] uppercase tracking-[0.2em] text-ink-muted">
                  02 · Pago
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
                  04 · Puntos
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
              disabled={createOrder.isPending || !hasCoords}
            >
              {createOrder.isPending
                ? 'Enviando…'
                : `Confirmar pedido · ${formatMoney(previewTotal)} →`}
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
                {isActiveSubscriber ? (
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
                <span className="nums text-sm font-medium italic text-ink-muted">
                  Al cotizar
                </span>
              </div>
            </div>

            <div className="mt-2 flex items-baseline justify-between border-t-2 border-ink pt-4">
              <span className="eyebrow">Subtotal</span>
              <span className="display nums text-3xl font-semibold text-brand">
                {formatMoney(previewTotal)}
              </span>
            </div>

            <p className="mt-4 text-[0.65rem] uppercase tracking-[0.12em] text-ink-muted">
              El repartidor te cotiza el envío y te avisamos para confirmar el
              total.
            </p>
          </div>
        </aside>
      </div>
    </div>
  )
}
