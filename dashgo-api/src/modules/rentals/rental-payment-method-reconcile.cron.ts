import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import * as Sentry from '@sentry/node';
import { In, IsNull, Not, Repository } from 'typeorm';
import { Rental, RentalStatus } from '../../entities/rental.entity';
import { StripePaymentMethodResolver } from './stripe-payment-method.resolver';

/**
 * Repara las suscripciones de alquiler que se crearon SIN método de pago.
 *
 * Bug del 2026-10-20: `performActivation` creaba la suscripción del 2º bebedero
 * ($6.99/mes) sin `default_payment_method`. Al terminar el trial la primera
 * factura fallaba, la suscripción pasaba a past_due ~1 h después y el dunning de
 * Stripe la cancelaba. El arreglo de raíz evita que se creen así; este job cura
 * las que YA existen y siguen vivas en Stripe:
 *
 *  1. Si la suscripción no tiene `default_payment_method`, le pone la tarjeta del
 *     cliente (`ensureCustomerDefault`, que además la deja como default del
 *     cliente para las facturas futuras).
 *  2. Si estaba past_due con su factura abierta, la reintenta UNA vez — sólo
 *     cuando acabamos de parchearla: si ya tenía tarjeta y aun así falló, es un
 *     rechazo real del banco y un reintento diario duplicaría el dunning de
 *     Stripe contra el cliente.
 *
 *  3. Si estaba past_due, reinicia `pastDueSince` a AHORA: esa mora fue culpa
 *     nuestra (no había tarjeta), así que los 3 días de gracia de la multa
 *     (LateFeeCron, 03:00 UTC) cuentan desde que el cliente tiene una tarjeta
 *     puesta. Sin esto, si el reintento del paso 2 rebota, la multa se cobraba
 *     esa misma noche contando los días de NUESTRO error.
 *
 * Fuera de eso NO escribe el estado del alquiler: Stripe emite
 * `customer.subscription.updated` / `invoice.*` y `handleSubscriptionUpdated`
 * ya sincroniza la fila (y al volver a active borra `pastDueSince`). Las que
 * Stripe ya CANCELÓ no se pueden revivir y se saltan.
 *
 * Corre a las 4:00 AM de Nueva York y una vez ~45 s después de cada boot (un
 * redeploy cura el backlog solo). Es idempotente y nunca lanza.
 */
const BOOT_DELAY_MS = 45_000;

/** Estados de Stripe que ya no tienen arreglo: no vale la pena tocarlos. */
const DEAD_STRIPE_STATUSES = new Set(['canceled', 'incomplete_expired']);

export interface RentalPmReconcileSummary {
  /** Alquileres con suscripción de Stripe que se revisaron. */
  scanned: number;
  /** Suscripciones a las que se les puso método de pago. */
  patched: number;
  /** Facturas past_due cobradas con éxito tras parchear. */
  invoicesPaid: number;
  /** Sin nada que hacer: ya tenían tarjeta, estaban muertas o no hay tarjeta. */
  skipped: number;
  /** Errores de Stripe (aislados por alquiler). */
  failed: number;
}

const emptySummary = (): RentalPmReconcileSummary => ({
  scanned: 0,
  patched: 0,
  invoicesPaid: 0,
  skipped: 0,
  failed: 0,
});

type StripeClient = NonNullable<ReturnType<StripePaymentMethodResolver['getStripe']>>;

