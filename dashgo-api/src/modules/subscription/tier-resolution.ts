import { SubscriptionTier } from '../../entities/subscription-plan.entity';

export interface PlanTierRef {
  tier: SubscriptionTier;
  stripeProductId: string;
}

/**
 * En qué tier cae una suscripción de Stripe.
 *
 * Se resuelve por el **producto** de Stripe, no por el price id. Los precios de
 * Stripe son inmutables: cuando el admin cambia el monto se emite un price
 * NUEVO y el viejo sigue vivo para todo el que ya estaba suscripto. Matchear
 * por price id clasificaría mal a esos suscriptores en cuanto se toque el
 * precio una vez. El producto no rota.
 *
 * Si no se puede resolver, cae en `standard` — un suscriptor mal clasificado
 * como standard pierde un beneficio (visible, se reclama); mal clasificado como
 * premium recibe un producto caro gratis (silencioso, no se reclama nunca).
 */
export function resolveTierFromStripeProduct(
  stripeProductId: string | null | undefined,
  plans: PlanTierRef[],
): SubscriptionTier {
  if (!stripeProductId) return SubscriptionTier.STANDARD;
  const match = plans.find((p) => p.stripeProductId === stripeProductId);
  return match?.tier ?? SubscriptionTier.STANDARD;
}

/**
 * Saca el id del producto de Stripe de una subscription, tolerando las dos
 * formas en que la API lo devuelve (string o objeto expandido).
 */
export function extractStripeProductId(sub: {
  items?: {
    data?: {
      price?: { product?: string | { id?: string } | null } | null;
    }[];
  };
}): string | null {
  const product = sub.items?.data?.[0]?.price?.product;
  if (!product) return null;
  if (typeof product === 'string') return product;
  return product.id ?? null;
}
