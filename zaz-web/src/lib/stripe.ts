import { loadStripe, type Stripe } from '@stripe/stripe-js'

const PUBLISHABLE_KEY: string | undefined = import.meta.env
  .VITE_STRIPE_PUBLISHABLE_KEY

let stripePromise: Promise<Stripe | null> | null = null

export function getStripe(): Promise<Stripe | null> {
  if (!PUBLISHABLE_KEY) {
    throw new Error('VITE_STRIPE_PUBLISHABLE_KEY is required for Stripe payments')
  }
  if (!stripePromise) {
    stripePromise = loadStripe(PUBLISHABLE_KEY)
  }
  return stripePromise
}
