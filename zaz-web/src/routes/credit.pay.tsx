import { createFileRoute, Link, redirect, useRouter } from '@tanstack/react-router'
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js'
import { useEffect, useState, type FormEvent } from 'react'
import { z } from 'zod'
import { useQueryClient } from '@tanstack/react-query'
import { TOKEN_KEY } from '../lib/api'
import { Button, SectionHeading } from '../components/ui'
import { useCreateCreditPaymentIntent, useMyCredit } from '../lib/queries'
import { getStripe } from '../lib/stripe'
import { formatCents } from '../lib/utils'

export const Route = createFileRoute('/credit/pay')({
  validateSearch: z.object({}),
  beforeLoad: () => {
    if (!localStorage.getItem(TOKEN_KEY)) {
      throw redirect({ to: '/login', search: { next: undefined, ref: undefined } })
    }
  },
  component: CreditPayPage,
})

function CreditPayPage() {
  const { data, isPending } = useMyCredit()
  const create = useCreateCreditPaymentIntent()
  const [intent, setIntent] = useState<{
    clientSecret: string
    amount: number
  } | null>(null)
  const [initError, setInitError] = useState<string | null>(null)

  useEffect(() => {
    if (intent || create.isPending || initError) return
    if (!data) return
    if (data.amountOwedCents <= 0) return
    create
      .mutateAsync()
      .then((res) =>
        setIntent({ clientSecret: res.clientSecret, amount: res.amount }),
      )
      .catch((err: unknown) => {
        const msg =
          (err as { response?: { data?: { message?: string } } })?.response
            ?.data?.message ?? 'No pudimos preparar el pago. Prueba de nuevo.'
        setInitError(msg)
      })
  }, [data, intent, create, initError])

  if (isPending) {
    return (
      <div className="mx-auto max-w-xl px-6 py-20 text-center">
        <span className="eyebrow">Cargando…</span>
      </div>
    )
  }

  if (!data || data.amountOwedCents <= 0) {
    return (
      <div className="page-rise mx-auto max-w-xl px-6 py-20 text-center">
        <SectionHeading
          eyebrow="Crédito"
          title={
            <>
              Sin saldo <span className="italic text-brand">pendiente</span>
            </>
          }
          subtitle="No tienes deuda que pagar ahora mismo."
        />
        <Link to="/credit">
          <Button variant="secondary">Volver a mi crédito</Button>
        </Link>
      </div>
    )
  }

  return (
    <div className="page-rise mx-auto max-w-xl px-6 py-12">
      <SectionHeading
        eyebrow="Pagar crédito"
        title={
          <>
            Saldar <span className="italic text-brand">cuenta.</span>
          </>
        }
        subtitle={`Total a pagar · ${formatCents(data.amountOwedCents)}`}
      />

      {initError && (
        <div className="mb-6 border-l-4 border-bad bg-bad/5 p-4 text-sm text-bad">
          {initError}
        </div>
      )}

      {!intent ? (
        <div className="border border-ink/15 bg-paper p-6 text-center">
          <span className="eyebrow">Preparando el pago…</span>
        </div>
      ) : (
        <Elements
          stripe={getStripe()}
          options={{
            clientSecret: intent.clientSecret,
            appearance: { theme: 'flat' },
          }}
        >
          <CreditPayForm amountCents={intent.amount} />
        </Elements>
      )}
    </div>
  )
}

function CreditPayForm({ amountCents }: { amountCents: number }) {
  const stripe = useStripe()
  const elements = useElements()
  const router = useRouter()
  const qc = useQueryClient()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [succeeded, setSucceeded] = useState(false)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!stripe || !elements) return
    setSubmitting(true)
    setError(null)

    const { error: confirmError, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: 'if_required',
    })

    if (confirmError) {
      setError(confirmError.message ?? 'No pudimos cobrar la tarjeta.')
      setSubmitting(false)
      return
    }

    if (paymentIntent?.status === 'succeeded') {
      setSucceeded(true)
      // Webhook is the source of truth — but invalidate to refetch ASAP.
      // Server may take a moment to apply; user sees success either way.
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: ['credit', 'me'] })
        qc.invalidateQueries({ queryKey: ['auth', 'me'] })
        router.navigate({ to: '/credit' })
      }, 1500)
      return
    }

    setError(
      `Estado de pago inesperado: ${paymentIntent?.status ?? 'desconocido'}.`,
    )
    setSubmitting(false)
  }

  if (succeeded) {
    return (
      <div className="border border-ok/30 bg-ok/5 p-6 text-center">
        <span className="eyebrow text-ok">Pago confirmado</span>
        <p className="mt-3 text-ink">
          Recibimos tu pago de {formatCents(amountCents)}. Estamos liberando tu
          cuenta…
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <div className="border border-ink/15 bg-paper p-5">
        <PaymentElement />
      </div>
      {error && (
        <p className="text-sm font-medium text-bad">{error}</p>
      )}
      <Button
        type="submit"
        variant="accent"
        size="lg"
        disabled={!stripe || !elements || submitting}
        className="w-full"
      >
        {submitting ? 'Procesando…' : `Pagar ${formatCents(amountCents)}`}
      </Button>
      <p className="text-center text-[11px] text-ink-muted">
        Pago seguro vía Stripe. No guardamos tu tarjeta.
      </p>
    </form>
  )
}
