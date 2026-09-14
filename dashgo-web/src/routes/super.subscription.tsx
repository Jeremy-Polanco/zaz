import {
  createFileRoute,
  isRedirect,
  redirect,
} from '@tanstack/react-router'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { TOKEN_KEY, api } from '../lib/api'
import type { AuthUser } from '../lib/types'
import {
  useAdminSubscriptionPlan,
  useShippingRate,
  useUpdateShippingRate,
  useUpdateSubscriptionPlan,
} from '../lib/queries'
import { Button, FieldError, Input, Label, SectionHeading } from '../components/ui'
import { PremiumPlanCard } from '../components/PremiumPlanCard'
import type { AdminPlanResponse, ShippingRate } from '../lib/types'
import { TAX_RATE, computeGrossCents } from '../lib/tax'

const TAX_PERCENT_LABEL = `${(TAX_RATE * 100).toFixed(3).replace(/\.?0+$/, '')}%`

// ── Route definition ───────────────────────────────────────────────────────────

export const Route = createFileRoute('/super/subscription')({
  beforeLoad: async () => {
    if (!localStorage.getItem(TOKEN_KEY)) {
      throw redirect({ to: '/login', search: { next: undefined, ref: undefined } })
    }
    try {
      const { data: me } = await api.get<AuthUser>('/auth/me')
      if (me.role !== 'super_admin_delivery') throw redirect({ to: '/' })
    } catch (e) {
      if (isRedirect(e)) throw e
      throw redirect({ to: '/login', search: { next: undefined, ref: undefined } })
    }
  },
  component: SuperSubscriptionPage,
})

// ── Zod schema (dollars; API gets cents after conversion) ──────────────────────

const priceSchema = z.object({
  priceDollars: z
    .number({ error: 'Ingresa un número válido' })
    .positive({ message: 'El precio debe ser mayor a cero' })
    .min(1, { message: 'El precio mínimo es $1.00' })
    .max(1000, { message: 'El precio máximo es $1000.00' })
    .multipleOf(0.01, { message: 'Máximo 2 decimales' }),
})

type FormValues = z.infer<typeof priceSchema>

// General delivery rate (dollars; API gets cents after conversion). 0 is a
// valid rate (free shipping), so no .positive()/.min(1) like the price form.
const shippingRateSchema = z.object({
  shippingDollars: z
    .number({ error: 'Ingresa un número válido' })
    .min(0, { message: 'La tarifa mínima es $0.00' })
    .max(100, { message: 'La tarifa máxima es $100.00' })
    .multipleOf(0.01, { message: 'Máximo 2 decimales' }),
})

type ShippingFormValues = z.infer<typeof shippingRateSchema>

// ── Page component ─────────────────────────────────────────────────────────────

