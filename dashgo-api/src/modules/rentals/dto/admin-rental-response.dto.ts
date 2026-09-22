import { SubscriptionTier } from '../../../entities/subscription-plan.entity';

/**
 * Response shape returned by admin rental endpoints.
 * `daysDelinquent` is computed server-side:
 *   max(0, floor((NOW - currentPeriodEnd) / 86400_000))
 * Only meaningful when status is 'past_due' or 'unpaid'; 0 otherwise.
 */
export class AdminRentalResponseDto {
  id!: string;
  orderId!: string;
  userId!: string;
  userName!: string;
  userPhone!: string | null;
  productId!: string;
  productName!: string;
  status!: string;
  monthlyRentCents!: number;
  lateFeeCents!: number;
  theftFeeCents!: number;
  /** Timestamp of the one-time theft-fee charge, or null if never charged. */
  theftFeeChargedAt!: Date | null;
  stripeSubscriptionId!: string | null;
  currentPeriodEnd!: Date | null;
  pastDueSince!: Date | null;
  /**
   * Set when the SUBSCRIPTION PLAN that pays for this ($0) rental is
   * delinquent — mirrored by PlanDelinquencyListener, not by this rental's
   * own Stripe subscription. Null for rentals that pay for themselves.
   */
  planPastDueSince!: Date | null;
  /**
   * "La suscripción ES el bebedero" — para un alquiler de $0 (monthlyRentCents
   * === 0), el TIER del plan vivo del usuario que lo paga (resuelto vía
   * SubscriptionService.resolvePlanRowsByUserIds). Null para alquileres que
   * pagan su propia suscripción de Stripe, o para un usuario de $0 sin plan.
   */
  planTier!: SubscriptionTier | null;
  /**
   * Precio NETO mensual (centavos, pre-tax) del plan de arriba — lo que el
   * panel muestra en vez de "$0.00/mes". Va junto con `planTier`: ambos null
   * o ambos con valor. `monthlyRentCents` NO cambia — sigue siendo lo que
   * realmente cobra Stripe (y lo que usa PlanDelinquencyListener/summarizeAdmin);
   * esto es solo un enriquecimiento de DISPLAY.
   */
  planMonthlyRentCents!: number | null;
  lastLateFeeAt!: Date | null;
  activatedAt!: Date | null;
  canceledAt!: Date | null;
  /** Next bebedero maintenance due date, or null if not a maintenance rental. */
  nextMaintenanceAt!: Date | null;
  /** Days overdue since currentPeriodEnd. Computed: max(0, days from currentPeriodEnd to NOW). */
  daysDelinquent!: number;
  createdAt!: Date;
}
