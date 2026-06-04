import { Test, TestingModule } from '@nestjs/testing';
import { StripeWebhookEventJanitorCron } from './stripe-webhook-event-janitor.cron';
import { StripeWebhookIdempotencyService } from './stripe-webhook-idempotency.service';

/**
 * Specs for StripeWebhookEventJanitorCron — HIGH stuck-pending sweeper.
 *
 * The janitor flips `pending` rows older than 10 minutes (with retry_count=0)
 * to `failed` so the next Stripe retry can drive them through the handler.
 * Without it, a crash between the INSERT('pending') and the handler TX commit
 * would leave a phantom pending row that blocks Stripe retries forever.
 */
describe('StripeWebhookEventJanitorCron', () => {
  let cron: StripeWebhookEventJanitorCron;
  let idempotency: { janitorFlipStuckPending: jest.Mock };

  beforeEach(async () => {
    idempotency = { janitorFlipStuckPending: jest.fn().mockResolvedValue(0) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StripeWebhookEventJanitorCron,
        {
          provide: StripeWebhookIdempotencyService,
          useValue: idempotency,
        },
      ],
    }).compile();

    cron = module.get(StripeWebhookEventJanitorCron);
  });

  it('delegates to idempotency.janitorFlipStuckPending', async () => {
    await cron.runJanitor();
    expect(idempotency.janitorFlipStuckPending).toHaveBeenCalledTimes(1);
  });

  it('reports flipped count > 0 without throwing', async () => {
    idempotency.janitorFlipStuckPending.mockResolvedValueOnce(2);
    await expect(cron.runJanitor()).resolves.not.toThrow();
  });

  it('swallows + logs DB errors so the schedule keeps running', async () => {
    idempotency.janitorFlipStuckPending.mockRejectedValueOnce(
      new Error('DB down'),
    );
    await expect(cron.runJanitor()).resolves.not.toThrow();
  });
});