@Injectable()
export class RentalPaymentMethodReconcileCron
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(RentalPaymentMethodReconcileCron.name);
  private bootTimer: ReturnType<typeof setTimeout> | null = null;
  /** Guarda de reentrada: el corrido de arranque y el de las 4:00 AM pueden coincidir. */
  private running = false;

  constructor(
    @InjectRepository(Rental) private readonly rentals: Repository<Rental>,
    private readonly paymentMethods: StripePaymentMethodResolver,
  ) {}

  onApplicationBootstrap(): void {
    // Fuera del camino de boot: que la app termine de levantar primero.
    this.bootTimer = setTimeout(() => void this.runSafely('boot'), BOOT_DELAY_MS);
    this.bootTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.bootTimer) clearTimeout(this.bootTimer);
  }

  @Cron('0 4 * * *', { timeZone: 'America/New_York' })
  async runDaily(): Promise<void> {
    await this.runSafely('daily');
  }

  private async runSafely(trigger: 'boot' | 'daily'): Promise<void> {
    try {
      const summary = await this.reconcile();
      this.logger.log(
        `reparación de método de pago de alquileres (${trigger}): revisados=${summary.scanned} parchados=${summary.patched} facturasCobradas=${summary.invoicesPaid} saltados=${summary.skipped} fallidos=${summary.failed}`,
      );
    } catch (err) {
      this.logger.error(
        `reparación de método de pago de alquileres (${trigger}) falló: ${(err as Error).message}`,
      );
      Sentry.captureException(err, {
        tags: { module: 'rentals', phase: 'pm-reconcile' },
      });
    }
  }

  async reconcile(): Promise<RentalPmReconcileSummary> {
    const summary = emptySummary();
    if (this.running) {
      this.logger.warn(
        'reparación de método de pago: ya hay una corrida en curso, se omite',
      );
      return summary;
    }
    const stripe = this.paymentMethods.getStripe();
    if (!stripe) return summary;

    this.running = true;
    try {
      const rows = await this.rentals.find({
        where: {
          stripeSubscriptionId: Not(IsNull()),
          status: In([RentalStatus.ACTIVE, RentalStatus.PAST_DUE]),
        },
      });

      for (const rental of rows) {
        summary.scanned++;
        try {
          await this.reconcileOne(stripe, rental, summary);
        } catch (err) {
          // Un alquiler roto no frena a los demás.
          summary.failed++;
          this.logger.error(
            `reparación de método de pago: alquiler ${rental.id} (${rental.stripeSubscriptionId}) falló: ${(err as Error).message}`,
          );
          Sentry.captureException(err, {
            tags: { module: 'rentals', phase: 'pm-reconcile' },
            extra: { rentalId: rental.id },
          });
        }
      }
      return summary;
    } finally {
      this.running = false;
    }
  }

  private async reconcileOne(
    stripe: StripeClient,
    rental: Rental,
    summary: RentalPmReconcileSummary,
  ): Promise<void> {
    const subId = rental.stripeSubscriptionId as string;
    const sub = (await stripe.subscriptions.retrieve(subId, {
      expand: ['latest_invoice'],
    })) as unknown as {
      id: string;
      status: string;
      customer: string | { id: string };
      default_payment_method: unknown;
      latest_invoice: string | { id: string; status?: string } | null;
    };

    if (DEAD_STRIPE_STATUSES.has(sub.status) || sub.default_payment_method) {
      summary.skipped++;
      return;
    }

    const customerId =
      typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
    const pm = customerId
      ? await this.paymentMethods.ensureCustomerDefault(customerId)
      : null;
    if (!pm) {
      // El cliente no tiene ninguna tarjeta: no hay nada que ponerle. Se
      // reintenta en la próxima corrida (puede que agregue una).
      summary.skipped++;
      return;
    }

    if (sub.status === 'past_due') {
      // ANTES de tocar Stripe: el webhook que dispara el parche recarga y
      // guarda la fila entera; si esto corriera después podría pisarlo con la
      // fecha vieja. Sólo si ya tenía Día 0 (no inventa una mora que la BD no
      // vio todavía: ese webhook la fecha al llegar). No bloquea el arreglo.
      try {
        await this.rentals.update(
          { id: rental.id, pastDueSince: Not(IsNull()) },
          { pastDueSince: new Date() },
        );
      } catch (err) {
        this.logger.warn(
          `reparación de método de pago: no se pudo reiniciar la gracia de mora del alquiler ${rental.id}: ${(err as Error).message}`,
        );
      }
    }

    await stripe.subscriptions.update(subId, { default_payment_method: pm });
    summary.patched++;
    this.logger.log(
      `reparación de método de pago: alquiler ${rental.id} (${subId}) parchado con ${pm}`,
    );

    if (sub.status !== 'past_due' || !sub.latest_invoice) return;

    // `latest_invoice` viene expandido; si no, es el id y hay que consultarla.
    const invoice =
      typeof sub.latest_invoice === 'string'
        ? ((await stripe.invoices.retrieve(sub.latest_invoice)) as unknown as {
            id: string;
            status?: string;
          })
        : sub.latest_invoice;
    if (invoice.status !== 'open') return;

    try {
      await stripe.invoices.pay(
        invoice.id,
        { payment_method: pm },
        // Una vez por factura y día: dos corridas el mismo día no cobran dos veces.
        {
          idempotencyKey: `rental-pm-reconcile-pay-${invoice.id}-${new Date().toISOString().slice(0, 10)}`,
        },
      );
      summary.invoicesPaid++;
    } catch (err) {
      summary.failed++;
      this.logger.warn(
        `reparación de método de pago: no se pudo cobrar la factura ${invoice.id} del alquiler ${rental.id}: ${(err as Error).message}`,
      );
    }
  }
}
