import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/node';
import Stripe = require('stripe');

type StripeClient = InstanceType<typeof Stripe>;

/** Estados de suscripción en los que todavía vale la pena leer su método de pago. */
const LIVE_SUBSCRIPTION_STATUSES = ['active', 'past_due', 'trialing'] as const;

/** `default_payment_method` de Stripe llega como id, objeto expandido o null. */
function pmId(pm: unknown): string | null {
  if (!pm) return null;
  if (typeof pm === 'string') return pm;
  const id = (pm as { id?: unknown }).id;
  return typeof id === 'string' ? id : null;
}

/**
 * Encuentra el método de pago de un cliente de Stripe para los cobros que crea
 * la API sin pasar por Checkout: la suscripción del 2º bebedero ($6.99/mes) y
 * las multas por mora / robo.
 *
 * Bug del 2026-10-20: esas llamadas iban SIN método de pago. La tarjeta del
 * cliente sólo estaba guardada en la suscripción del PLAN (la creó Checkout) y
 * no como default del cliente, así que la suscripción del alquiler no tenía con
 * qué cobrar: tras el trial la primera factura fallaba (past_due ~1 h después) y
 * el dunning la cancelaba. Un PaymentIntent `off_session` + `confirm` sin
 * `payment_method` tampoco se puede confirmar nunca.
 *
 * Orden de búsqueda (de más a menos confiable):
 *  1. `invoice_settings.default_payment_method` del cliente.
 *  2. El `default_payment_method` de su suscripción viva — preferimos la del
 *     PLAN (sin `metadata.rentalId`) porque esa la pagó el cliente en Checkout.
 *  3. La tarjeta adjunta más reciente.
 *
 * Nunca lanza: esto corre en caminos que ya son best-effort (activación,
 * crons). Un fallo de Stripe se loguea y se devuelve null.
 */
@Injectable()
export class StripePaymentMethodResolver implements OnModuleInit {
  private readonly logger = new Logger(StripePaymentMethodResolver.name);
  private stripe: StripeClient | null = null;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const secret = this.config.get<string>('STRIPE_SECRET_KEY');
    if (!secret) {
      this.logger.warn(
        'STRIPE_SECRET_KEY missing — payment method resolver disabled',
      );
      return;
    }
    this.stripe = new Stripe(secret);
  }

  /**
   * Cliente de Stripe ya inicializado (o null). Lo exponemos para que el cron
   * de reparación reutilice la misma instancia en vez de crear otra.
   */
  getStripe(): StripeClient | null {
    return this.stripe;
  }

  async resolveForCustomer(customerId: string): Promise<string | null> {
    const found = await this.lookup(customerId);
    return found.pm;
  }

  /**
   * Igual que `resolveForCustomer`, pero si el cliente no tenía default y sí
   * encontramos una tarjeta, la deja como `invoice_settings.default_payment_method`
   * para que las próximas facturas y suscripciones creadas por API la hereden.
   */
  async ensureCustomerDefault(customerId: string): Promise<string | null> {
    const { pm, customerHadDefault } = await this.lookup(customerId);
    if (pm && !customerHadDefault && this.stripe) {
      try {
        await this.stripe.customers.update(customerId, {
          invoice_settings: { default_payment_method: pm },
        });
      } catch (err) {
        // No bloquea: el PM resuelto sirve igual para este cobro puntual.
        this.logger.warn(
          `ensureCustomerDefault: no se pudo fijar el default de ${customerId}: ${(err as Error).message}`,
        );
      }
    }
    return pm;
  }

  private async lookup(
    customerId: string,
  ): Promise<{ pm: string | null; customerHadDefault: boolean }> {
    if (!this.stripe) return { pm: null, customerHadDefault: false };
    const stripe = this.stripe;

    try {
      // 1) Default del cliente.
      const customer = await stripe.customers.retrieve(customerId);
      const fromCustomer = pmId(
        (customer as { invoice_settings?: { default_payment_method?: unknown } })
          .invoice_settings?.default_payment_method,
      );
      if (fromCustomer) return { pm: fromCustomer, customerHadDefault: true };

      // 2) Suscripción viva: la del plan primero, luego cualquiera.
      for (const status of LIVE_SUBSCRIPTION_STATUSES) {
        const subs = await stripe.subscriptions.list({
          customer: customerId,
          status,
          limit: 10,
        });
        const withPm = (subs.data ?? [])
          .map((s) => ({
            pm: pmId((s as { default_payment_method?: unknown }).default_payment_method),
            isRental: Boolean(
              (s as { metadata?: Record<string, string> }).metadata?.rentalId,
            ),
          }))
          .filter((s) => s.pm);
        const best = withPm.find((s) => !s.isRental) ?? withPm[0];
        if (best?.pm) return { pm: best.pm, customerHadDefault: false };
      }

      // 3) Tarjeta adjunta más reciente (Stripe lista de la más nueva a la más vieja).
      const cards = await stripe.paymentMethods.list({
        customer: customerId,
        type: 'card',
        limit: 1,
      });
      return { pm: cards.data?.[0]?.id ?? null, customerHadDefault: false };
    } catch (err) {
      this.logger.error(
        `resolveForCustomer: falló la búsqueda de método de pago de ${customerId}: ${(err as Error).message}`,
      );
      Sentry.captureException(err, {
        tags: { module: 'rentals', phase: 'resolve-payment-method' },
        extra: { customerId },
      });
      return { pm: null, customerHadDefault: false };
    }
  }
}
