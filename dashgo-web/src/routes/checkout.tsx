import { createFileRoute, Link, redirect, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { checkoutSchema, type CheckoutInput } from '../lib/schemas'
import {
  useCreateAddress,
  useCreateOrder,
  useMyAddresses,
  useMyCredit,
  useMySubscription,
  usePointsBalance,
  useProducts,
} from '../lib/queries'
import type { UserAddress } from '../lib/types'
import { CheckoutCreditStep } from '../components/CheckoutCreditStep'
import { useCurrentUser } from '../lib/auth'
import { useCart, clearCart } from '../lib/cart'
import { Button, FieldError, Input, Label, Select } from '../components/ui'
import { MapPicker } from '../components/MapPicker'
import { formatCents, formatMoney } from '../lib/utils'
import { computeQuotePreviewCents } from '../lib/tax'
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
  const { data: addresses } = useMyAddresses()
  const createOrder = useCreateOrder()
  const createAddress = useCreateAddress()

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

  // ── Saved-address picker state ───────────────────────────────────────────
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null)
  const [adHocMode, setAdHocMode] = useState(false)
  const [smartDefaultRan, setSmartDefaultRan] = useState(false)

  // ── Save-this-address (ad-hoc) state ─────────────────────────────────────
  const [saveAddress, setSaveAddress] = useState(false)
  const [saveAddressLabel, setSaveAddressLabel] = useState('')
  const [saveError, setSaveError] = useState<string | null>(null)

  const form = useForm<CheckoutInput>({
    resolver: zodResolver(checkoutSchema),
    defaultValues: {
      items: cartItems,
      paymentMethod: 'cash',
      deliveryAddress: {
        text: '',
        lat: undefined as number | undefined,
        lng: undefined as number | undefined,
      },
      usePoints: false,
      useCredit: false,
    },
  })

  // Apply a saved address to the form's deliveryAddress field. line1 becomes the
  // submitted text; the saved coords drive shipping + the submit guard.
  const applySavedAddress = (addr: UserAddress) => {
    setSelectedAddressId(addr.id)
    setAdHocMode(false)
    setSaveError(null)
    form.setValue(
      'deliveryAddress',
      { text: addr.line1, lat: addr.lat, lng: addr.lng },
      { shouldValidate: true },
    )
  }

  // ── Smart default ──────────────────────────────────────────────────────────
  // Runs once when the address book arrives. Pre-selects the default address
  // (no GPS prompt on web — that's reserved for the explicit "use my location"
  // button in ad-hoc mode). With no saved addresses, drops straight to ad-hoc.
  useEffect(() => {
    if (smartDefaultRan) return
    if (addresses === undefined) return // still loading
    setSmartDefaultRan(true)
    if (addresses.length === 0) {
      setAdHocMode(true)
      return
    }
    const fallback = addresses.find((a) => a.isDefault) ?? addresses[0]
    if (fallback) applySavedAddress(fallback)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addresses, smartDefaultRan])

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

  // Skip-cotización: when EVERY cart item has requiresQuote=false (e.g. water),
  // the order is auto-quoted at creation — shipping $0, tax computed now. Show
  // the real numbers instead of the "a cotizar" placeholders. Tax base mirrors
  // the backend (subtotal − points, shipping 0); credit reduces what you pay.
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

  const enterAdHoc = () => {
    setAdHocMode(true)
    setSaveError(null)
    form.setValue('deliveryAddress.text', '')
    form.setValue('deliveryAddress.lat', undefined as unknown as number)
    form.setValue('deliveryAddress.lng', undefined as unknown as number)
  }

  const backToSaved = () => {
    const addr =
      addresses?.find((a) => a.id === selectedAddressId) ??
      addresses?.find((a) => a.isDefault) ??
      addresses?.[0]
    if (addr) applySavedAddress(addr)
    else setAdHocMode(false)
  }

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
    // Guard: saving an ad-hoc address requires a label.
    if (adHocMode && saveAddress && !saveAddressLabel.trim()) {
      setSaveError('Ponle un nombre a esta dirección para guardarla')
      return
    }
    setSaveError(null)

    const created = await createOrder.mutateAsync({ ...values, usePoints, useCredit })

    // After the order succeeds, optionally persist the ad-hoc address to the
    // user's address book. Non-blocking: the order is already placed.
    if (adHocMode && saveAddress && saveAddressLabel.trim()) {
      try {
        await createAddress.mutateAsync({
          label: saveAddressLabel.trim(),
          line1: values.deliveryAddress.text,
          lat: values.deliveryAddress.lat,
          lng: values.deliveryAddress.lng,
        })
      } catch {
        // non-blocking — the order completed regardless
      }
    }

    clearCart()
    router.navigate({ to: '/orders/$orderId', params: { orderId: created.id } })
  })

  const savedAddresses = addresses ?? []

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

              {/* Saved-address picker */}
              {!adHocMode && savedAddresses.length > 0 && (
                <fieldset className="flex flex-col gap-2">
                  <legend className="sr-only">Elegí una dirección guardada</legend>
                  {savedAddresses.map((addr) => {
                    const selected = selectedAddressId === addr.id
                    return (
                      <label
                        key={addr.id}
                        className={`flex cursor-pointer items-start gap-3 border px-4 py-3 transition-colors ${
                          selected
                            ? 'border-ink bg-ink text-paper'
                            : 'border-ink/20 bg-paper text-ink hover:border-ink/40'
                        }`}
                      >
                        <input
                          type="radio"
                          name="savedAddress"
                          className="sr-only"
                          checked={selected}
                          onChange={() => applySavedAddress(addr)}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="text-base font-medium">
                              {addr.label}
                            </span>
                            {addr.isDefault && (
                              <span
                                className={`text-[0.6rem] uppercase tracking-[0.14em] ${
                                  selected ? 'text-paper/70' : 'text-brand'
                                }`}
                              >
                                Principal
                              </span>
                            )}
                          </span>
                          <span
                            className={`mt-0.5 block truncate text-sm ${
                              selected ? 'text-paper/70' : 'text-ink-muted'
                            }`}
                          >
                            {addr.line1}
                            {addr.line2 ? `, ${addr.line2}` : ''}
                          </span>
                        </span>
                        <span
                          className={`mt-1 h-4 w-4 shrink-0 rounded-full border-2 ${
                            selected ? 'border-paper bg-paper' : 'border-ink/30'
                          }`}
                        />
                      </label>
                    )
                  })}
                  <div className="mt-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={enterAdHoc}
                    >
                      Usar una dirección diferente →
                    </Button>
                  </div>
                </fieldset>
              )}

              {/* Ad-hoc address form */}
              {adHocMode && (
                <div>
                  {savedAddresses.length > 0 && (
                    <div className="mb-4">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={backToSaved}
                      >
                        ← Volver a mis direcciones
                      </Button>
                    </div>
                  )}
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

                  {/* Save-this-address affordance. The map lives ONLY here — it
                      appears when the user opts to save this as a named address,
                      where pinpointing the exact spot actually matters. A plain
                      order just needs coords from "use my location". */}
                  <div className="mt-5 border-t border-ink/10 pt-4">
                    <label className="flex cursor-pointer items-center gap-3">
                      <input
                        type="checkbox"
                        checked={saveAddress}
                        onChange={(e) => {
                          setSaveAddress(e.target.checked)
                          setSaveError(null)
                        }}
                        className="h-4 w-4 accent-accent"
                      />
                      <span className="text-sm font-medium text-ink">
                        Guardar esta dirección
                      </span>
                    </label>
                    {saveAddress && (
                      <div className="mt-4 flex flex-col gap-4">
                        <div>
                          <Label htmlFor="saveAddressLabel">
                            Nombre de la dirección
                          </Label>
                          <Input
                            id="saveAddressLabel"
                            placeholder="Ej. Casa, Trabajo, Gym"
                            value={saveAddressLabel}
                            onChange={(e) => {
                              setSaveAddressLabel(e.target.value)
                              if (e.target.value.trim()) setSaveError(null)
                            }}
                          />
                          {saveError && <FieldError message={saveError} />}
                        </div>
                        <div>
                          <p className="mb-2 text-[0.7rem] uppercase tracking-[0.18em] text-ink-muted">
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
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
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
