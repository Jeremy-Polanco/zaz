import type { Product } from './types'

/**
 * Si el precio de suscriptor es el que realmente gana para este producto.
 *
 * El precio de suscriptor es un PISO, no un precio fijo: solo se aplica cuando
 * es MENOR que el precio público (`effectivePriceCents`, que ya viene con la
 * oferta resuelta por el backend). Empate → gana el público, así no se muestra
 * una etiqueta de suscriptor por el mismo dinero.
 */
export function subscriberPriceWins(
  product: Pick<Product, 'effectivePriceCents' | 'subscriberPriceCents'>,
  isSubscriber: boolean,
): boolean {
  // `!= null` a propósito: 0 es un precio válido (gratis para suscriptores).
  return (
    isSubscriber &&
    product.subscriberPriceCents != null &&
    product.subscriberPriceCents < product.effectivePriceCents
  )
}

/**
 * Precio que realmente se le cobra a este comprador, en cents.
 *
 * Espejo EXACTO de `getEffectivePrice` en
 * dashgo-api/src/modules/products/pricing.ts y de
 * dashgo/src/lib/pricing.ts (mobile). Si cambia la regla, cambia en los tres.
 *
 * El suscriptor paga el MENOR entre su precio y el precio público — nunca más
 * caro que alguien sin suscripción, y las dos nunca se acumulan.
 *
 * Esto es SOLO presentación: el monto real lo decide el servidor al crear la
 * orden, verificando la suscripción. Nunca al revés.
 */
export function effectivePriceCentsFor(
  product: Pick<Product, 'effectivePriceCents' | 'subscriberPriceCents'>,
  isSubscriber: boolean,
): number {
  return subscriberPriceWins(product, isSubscriber)
    ? product.subscriberPriceCents!
    : product.effectivePriceCents
}

/**
 * Si mostrar el gancho "Suscriptores: $X" a alguien que todavía NO es
 * suscriptor. Para un suscriptor no se muestra: ese precio ya es el que paga.
 *
 * Se muestra solo cuando suscribirse le ahorraría plata de verdad. Si una
 * oferta ya dejó el precio público por debajo, no hay nada que ofrecer.
 */
export function showsSubscriberTeaser(
  product: Pick<Product, 'subscriberPriceCents' | 'effectivePriceCents'>,
  isSubscriber: boolean,
): boolean {
  return !isSubscriber && subscriberPriceWins(product, true)
}
