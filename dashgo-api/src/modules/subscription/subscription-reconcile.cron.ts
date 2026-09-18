import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SubscriptionService } from './subscription.service';

/**
 * Red de seguridad para las suscripciones del plan.
 *
 * La tabla `subscriptions` solo se actualizaba por webhook. Si Stripe no nos
 * entrega un evento (endpoint deshabilitado tras días caídos, app archivada,
 * evento sin metadata.userId) la fila queda congelada: `current_period_end`
 * vence, `isActiveSubscriber` pasa a false y el suscriptor pierde el
 * mantenimiento gratis, el bebedero y los precios de suscriptor mientras la
 * pantalla sigue diciendo "Activa". Así llegó el "tiene suscripción y le está
 * cobrando" del 2026-09-18.
 *
 * En vez de confiar solo en el webhook, le pedimos la verdad a Stripe: poco
 * después del boot (un redeploy cura el backlog solo) y cada hora, a :10 —
 * antes de los backfills de bebedero (:20) y premium (:35), que leen la tabla
 * que este job acaba de poner al día.
 */
const BOOT_DELAY_MS = 20_000;

@Injectable()
export class SubscriptionReconcileCron implements OnApplicationBootstrap {
  private readonly logger = new Logger(SubscriptionReconcileCron.name);

  constructor(private readonly subscriptions: SubscriptionService) {}

  onApplicationBootstrap() {
    // Fuera del camino de boot: que la app termine de levantar primero.
    const timer = setTimeout(() => void this.run('boot'), BOOT_DELAY_MS);
    timer.unref?.();
  }

  @Cron('10 * * * *')
  async runHourly(): Promise<void> {
    await this.run('hourly');
  }

  async run(trigger: 'boot' | 'hourly'): Promise<void> {
    try {
      const result = await this.subscriptions.reconcileWithStripe();
      this.logger.log(
        `subscription reconcile (${trigger}): ${JSON.stringify(result)}`,
      );
    } catch (err) {
      this.logger.error(
        `subscription reconcile (${trigger}) failed: ${(err as Error).message}`,
      );
    }
  }
}
