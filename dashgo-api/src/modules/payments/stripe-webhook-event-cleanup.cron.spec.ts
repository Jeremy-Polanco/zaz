import { Test, TestingModule } from '@nestjs/testing';
import { StripeWebhookEventCleanupCron } from './stripe-webhook-event-cleanup.cron';
import { StripeWebhookIdempotencyService } from './stripe-webhook-idempotency.service';

/**
 * Specs for StripeWebhookEventCleanupCron — HIGH retention filter.
 *
 * The previous behaviour purged EVERY row past 30 days, including `failed`
 * and `dead` rows that ops needs for incident forensics. The cron must only
 * delegate to `deleteProcessedOlderThan` so failed/pending/dead rows are
 * preserved indefinitely.
 */
describe('StripeWebhookEventCleanupCron', () => {
  let cron: StripeWebhookEventCleanupCron;
  let idempotency: { deleteProcessedOlderThan: jest.Mock };

  beforeEach(async () => {
    idempotency = { deleteProcessedOlderThan: jest.fn().mockResolvedValue(5) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StripeWebhookEventCleanupCron,
        {
          provide: StripeWebhookIdempotencyService,
          useValue: idempotency,
        },
      ],
    }).compile();

    cron = module.get(StripeWebhookEventCleanupCron);
  });

  it('only calls deleteProcessedOlderThan (preserves failed/pending/dead past 30d)', async () => {
    await cron.runDaily();

    // The cron MUST NOT call a "delete everything older than" method —
    // it must call the status='processed'-filtered method so failed and
    // dead rows stay in the table for forensics.
    expect(idempotency.deleteProcessedOlderThan).toHaveBeenCalledTimes(1);

    // Cutoff must be ~30 days in the past — we don't pin the exact ms but
    // verify it's within a sensible window so future drift catches a typo
    // (e.g. someone changing 30 to 3 by accident).
    const [cutoffArg] = idempotency.deleteProcessedOlderThan.mock.calls[0] as [
      Date,
    ];
    expect(cutoffArg).toBeInstanceOf(Date);
    const ageMs = Date.now() - cutoffArg.getTime();
    const days = ageMs / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
  });

  it('swallows + logs DB errors so the schedule keeps running', async () => {
    idempotency.deleteProcessedOlderThan.mockRejectedValueOnce(
      new Error('DB down'),
    );

    // Must not throw — cron failures should not crash @nestjs/schedule.
    await expect(cron.runDaily()).resolves.not.toThrow();
  });
});
