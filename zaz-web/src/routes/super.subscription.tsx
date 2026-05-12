import {
  createFileRoute,
  isRedirect,
  redirect,
} from '@tanstack/react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { TOKEN_KEY, api } from '../lib/api'
import type { AuthUser } from '../lib/types'
import {
  useAdminSubscriptionPlan,
  useUpdateSubscriptionPlan,
} from '../lib/queries'
import { Button, FieldError, Input, Label, SectionHeading } from '../components/ui'
import type { AdminPlanResponse } from '../lib/types'

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
  purchasePriceDollars: z
    .number({ error: 'Ingresa un número válido' })
    .min(0, { message: 'No puede ser negativo' })
    .max(1000, { message: 'El precio máximo es $1000.00' })
    .multipleOf(0.01, { message: 'Máximo 2 decimales' }),
  lateFeeDollars: z
    .number({ error: 'Ingresa un número válido' })
    .min(0, { message: 'No puede ser negativo' })
    .max(1000, { message: 'El precio máximo es $1000.00' })
    .multipleOf(0.01, { message: 'Máximo 2 decimales' }),
})

type FormValues = z.infer<typeof priceSchema>

// ── Page component ─────────────────────────────────────────────────────────────

function SuperSubscriptionPage() {
  const { data: plan, isPending } = useAdminSubscriptionPlan()
  const mutation = useUpdateSubscriptionPlan()

  const { register, handleSubmit, formState, reset } = useForm<FormValues>({
    resolver: zodResolver(priceSchema),
    defaultValues: {
      priceDollars: plan ? plan.unitAmountCents / 100 : 10,
      purchasePriceDollars: plan ? plan.purchasePriceCents / 100 : 0,
      lateFeeDollars: plan ? plan.lateFeeCents / 100 : 0,
    },
  })

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

  const currentPurchaseDollars = plan
    ? (plan.purchasePriceCents / 100).toFixed(2)
    : '—'

  const currentLateFeeDollars = plan
    ? (plan.lateFeeCents / 100).toFixed(2)
    : '—'

  const onSubmit = (values: FormValues) => {
    mutation.mutate(
      {
        unitAmountCents: Math.round(values.priceDollars * 100),
        purchasePriceCents: Math.round(values.purchasePriceDollars * 100),
        lateFeeCents: Math.round(values.lateFeeDollars * 100),
      },
      {
        onSuccess: (updated: AdminPlanResponse) => {
          reset({
            priceDollars: updated.unitAmountCents / 100,
            purchasePriceDollars: updated.purchasePriceCents / 100,
            lateFeeDollars: updated.lateFeeCents / 100,
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
            Suscripción <span className="italic text-brand">plan.</span>
          </>
        }
        subtitle="Actualiza el precio del plan de suscripción mensual."
      />

      {/* Current values display */}
      <div className="mb-8 grid grid-cols-3 gap-4">
        <div className="border border-ink/15 bg-paper px-6 py-5">
          <p className="text-[10px] uppercase tracking-wide text-ink-muted mb-1">
            Alquiler mensual
          </p>
          <p className="text-3xl font-semibold tabular-nums text-ink" data-testid="current-price">
            ${currentDollars}
          </p>
          {plan && (
            <p className="mt-1 text-sm text-ink-muted">
              {plan.currency.toUpperCase()} / {plan.interval === 'month' ? 'mes' : plan.interval}
              {' · '}
              <span className="font-mono text-xs">{plan.activeStripePriceId}</span>
            </p>
          )}
        </div>
        <div className="border border-ink/15 bg-paper px-6 py-5">
          <p className="text-[10px] uppercase tracking-wide text-ink-muted mb-1">
            Precio de compra
          </p>
          <p className="text-3xl font-semibold tabular-nums text-ink" data-testid="current-purchase-price">
            ${currentPurchaseDollars}
          </p>
          <p className="mt-1 text-sm text-ink-muted">
            {plan?.purchasePriceCents === 0 ? 'No configurado' : 'Pago único'}
          </p>
        </div>
        <div className="border border-ink/15 bg-paper px-6 py-5">
          <p className="text-[10px] uppercase tracking-wide text-ink-muted mb-1">
            Cargo por mora
          </p>
          <p className="text-3xl font-semibold tabular-nums text-ink" data-testid="current-late-fee">
            ${currentLateFeeDollars}
          </p>
          <p className="mt-1 text-sm text-ink-muted">
            {plan?.lateFeeCents === 0 ? 'No configurado' : 'Por atraso'}
          </p>
        </div>
      </div>

      {/* Update form */}
      <div className="border border-ink/15 bg-paper p-6">
        <h2 className="eyebrow mb-4">Actualizar precios</h2>

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
            Precios actualizados correctamente.
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5">
          <div>
            <Label htmlFor="priceDollars">Alquiler mensual (USD)</Label>
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
          </div>

          <div>
            <Label htmlFor="purchasePriceDollars">Precio de compra (USD)</Label>
            <Input
              id="purchasePriceDollars"
              type="number"
              step="0.01"
              min="0"
              max="1000"
              placeholder="0.00"
              data-testid="purchase-price-input"
              {...register('purchasePriceDollars', { valueAsNumber: true })}
            />
            {formState.errors.purchasePriceDollars && (
              <FieldError
                message={formState.errors.purchasePriceDollars.message}
              />
            )}
          </div>

          <div>
            <Label htmlFor="lateFeeDollars">Cargo por mora (USD)</Label>
            <Input
              id="lateFeeDollars"
              type="number"
              step="0.01"
              min="0"
              max="1000"
              placeholder="0.00"
              data-testid="late-fee-input"
              {...register('lateFeeDollars', { valueAsNumber: true })}
            />
            {formState.errors.lateFeeDollars && (
              <FieldError
                message={formState.errors.lateFeeDollars.message}
              />
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
    </div>
  )
}
