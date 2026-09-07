/**
 * PaymentReconciliationCron — the safety net for lost Stripe webhooks.
 *
 * A digital order only leaves QUOTED when `payment_intent.amount_capturable_updated`
 * reaches us. If Stripe never delivers it (endpoint disabled after downtime,
 * network blip, …) the customer's card holds the money while the order looks
 * unpaid forever. The cron asks Stripe directly and converges the order.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Order } from '../../entities';
import { OrderStatus, PaymentMethod } from '../../entities/enums';
import { PaymentsService } from '../payments/payments.service';
import { OrdersService } from './orders.service';
import { PaymentReconciliationCron } from './payment-reconciliation.cron';

describe('PaymentReconciliationCron', () => {
  let cron: PaymentReconciliationCron;
  let ordersRepo: { find: jest.Mock };
  let payments: {
    isEnabled: jest.Mock;
    retrieveIntent: jest.Mock;
    markAuthorizedByIntentId: jest.Mock;
    markPaidByIntentId: jest.Mock;
    handleAuthFailureByIntentId: jest.Mock;
    ensureWebhookEndpointEnabled: jest.Mock;
    cancelIntent: jest.Mock;
  };
  let ordersService: { autoConfirmSkipQuoteByIntentId: jest.Mock };

  const stuck = (id: string, intentId: string): Partial<Order> => ({
    id,
    stripePaymentIntentId: intentId,
    status: OrderStatus.QUOTED,
    paymentMethod: PaymentMethod.DIGITAL,
    totalAmount: '39.64',
  });

  // The cron queries QUOTED orders first, then CANCELLED ones (orphaned holds).
  const seed = (quoted: Partial<Order>[], cancelled: Partial<Order>[] = []) =>
    ordersRepo.find.mockImplementation(({ where }: { where: { status: OrderStatus } }) =>
      Promise.resolve(where.status === OrderStatus.CANCELLED ? cancelled : quoted),
    );

  beforeEach(async () => {
    ordersRepo = { find: jest.fn().mockResolvedValue([]) };
    payments = {
      isEnabled: jest.fn().mockReturnValue(true),
      retrieveIntent: jest.fn(),
      markAuthorizedByIntentId: jest.fn().mockResolvedValue(undefined),
      markPaidByIntentId: jest.fn().mockResolvedValue(undefined),
      handleAuthFailureByIntentId: jest.fn().mockResolvedValue(undefined),
      cancelIntent: jest.fn().mockResolvedValue(true),
      ensureWebhookEndpointEnabled: jest
        .fn()
        .mockResolvedValue({ checked: 1, reenabled: 0 }),
    };
    ordersService = {
      autoConfirmSkipQuoteByIntentId: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentReconciliationCron,
        { provide: getRepositoryToken(Order), useValue: ordersRepo },
        { provide: PaymentsService, useValue: payments },
        { provide: OrdersService, useValue: ordersService },
      ],
    }).compile();

    cron = module.get(PaymentReconciliationCron);
  });

  it('advances an order whose hold Stripe already authorized (the missed-webhook case)', async () => {
    seed([stuck('order-1', 'pi_held')]);
    payments.retrieveIntent.mockResolvedValue({ id: 'pi_held', status: 'requires_capture' });

    const result = await cron.reconcileStuckDigitalOrders();

    expect(payments.markAuthorizedByIntentId).toHaveBeenCalledWith('pi_held');
    expect(ordersService.autoConfirmSkipQuoteByIntentId).toHaveBeenCalledWith('pi_held');
    expect(result).toEqual({ scanned: 1, authorized: 1, released: 0, holdsReleased: 0 });
  });

  it('also stamps paidAt when Stripe reports the intent already captured', async () => {
    seed([stuck('order-1', 'pi_done')]);
    payments.retrieveIntent.mockResolvedValue({ id: 'pi_done', status: 'succeeded' });

    await cron.reconcileStuckDigitalOrders();

    expect(payments.markAuthorizedByIntentId).toHaveBeenCalledWith('pi_done');
    expect(payments.markPaidByIntentId).toHaveBeenCalledWith('pi_done');
  });

  it('reverts an order whose intent was canceled at Stripe (customer can retry)', async () => {
    seed([stuck('order-1', 'pi_gone')]);
    payments.retrieveIntent.mockResolvedValue({ id: 'pi_gone', status: 'canceled' });

    const result = await cron.reconcileStuckDigitalOrders();

    expect(payments.handleAuthFailureByIntentId).toHaveBeenCalledWith('pi_gone');
    expect(payments.markAuthorizedByIntentId).not.toHaveBeenCalled();
    expect(result).toEqual({ scanned: 1, authorized: 0, released: 1, holdsReleased: 0 });
  });

  it('leaves an order alone while the customer has not finished paying', async () => {
    seed([stuck('order-1', 'pi_open')]);
    payments.retrieveIntent.mockResolvedValue({
      id: 'pi_open',
      status: 'requires_payment_method',
    });

    const result = await cron.reconcileStuckDigitalOrders();

    expect(payments.markAuthorizedByIntentId).not.toHaveBeenCalled();
    expect(payments.handleAuthFailureByIntentId).not.toHaveBeenCalled();
    expect(result).toEqual({ scanned: 1, authorized: 0, released: 0, holdsReleased: 0 });
  });

  it('keeps going when Stripe fails for one intent', async () => {
    seed([stuck('order-1', 'pi_broken'), stuck('order-2', 'pi_held')]);
    payments.retrieveIntent
      .mockRejectedValueOnce(new Error('Stripe down'))
      .mockResolvedValueOnce({ id: 'pi_held', status: 'requires_capture' });

    const result = await cron.reconcileStuckDigitalOrders();

    expect(payments.markAuthorizedByIntentId).toHaveBeenCalledWith('pi_held');
    expect(result).toEqual({ scanned: 2, authorized: 1, released: 0, holdsReleased: 0 });
  });

  it('releases the orphaned hold of an order cancelled before its intent was', async () => {
    seed([], [{ ...stuck('order-9', 'pi_orphan'), status: OrderStatus.CANCELLED }]);
    payments.retrieveIntent.mockResolvedValue({ id: 'pi_orphan', status: 'requires_capture' });

    const result = await cron.reconcileStuckDigitalOrders();

    expect(payments.cancelIntent).toHaveBeenCalledWith('pi_orphan');
    expect(payments.markAuthorizedByIntentId).not.toHaveBeenCalled();
    expect(result).toEqual({ scanned: 0, authorized: 0, released: 0, holdsReleased: 1 });
  });

  it('does not touch a cancelled order whose intent is already gone', async () => {
    seed([], [{ ...stuck('order-9', 'pi_dead'), status: OrderStatus.CANCELLED }]);
    payments.retrieveIntent.mockResolvedValue({ id: 'pi_dead', status: 'canceled' });

    await cron.reconcileStuckDigitalOrders();

    expect(payments.cancelIntent).not.toHaveBeenCalled();
  });

  it('is a no-op when Stripe is not configured', async () => {
    payments.isEnabled.mockReturnValue(false);

    const result = await cron.reconcileStuckDigitalOrders();

    expect(ordersRepo.find).not.toHaveBeenCalled();
    expect(result).toEqual({ scanned: 0, authorized: 0, released: 0, holdsReleased: 0 });
  });

  it('boot heal: re-enables the webhook endpoint, then reconciles', async () => {
    seed([stuck('order-1', 'pi_held')]);
    payments.retrieveIntent.mockResolvedValue({ id: 'pi_held', status: 'requires_capture' });

    await cron.runBootHeal();

    expect(payments.ensureWebhookEndpointEnabled).toHaveBeenCalledTimes(1);
    expect(payments.markAuthorizedByIntentId).toHaveBeenCalledWith('pi_held');
  });

  it('boot heal survives a failing endpoint check and still reconciles', async () => {
    payments.ensureWebhookEndpointEnabled.mockRejectedValueOnce(new Error('boom'));
    seed([stuck('order-1', 'pi_held')]);
    payments.retrieveIntent.mockResolvedValue({ id: 'pi_held', status: 'requires_capture' });

    await expect(cron.runBootHeal()).resolves.toBeUndefined();

    expect(payments.markAuthorizedByIntentId).toHaveBeenCalledWith('pi_held');
  });
});
