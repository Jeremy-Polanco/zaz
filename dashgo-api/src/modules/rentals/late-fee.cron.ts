import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { RentalsService } from './rentals.service';

/**
 * LateFeeCron — Phase 5 (T5.5).
 *
 * Runs daily at 03:00 server time.
 * Queries RentalsService.findEligibleForLateFee() for PAST_DUE rentals where:
 *   - pastDueSince <= NOW - 3 days (grace period elapsed)
 *   - lastLateFeeAt IS NULL OR lastLateFeeAt < today UTC midnight
 *
 * For each eligible rental, calls chargeLateFee(id, false) inside a try/catch.
 * Errors from one rental do NOT abort the rest of the batch (per T5.4).
 */
@Injectable()
export class LateFeeCron {
  private readonly logger = new Logger(LateFeeCron.name);

  constructor(private readonly rentalsService: RentalsService) {}

  @Cron('0 3 * * *')
  async runDaily(): Promise<void> {
    this.logger.log('LateFeeCron.runDaily: starting');

    const eligible = await this.rentalsService.findEligibleForLateFee();

    this.logger.log(`LateFeeCron.runDaily: ${eligible.length} eligible rental(s)`);

    let charged = 0;
    let skipped = 0;

    for (const rental of eligible) {
      try {
        await this.rentalsService.chargeLateFee(rental.id, false);
        charged++;
        this.logger.log(`LateFeeCron.runDaily: charged rental ${rental.id}`);
      } catch (err) {
        skipped++;
        this.logger.error(
          `LateFeeCron.runDaily: failed to charge rental ${rental.id}: ${(err as Error).message}`,
        );
        // Per T5.4: error is logged and we continue to the next rental
      }
    }

    this.logger.log(
      `LateFeeCron.runDaily: done — charged=${charged} skipped/errored=${skipped} total=${eligible.length}`,
    );
  }
}
