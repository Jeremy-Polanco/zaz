/**
 * Unit specs for LateFeeCron — Phase 5 (T5.1–T5.4).
 *
 * Tests verify cron eligibility logic and error isolation:
 *   T5.1 — charges rental with pastDueSince >= 3 days ago AND lastLateFeeAt null
 *   T5.2 — skips rental with pastDueSince only 2 days ago (grace period not elapsed)
 *   T5.3 — skips rental already charged today (lastLateFeeAt >= today UTC midnight)
 *   T5.4 — continues processing remaining rentals when one chargeLateFee throws
 */

import { Test, TestingModule } from '@nestjs/testing';
import { LateFeeCron } from './late-fee.cron';
import { RentalsService } from './rentals.service';
import { Rental, RentalStatus } from '../../entities/rental.entity';
import { User } from '../../entities/user.entity';
import { Product } from '../../entities/product.entity';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakeRental(overrides: Partial<Rental> = {}): Rental {
  return {
    id: 'rental-1',
    userId: 'user-1',
    productId: 'product-1',
    orderId: 'order-1',
    stripeSubscriptionId: 'sub_abc',
    stripePriceId: 'price_abc',
    status: RentalStatus.PAST_DUE,
    monthlyRentCents: 2000,
    lateFeeCents: 500,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    activatedAt: null,
    canceledAt: null,
    pastDueSince: null,
    lastLateFeeAt: null,
    createdAt: new Date('2024-01-01T10:00:00Z'),
    updatedAt: new Date('2024-01-01T10:00:00Z'),
    user: {} as User,
    product: {} as Product,
    order: null,
    ...overrides,
  } as Rental;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('LateFeeCron', () => {
  let cron: LateFeeCron;
  let rentalsService: jest.Mocked<RentalsService>;

  beforeEach(async () => {
    rentalsService = {
      findEligibleForLateFee: jest.fn(),
      chargeLateFee: jest.fn(),
    } as unknown as jest.Mocked<RentalsService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LateFeeCron,
        { provide: RentalsService, useValue: rentalsService },
      ],
    }).compile();

    cron = module.get<LateFeeCron>(LateFeeCron);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // T5.1 — charges eligible rental (pastDueSince >= 3 days ago, lastLateFeeAt null)
  // ─────────────────────────────────────────────────────────────────────────

  describe('runDaily — charges eligible rentals (T5.1)', () => {
    it('T5.1: calls chargeLateFee for rental with pastDueSince >= 3 days ago and lastLateFeeAt null', async () => {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 3600 * 1000 - 1000);
      const eligibleRental = fakeRental({
        id: 'rental-eligible',
        status: RentalStatus.PAST_DUE,
        pastDueSince: threeDaysAgo,
        lastLateFeeAt: null,
      });

      rentalsService.findEligibleForLateFee.mockResolvedValueOnce([eligibleRental]);
      rentalsService.chargeLateFee.mockResolvedValueOnce({
        chargedCents: 500,
        paymentIntentId: 'pi_test_123',
        subscriptionCanceled: false,
      });

      await cron.runDaily();

      expect(rentalsService.findEligibleForLateFee).toHaveBeenCalledTimes(1);
      expect(rentalsService.chargeLateFee).toHaveBeenCalledTimes(1);
      expect(rentalsService.chargeLateFee).toHaveBeenCalledWith('rental-eligible', false);
    });

    it('T5.1-triangulate: multiple eligible rentals — chargeLateFee called for each', async () => {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 3600 * 1000 - 1000);
      const rental1 = fakeRental({ id: 'rental-a', pastDueSince: threeDaysAgo, lastLateFeeAt: null });
      const rental2 = fakeRental({ id: 'rental-b', pastDueSince: threeDaysAgo, lastLateFeeAt: null });

      rentalsService.findEligibleForLateFee.mockResolvedValueOnce([rental1, rental2]);
      rentalsService.chargeLateFee.mockResolvedValue({
        chargedCents: 500,
        paymentIntentId: 'pi_test',
        subscriptionCanceled: false,
      });

      await cron.runDaily();

      expect(rentalsService.chargeLateFee).toHaveBeenCalledTimes(2);
      expect(rentalsService.chargeLateFee).toHaveBeenCalledWith('rental-a', false);
      expect(rentalsService.chargeLateFee).toHaveBeenCalledWith('rental-b', false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // T5.2 — skips rental with pastDueSince only 2 days ago (grace not elapsed)
  // ─────────────────────────────────────────────────────────────────────────

  describe('runDaily — skips grace-period rentals (T5.2)', () => {
    it('T5.2: does NOT call chargeLateFee when findEligibleForLateFee returns empty (grace not elapsed)', async () => {
      // findEligibleForLateFee filters at DB/service level — returns only truly eligible
      // This test verifies that when no eligible rentals are returned, cron skips charging
      rentalsService.findEligibleForLateFee.mockResolvedValueOnce([]);

      await cron.runDaily();

      expect(rentalsService.findEligibleForLateFee).toHaveBeenCalledTimes(1);
      expect(rentalsService.chargeLateFee).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // T5.3 — skips rental already charged today (idempotency)
  // ─────────────────────────────────────────────────────────────────────────

  describe('runDaily — already-charged-today idempotency (T5.3)', () => {
    it('T5.3: does NOT call chargeLateFee when findEligibleForLateFee returns empty due to lastLateFeeAt=today', async () => {
      // The filtering of "already charged today" is done in findEligibleForLateFee.
      // This test verifies the cron honors the empty result (no double-charge).
      rentalsService.findEligibleForLateFee.mockResolvedValueOnce([]);

      await cron.runDaily();

      expect(rentalsService.chargeLateFee).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // T5.4 — error isolation: one failure does NOT abort the rest
  // ─────────────────────────────────────────────────────────────────────────

  describe('runDaily — error isolation per rental (T5.4)', () => {
    it('T5.4: continues processing remaining rentals when one chargeLateFee throws (per-rental try/catch)', async () => {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 3600 * 1000 - 1000);
      const rental1 = fakeRental({ id: 'rental-fail', pastDueSince: threeDaysAgo, lastLateFeeAt: null });
      const rental2 = fakeRental({ id: 'rental-ok', pastDueSince: threeDaysAgo, lastLateFeeAt: null });
      const rental3 = fakeRental({ id: 'rental-ok-2', pastDueSince: threeDaysAgo, lastLateFeeAt: null });

      rentalsService.findEligibleForLateFee.mockResolvedValueOnce([rental1, rental2, rental3]);

      // First rental fails, second and third succeed
      rentalsService.chargeLateFee
        .mockRejectedValueOnce(new Error('Stripe card_declined'))
        .mockResolvedValueOnce({ chargedCents: 500, paymentIntentId: 'pi_ok', subscriptionCanceled: false })
        .mockResolvedValueOnce({ chargedCents: 500, paymentIntentId: 'pi_ok_2', subscriptionCanceled: false });

      // runDaily must NOT throw — it catches per-rental
      await expect(cron.runDaily()).resolves.toBeUndefined();

      // All 3 attempted — the error did NOT abort the loop
      expect(rentalsService.chargeLateFee).toHaveBeenCalledTimes(3);
      expect(rentalsService.chargeLateFee).toHaveBeenCalledWith('rental-fail', false);
      expect(rentalsService.chargeLateFee).toHaveBeenCalledWith('rental-ok', false);
      expect(rentalsService.chargeLateFee).toHaveBeenCalledWith('rental-ok-2', false);
    });

    it('T5.4-triangulate: single rental fails — no unhandled rejection, cron resolves', async () => {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 3600 * 1000 - 1000);
      const rental = fakeRental({ id: 'rental-only-fail', pastDueSince: threeDaysAgo, lastLateFeeAt: null });

      rentalsService.findEligibleForLateFee.mockResolvedValueOnce([rental]);
      rentalsService.chargeLateFee.mockRejectedValueOnce(new Error('STRIPE_PAYMENT_FAILED'));

      // Must resolve (not reject) — error is caught and logged
      await expect(cron.runDaily()).resolves.toBeUndefined();

      expect(rentalsService.chargeLateFee).toHaveBeenCalledTimes(1);
    });
  });
});