// Exported so super.subscription.test.tsx renders THIS component instead of a
// test-local copy of its logic — a copy passes while production breaks.
export function SuperSubscriptionPage() {
  const { data: plan, isPending } = useAdminSubscriptionPlan()
  const mutation = useUpdateSubscriptionPlan()

  const { register, handleSubmit, formState, reset, control } = useForm<FormValues>({
    resolver: zodResolver(priceSchema),
    defaultValues: {
      priceDollars: plan ? plan.unitAmountCents / 100 : 10,
    },
  })

  // Live preview of the tax-inclusive price as the admin types the net amount.
  const watchedDollars = useWatch({ control, name: 'priceDollars' })
  const previewGrossDollars =
    typeof watchedDollars === 'number' && Number.isFinite(watchedDollars)
      ? (computeGrossCents(Math.round(watchedDollars * 100)) / 100).toFixed(2)
      : null

  // General delivery rate — every order pays it, subscribers included (see
  // useShippingRate in lib/queries). Kept in its own form: it's independent
  // of the subscription price and shouldn't block on/reset with it.
  const shippingRate = useShippingRate()
  const updateShippingRate = useUpdateShippingRate()
  const {
    register: registerShipping,
    handleSubmit: handleSubmitShipping,
    formState: shippingFormState,
    reset: resetShipping,
  } = useForm<ShippingFormValues>({
    resolver: zodResolver(shippingRateSchema),
    defaultValues: {
      shippingDollars: shippingRate.data
        ? shippingRate.data.shippingCents / 100
        : 5,
    },
  })

  const onSubmitShipping = (values: ShippingFormValues) => {
    updateShippingRate.mutate(
      { shippingCents: Math.round(values.shippingDollars * 100) },
      {
        onSuccess: (updated: ShippingRate) => {
          resetShipping({ shippingDollars: updated.shippingCents / 100 })
        },
      },
    )
  }

  if (isPending) {
    return (
      <div className="page-rise mx-auto max-w-3xl px-6 py-12">
        <div className="py-20 text-center">
          <span className="eyebrow">Cargando…</span>
        </div>
      </div>
    )
  }

  const currentDollars = plan
    ? (plan.unitAmountCents / 100).toFixed(2)
    : '—'
  const currentGrossDollars = plan
    ? (plan.grossAmountCents / 100).toFixed(2)
    : '—'

  const onSubmit = (values: FormValues) => {
    mutation.mutate(
      {
        unitAmountCents: Math.round(values.priceDollars * 100),
      },
      {
        onSuccess: (updated: AdminPlanResponse) => {
          reset({
            priceDollars: updated.unitAmountCents / 100,
          })
        },
      },
    )
  }

  return (
    <div className="page-rise mx-auto max-w-3xl px-6 py-12">
      <SectionHeading
        eyebrow="Super admin"
        title={
          <>
            Precios <span className="italic text-brand">y envío.</span>
          </>
        }
        subtitle="Precio del plan de suscripción y tarifa de envío."
      />

      {/* Current value display */}
      <div className="mb-8 border border-ink/15 bg-paper px-6 py-5">
        <p className="text-[10px] uppercase tracking-wide text-ink-muted mb-1">
          Precio mensual actual (sin impuestos)
        </p>
        <p className="text-3xl font-semibold tabular-nums text-ink" data-testid="current-price">
          ${currentDollars}
        </p>
        <p className="mt-2 text-sm text-ink" data-testid="current-gross-price">
          Se cobra <span className="font-semibold tabular-nums">${currentGrossDollars}</span>
          <span className="text-ink-muted"> (incluye {TAX_PERCENT_LABEL} de impuestos)</span>
        </p>
        {plan && (
          <p className="mt-1 text-sm text-ink-muted">
            {plan.currency.toUpperCase()} / {plan.interval === 'month' ? 'mes' : plan.interval}
          </p>
        )}
      </div>

      {/* Update form */}
      <div className="border border-ink/15 bg-paper p-6">
        <h2 className="eyebrow mb-4">Actualizar precio</h2>

        {mutation.isError && mutation.error && (
          <div
            role="alert"
            data-testid="mutation-error"
            className="mb-4 rounded-xs border border-bad/30 bg-bad/5 px-4 py-3 text-sm text-bad"
          >
            {(mutation.error as { message: string }).message}
          </div>
        )}

        {mutation.isSuccess && (
          <div
            role="status"
            className="mb-4 rounded-xs border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800"
          >
            Precio actualizado correctamente.
          </div>
        )}

        {/* noValidate — the input carries min/max/step for keyboard affordances
            (steppers, numeric keypad), but the browser's native constraint
            validation would block the submit before zod runs, replacing our
            Spanish messages with the browser's own localized tooltip. zod owns
            the rules; the attributes stay for the input UX. */}
        <form
          noValidate
          onSubmit={handleSubmit(onSubmit)}
          className="flex flex-col gap-5"
        >
          <div>
            <Label htmlFor="priceDollars">Precio mensual (USD)</Label>
            <Input
              id="priceDollars"
              type="number"
              step="0.01"
              min="1"
              max="1000"
              placeholder="10.00"
              data-testid="price-input"
              {...register('priceDollars', { valueAsNumber: true })}
            />
            {formState.errors.priceDollars && (
              <FieldError
                message={formState.errors.priceDollars.message}
              />
            )}
            {previewGrossDollars && !formState.errors.priceDollars && (
              <p className="mt-2 text-sm text-ink-muted" data-testid="gross-preview">
                Se cobrará{' '}
                <span className="font-semibold text-ink tabular-nums">
                  ${previewGrossDollars}
                </span>{' '}
                / mes (incluye {TAX_PERCENT_LABEL} de impuestos)
              </p>
            )}
          </div>

          <div className="flex items-center gap-4">
            <Button
              type="submit"
              disabled={mutation.isPending || formState.isSubmitting}
              data-testid="submit-btn"
            >
              {mutation.isPending ? 'Guardando…' : 'Guardar'}
            </Button>
            {mutation.isPending && (
              <span className="text-sm text-ink-muted">Procesando…</span>
            )}
          </div>
        </form>
      </div>

      {/* Tarifa de envío general — el flat fee que paga todo pedido nuevo. */}
      <div className="mt-8 border border-ink/15 bg-paper p-6">
        <h2 className="eyebrow mb-4">Tarifa de envío</h2>

        <p className="mb-4 text-sm text-ink" data-testid="current-shipping-rate">
          Envío por pedido actual:{' '}
          <span className="font-semibold tabular-nums">
            {shippingRate.isPending
              ? '…'
              : `$${((shippingRate.data?.shippingCents ?? 500) / 100).toFixed(2)}`}
          </span>
        </p>

        {updateShippingRate.isError && updateShippingRate.error && (
          <div
            role="alert"
            data-testid="shipping-mutation-error"
            className="mb-4 rounded-xs border border-bad/30 bg-bad/5 px-4 py-3 text-sm text-bad"
          >
            {(updateShippingRate.error as { message: string }).message}
          </div>
        )}

        {updateShippingRate.isSuccess && (
          <div
            role="status"
            className="mb-4 rounded-xs border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800"
          >
            Tarifa actualizada correctamente.
          </div>
        )}

        {/* noValidate — same reasoning as the price form above: zod owns the
            Spanish messages, native constraint validation would hide them. */}
        <form
          noValidate
          onSubmit={handleSubmitShipping(onSubmitShipping)}
          className="flex flex-col gap-5"
        >
          <div>
            <Label htmlFor="shippingDollars">Tarifa de envío (USD)</Label>
            <Input
              id="shippingDollars"
              type="number"
              step="0.01"
              min="0"
              max="100"
              placeholder="5.00"
              data-testid="shipping-input"
              {...registerShipping('shippingDollars', { valueAsNumber: true })}
            />
            {shippingFormState.errors.shippingDollars && (
              <FieldError
                message={shippingFormState.errors.shippingDollars.message}
              />
            )}
          </div>

          <div className="flex items-center gap-4">
            <Button
              type="submit"
              disabled={updateShippingRate.isPending || shippingFormState.isSubmitting}
              data-testid="shipping-submit-btn"
            >
              {updateShippingRate.isPending ? 'Guardando…' : 'Guardar tarifa'}
            </Button>
            {updateShippingRate.isPending && (
              <span className="text-sm text-ink-muted">Procesando…</span>
            )}
          </div>

          <p className="text-xs text-ink-muted">
            Se aplica a todos los pedidos nuevos, suscriptores incluidos. Los
            pedidos ya creados no cambian.
          </p>
        </form>
      </div>

      <PremiumPlanCard />
    </div>
  )
}
