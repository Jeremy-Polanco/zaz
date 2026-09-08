import { RentalStatus } from '../../../entities/rental.entity';

/**
 * Global rental KPIs for the admin panel.
 *
 * Computed over the WHOLE rentals table — no status/user/product filter and no
 * pagination. The admin screens used to derive these numbers from the 25-row
 * page `listAdmin` returns, which described the window instead of the dataset
 * ("25 resultados / Al día 23" no matter how many rentals existed).
 *
 * `byStatus` always carries every RentalStatus key (0 when the status has no
 * rows), so the UI never has to guard for undefined.
 */
export class RentalsSummaryResponseDto {
  /** Total rentals in the table, all statuses included. */
  total!: number;

  /** Row count per status. Every RentalStatus key is present. */
  byStatus!: Record<RentalStatus, number>;

  /** Sum of monthlyRentCents across past_due + unpaid rentals. */
  rentAtRiskCents!: number;
}
