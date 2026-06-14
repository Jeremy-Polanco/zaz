import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from '@stripe/react-stripe-js'
import { useState, type FormEvent } from 'react'
import { getStripe } from '../lib/stripe'
import { Button } from './ui'
import { formatCents } from '../lib/utils'

/**
 * Stripe card-authorization form. Mounts a PaymentElement against an existing
 * manual-capture PaymentIntent (the order/credit authorization) and confirms it.
 *
 * Order intents use capture_method='manual', so a successful confirmation lands
 * in `requires_capture` (funds held), NOT `succeeded` — the colmado captures at
 * delivery. We accept both and call onAuthorized; the caller decides what to do
 * next (navigate, invalidate, etc.).
 */
export function CardAuthForm({
  clientSecret,
  amountCents,
  onAuthorized,
}: {
  clientSecret: string
  amountCents: number
  onAuthorized: () => void
}) {
  return (
    <Elements
      stripe={getStripe()}
      options={{ clientSecret, appearance: { theme: 'flat' } }}
    >
      <CardAuthInner amountCents={amountCents} onAuthorized={onAuthorized} />
    </Elements>
  )
}

function CardAuthInner({
  amountCents,
  onAuthorized,
}: {
  amountCents: number
  onAuthorized: () => void
}) {
  const stripe = useStripe()
  const elements = useElements()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
      setError(confirmError.message ?? 'No pudimos autorizar la tarjeta.')
      setSubmitting(false)
      return
    }

    if (
      paymentIntent?.status === 'requires_capture' ||
      paymentIntent?.status === 'succeeded'
    ) {
      onAuthorized()
      return
    }

    setError(
      `Estado de pago inesperado: ${paymentIntent?.status ?? 'desconocido'}.`,
    )
    setSubmitting(false)
  }

  return (
    <form onSubmit={onSubmit} className="mt-4 space-y-5">
      <div className="border border-ink/15 bg-paper p-5">
        <PaymentElement />
      </div>
      {error && <p className="text-sm font-medium text-bad">{error}</p>}
      <Button
        type="submit"
        variant="accent"
        size="lg"
        disabled={!stripe || !elements || submitting}
        className="w-full"
      >
        {submitting ? 'Procesando…' : `Autorizar ${formatCents(amountCents)} →`}
      </Button>
      <p className="text-center text-[11px] text-ink-muted">
        Pago seguro vía Stripe. El monto queda retenido — no se cobra hasta la
        entrega.
      </p>
    </form>
  )
}
