import { useEffect, useState } from 'react'
import {
  useAdminSubscriptionPlans,
  useCreateSubscriptionPlan,
  useUpdateSubscriptionPlan,
} from '../lib/queries'
import { Button, FieldError, Input, Label } from './ui'
import { computeGrossCents } from '../lib/tax'
import { serverMessage } from '../lib/utils'

const fmt = (cents: number) => `$${(cents / 100).toFixed(2)}`

/**
 * Plan Premium: crear el plan si no existe, o editarle el precio.
 *
 * El monto que se carga es el NETO. Al cliente se le cobra neto + impuesto, y
 * la tarjeta muestra los dos números todo el tiempo — cargar 29.99 pensando que
 * el cliente ve 29.99 es el malentendido caro de esta pantalla.
 */
export function PremiumPlanCard() {
  const { data: plans, isPending } = useAdminSubscriptionPlans()
  const create = useCreateSubscriptionPlan()
  const update = useUpdateSubscriptionPlan()
  const [priceText, setPriceText] = useState('29.99')
  const [error, setError] = useState<string | null>(null)

  const premium = plans?.find((p) => p.tier === 'premium')

  // El campo se siembra con el precio guardado cuando llega el plan. Va en un
  // efecto y no en el render: setear estado durante el render funciona por
  // accidente y se rompe apenas alguien agrega otra condición.
  useEffect(() => {
    if (!premium) return
    setPriceText((premium.unitAmountCents / 100).toFixed(2))
  }, [premium?.id, premium?.unitAmountCents])

  const netCents = Math.round(parseFloat(priceText || '0') * 100)
  const previewGross = Number.isFinite(netCents) ? computeGrossCents(netCents) : 0
  const pending = create.isPending || update.isPending

  const onSubmit = async () => {
    setError(null)
    const net = parseFloat(priceText)
    if (!Number.isFinite(net) || net < 1 || net > 1000) {
      setError('Ingresá un precio entre $1.00 y $1000.00')
      return
    }
    const unitAmountCents = Math.round(net * 100)
    try {
      if (premium) {
        await update.mutateAsync({ unitAmountCents, tier: 'premium' })
      } else {
        await create.mutateAsync({ tier: 'premium', unitAmountCents })
      }
    } catch (e) {
      setError(serverMessage(e, 'No se pudo guardar el plan Premium.'))
    }
  }

  if (isPending) {
    return <p className="py-6 text-sm text-ink-muted">Cargando planes…</p>
  }

  return (
    <section className="mt-10 border border-ink/15 bg-paper p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="display text-xl font-semibold text-ink">Plan Premium</h2>
        {premium ? (
          <span className="nums text-sm text-ink-muted">
            Hoy: {fmt(premium.unitAmountCents)} + impuesto ={' '}
            <strong className="text-ink">{fmt(premium.grossAmountCents)}</strong>
          </span>
        ) : (
          <span className="text-[0.7rem] uppercase tracking-[0.12em] text-ink-muted">
            Sin configurar
          </span>
        )}
      </div>

      {!premium ? (
        <p className="mt-3 border-l-[3px] border-accent-dark bg-accent-light px-3 py-2 text-sm text-ink">
          Todavía no existe. Al guardarlo se crea un producto y un precio{' '}
          <strong>reales en Stripe</strong> — no es un borrador.
        </p>
      ) : null}

      <div className="mt-5 max-w-xs">
        <Label htmlFor="premiumPrice">Precio mensual (neto)</Label>
        <div className="flex items-center border border-ink/15 bg-paper">
          <span className="border-r border-ink/15 px-3 py-2.5 text-sm text-ink-muted">
            $
          </span>
          <Input
            id="premiumPrice"
            type="number"
            step="0.01"
            min="1"
            value={priceText}
            onChange={(e) => setPriceText(e.target.value)}
            className="nums flex-1 border-0 bg-transparent px-3 py-2.5 text-sm text-ink outline-none"
          />
          <span className="px-3 py-2.5 text-[0.65rem] uppercase tracking-[0.10em] text-ink-muted">
            USD
          </span>
        </div>
        <FieldError message={error ?? undefined} />
        <p className="mt-2 text-[0.75rem] text-ink-muted">
          El cliente va a pagar{' '}
          <strong className="nums text-ink">{fmt(previewGross)}</strong> por mes
          (lo que cargás, más el impuesto).
        </p>
      </div>

      <div className="mt-5">
        <Button onClick={onSubmit} disabled={pending}>
          {pending
            ? 'Guardando…'
            : premium
              ? 'Actualizar precio'
              : 'Crear plan Premium'}
        </Button>
      </div>

      <p className="mt-4 text-[0.7rem] leading-snug text-ink-muted">
        El producto alquilado que viene incluido se marca desde{' '}
        <strong>Productos</strong>, con el switch “Exclusivo del plan Premium”.
        Al activarse una suscripción premium, su orden de instalación se crea y
        se entrega sola — eso es lo que arranca el mantenimiento.
      </p>
    </section>
  )
}
