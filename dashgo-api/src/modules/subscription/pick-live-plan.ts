import { Subscription, SubscriptionStatus } from '../../entities/subscription.entity';

/**
 * Resuelve la fila "viva" de `subscriptions` cuando un usuario acumula varias
 * (cancelación + re-suscripción — ver migración
 * 1811000000000-DropSubscriptionsUserIdUnique: `user_id` NO es único). Una
 * fila VIEJA nunca debe ganarle a una VIVA: se prioriza cualquier fila ACTIVE
 * con `currentPeriodEnd` futuro, después cualquier PAST_DUE con
 * `currentPeriodEnd` futuro, y solo si ninguna sigue viva se cae a "la más
 * nueva por currentPeriodEnd" — la regla previa, que sigue siendo correcta
 * cuando el usuario tiene una sola fila viva (o ninguna).
 *
 * Extraído de `PlanDelinquencyListener.resolvePlanStatus` (misma semántica,
 * pero devolviendo la FILA completa en vez de solo el status) para que
 * `SubscriptionService`/`RentalsService` puedan resolver también el TIER del
 * plan vivo — "la suscripción ES el bebedero": el precio a mostrar en un
 * alquiler de $0 es el del PLAN, no el de su propia suscripción de Stripe.
 */
export function pickLivePlan(rows: Subscription[]): Subscription | null {
  if (rows.length === 0) return null;

  const now = new Date();
  const isLive = (r: Subscription): boolean => r.currentPeriodEnd > now;

  const liveActive = rows.find(
    (r) => r.status === SubscriptionStatus.ACTIVE && isLive(r),
  );
  if (liveActive) return liveActive;

  const livePastDue = rows.find(
    (r) => r.status === SubscriptionStatus.PAST_DUE && isLive(r),
  );
  if (livePastDue) return livePastDue;

  return [...rows].sort(
    (a, b) => b.currentPeriodEnd.getTime() - a.currentPeriodEnd.getTime(),
  )[0];
}
