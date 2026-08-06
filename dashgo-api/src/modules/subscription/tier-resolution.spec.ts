import { SubscriptionTier } from '../../entities/subscription-plan.entity';
import {
  extractStripeProductId,
  resolveTierFromStripeProduct,
} from './tier-resolution';

const PLANS = [
  { tier: SubscriptionTier.STANDARD, stripeProductId: 'prod_std' },
  { tier: SubscriptionTier.PREMIUM, stripeProductId: 'prod_prem' },
];

describe('resolveTierFromStripeProduct', () => {
  it('resuelve el tier por producto', () => {
    expect(resolveTierFromStripeProduct('prod_prem', PLANS)).toBe(
      SubscriptionTier.PREMIUM,
    );
    expect(resolveTierFromStripeProduct('prod_std', PLANS)).toBe(
      SubscriptionTier.STANDARD,
    );
  });

  it('sigue resolviendo bien DESPUÉS de que rote el precio', () => {
    // Este es el caso que rompe el matcheo por price id: el admin cambia el
    // monto, Stripe emite un price nuevo y el viejo sigue vivo. El producto
    // no cambia, así que el suscriptor viejo sigue clasificado igual.
    expect(resolveTierFromStripeProduct('prod_prem', PLANS)).toBe(
      SubscriptionTier.PREMIUM,
    );
  });

  it('un producto desconocido cae en standard, nunca en premium', () => {
    // Mal clasificado como standard = pierde un beneficio, se reclama.
    // Mal clasificado como premium = regala un producto caro, nadie reclama.
    expect(resolveTierFromStripeProduct('prod_desconocido', PLANS)).toBe(
      SubscriptionTier.STANDARD,
    );
  });

  it('sin producto cae en standard', () => {
    expect(resolveTierFromStripeProduct(null, PLANS)).toBe(
      SubscriptionTier.STANDARD,
    );
    expect(resolveTierFromStripeProduct(undefined, PLANS)).toBe(
      SubscriptionTier.STANDARD,
    );
  });

  it('sin planes configurados cae en standard', () => {
    expect(resolveTierFromStripeProduct('prod_prem', [])).toBe(
      SubscriptionTier.STANDARD,
    );
  });
});

describe('extractStripeProductId', () => {
  it('lee el producto cuando viene como string', () => {
    expect(
      extractStripeProductId({
        items: { data: [{ price: { product: 'prod_x' } }] },
      }),
    ).toBe('prod_x');
  });

  it('lee el producto cuando viene expandido', () => {
    expect(
      extractStripeProductId({
        items: { data: [{ price: { product: { id: 'prod_y' } } }] },
      }),
    ).toBe('prod_y');
  });

  it('devuelve null cuando la subscription no trae items', () => {
    expect(extractStripeProductId({})).toBeNull();
    expect(extractStripeProductId({ items: { data: [] } })).toBeNull();
    expect(
      extractStripeProductId({ items: { data: [{ price: null }] } }),
    ).toBeNull();
  });
});
