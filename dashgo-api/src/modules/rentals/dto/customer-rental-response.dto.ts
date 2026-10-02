/**
 * Response shape returned to a customer for their own rentals.
 * Read-only — no admin-only fields (no stripeSubscriptionId, no lateFeeCents).
 */
export class CustomerRentalResponseDto {
  id!: string;
  productId!: string;
  productName!: string;
  productImageUrl!: string | null;
  monthlyRentCents!: number;
  status!: string;
  /** Next billing date — equal to currentPeriodEnd from the Stripe Subscription. */
  nextChargeAt!: Date | null;
  activatedAt!: Date | null;
  /** When the next bebedero maintenance is due. NULL if this rental doesn't track maintenance. */
  nextMaintenanceAt!: Date | null;
  /** When the last maintenance was completed. NULL until the first one. */
  lastMaintenanceAt!: Date | null;
  /**
   * La visita de mantenimiento que el sistema ya generó para este bebedero
   * (orden abierta). NULL si no hay visita en curso — o si la orden se
   * canceló/entregó, que para el cliente es lo mismo: no hay nada programado.
   */
  maintenanceOrderId!: string | null;
  /**
   * Día de la visita ('YYYY-MM-DD', día de Nueva York) tomado de la orden de
   * arriba. NULL cuando no hay visita abierta o todavía no tiene día asignado.
   */
  maintenanceScheduledFor!: string | null;
}
