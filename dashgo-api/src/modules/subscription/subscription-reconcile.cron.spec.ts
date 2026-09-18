/**
 * SubscriptionReconcileCron — red de seguridad para las suscripciones del plan.
 *
 * La tabla `subscriptions` solo se actualizaba por webhook. Si Stripe no nos
 * entrega un evento (endpoint deshabilitado, app archivada, evento sin
 * metadata), la fila queda congelada y el suscriptor pierde sus beneficios sin
 * que nadie lo note. Este cron pide la verdad a Stripe al arrancar y cada hora.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { SubscriptionReconcileCron } from './subscription-reconcile.cron';
import { SubscriptionService } from './subscription.service';

describe('SubscriptionReconcileCron', () => {
  let cron: SubscriptionReconcileCron;
  let subscriptions: { reconcileWithStripe: jest.Mock };

  beforeEach(async () => {
    subscriptions = {
      reconcileWithStripe: jest.fn().mockResolvedValue({
        scanned: 0,
        upserted: 0,
        skipped: 0,
        purged: 0,
        failed: 0,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionReconcileCron,
        { provide: SubscriptionService, useValue: subscriptions },
      ],
    }).compile();

    cron = module.get(SubscriptionReconcileCron);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('la corrida horaria delega en reconcileWithStripe', async () => {
    await cron.runHourly();
    expect(subscriptions.reconcileWithStripe).toHaveBeenCalledTimes(1);
  });

  it('al arrancar programa una corrida diferida, fuera del camino de boot', () => {
    jest.useFakeTimers();

    cron.onApplicationBootstrap();
    expect(subscriptions.reconcileWithStripe).not.toHaveBeenCalled();

    jest.advanceTimersByTime(20_000);
    expect(subscriptions.reconcileWithStripe).toHaveBeenCalledTimes(1);
  });

  it('un error de Stripe no tira ni rompe el schedule', async () => {
    subscriptions.reconcileWithStripe.mockRejectedValueOnce(
      new Error('stripe down'),
    );
    await expect(cron.runHourly()).resolves.toBeUndefined();
  });
});
