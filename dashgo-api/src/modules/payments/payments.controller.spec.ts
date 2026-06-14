/**
 * Unit specs for PaymentsController — Phase 5 (T49/T50).
 *
 * TDD pairs:
 *   Pair 1 (T49/T50) — Webhook dispatch by metadata.rentalId
 *     - subscription event WITH metadata.rentalId → rentalsService.handleWebhook called
 *     - subscription event WITHOUT metadata.rentalId → rentalsService.handleWebhook NOT called
 *     - invoice event WITH subscription that has metadata.rentalId → rentalsService.handleWebhook called
 *     - free-shipping path: subscriptionService.handleWebhook ALWAYS called for these events
 */

import { Test, TestingModule } from '@nestjs/testing';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { SubscriptionService } from '../subscription/subscription.service';
import { CreditService } from '../credit/credit.service';
import { RentalsService } from '../rentals/rentals.service';
import { OrdersService } from '../orders/orders.service';
import { StripeWebhookIdempotencyService } from './stripe-webhook-idempotency.service';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRawRequest(body: object): RawBodyRequest<Request> {
  return {
    rawBody: Buffer.from(JSON.stringify(body)),
  } as RawBodyRequest<Request>;
}

function fakeEvent(
  type: string,
  data: object,
  overrides: { id?: string; created?: number } = {},
): object {
  return {
    id: overrides.id ?? `evt_${Math.random().toString(36).slice(2)}`,
    type,
    created: overrides.created ?? Math.floor(Date.now() / 1000),
    data: {
      object: data,
    },
  };
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPaymentsService = {
  constructWebhookEvent: jest.fn(),
  createIntentForItems: jest.fn(),
  markAuthorizedByIntentId: jest.fn().mockResolvedValue(undefined),
  markPaidByIntentId: jest.fn().mockResolvedValue(undefined),
  handleAuthFailureByIntentId: jest.fn().mockResolvedValue(undefined),
  retrieveSubscription: jest
    .fn()
    .mockResolvedValue({ id: 'sub_default', metadata: {} }),
};

const mockSubscriptionService = {
  handleWebhook: jest.fn().mockResolvedValue(undefined),
};

const mockCreditService = {
  recordPaymentFromStripe: jest.fn().mockResolvedValue(undefined),
};

const mockRentalsService = {
  handleWebhook: jest.fn().mockResolvedValue(undefined),
};

// The controller delegates idempotency + freshness to this service. Tests in
// THIS file focus on dispatch routing, so we stub it to a pass-through that
// always runs the handler.
type RunOnceOutcome =
  | { status: 'processed' }
  | { status: 'duplicate' }
  | { status: 'failed'; error: Error }
  | { status: 'dead'; error: Error };

const mockIdempotencyService = {
  parseSignatureTimestamp: jest.fn().mockReturnValue(Math.floor(Date.now() / 1000)),
  assertFresh: jest.fn(),
  runOnce: jest.fn(
    async (
      _event: unknown,
      handler: () => Promise<void>,
    ): Promise<RunOnceOutcome> => {
      await handler();
      return { status: 'processed' };
    },
  ),
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('PaymentsController — webhook rental dispatch (T49/T50)', () => {
  let controller: PaymentsController;

  beforeEach(async () => {
    jest.clearAllMocks();
    // Re-arm the idempotency stub after clearAllMocks() wipes its default impl.
    mockIdempotencyService.parseSignatureTimestamp.mockReturnValue(
      Math.floor(Date.now() / 1000),
    );
    mockIdempotencyService.runOnce.mockImplementation(
      async (
        _event: unknown,
        handler: () => Promise<void>,
      ): Promise<RunOnceOutcome> => {
        await handler();
        return { status: 'processed' };
      },
    );

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PaymentsController],
      providers: [
        { provide: PaymentsService, useValue: mockPaymentsService },
        { provide: SubscriptionService, useValue: mockSubscriptionService },
        { provide: CreditService, useValue: mockCreditService },
        { provide: RentalsService, useValue: mockRentalsService },
        {
          provide: OrdersService,
          useValue: { autoConfirmSkipQuoteByIntentId: jest.fn() },
        },
        {
          provide: StripeWebhookIdempotencyService,
          useValue: mockIdempotencyService,
        },
      ],
    }).compile();

    controller = module.get<PaymentsController>(PaymentsController);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Pair 1a — customer.subscription.updated WITH rentalId
  // ─────────────────────────────────────────────────────────────────────────

  describe('customer.subscription.updated — with metadata.rentalId', () => {
    it('T49a: rentalsService.handleWebhook called when metadata.rentalId is present', async () => {
      const event = fakeEvent('customer.subscription.updated', {
        id: 'sub_rental_123',
        status: 'past_due',
        metadata: {
          rentalId: 'r1',
          userId: 'user-1',
          productId: 'product-1',
        },
        current_period_start: 1000000,
        current_period_end: 1002592000,
      });

      mockPaymentsService.constructWebhookEvent.mockReturnValueOnce(event);

      const req = makeRawRequest(event);
      await controller.webhook(req, 'sig_test');

      expect(mockRentalsService.handleWebhook).toHaveBeenCalledTimes(1);
      expect(mockRentalsService.handleWebhook).toHaveBeenCalledWith(event);
    });

    it('T49a-sub: subscriptionService.handleWebhook ALSO called (free-shipping path unaffected)', async () => {
      const event = fakeEvent('customer.subscription.updated', {
        id: 'sub_rental_123',
        status: 'past_due',
        metadata: {
          rentalId: 'r1',
        },
        current_period_start: 1000000,
        current_period_end: 1002592000,
      });

      mockPaymentsService.constructWebhookEvent.mockReturnValueOnce(event);

      const req = makeRawRequest(event);
      await controller.webhook(req, 'sig_test');

      // Both handlers called
      expect(mockSubscriptionService.handleWebhook).toHaveBeenCalledTimes(1);
      expect(mockRentalsService.handleWebhook).toHaveBeenCalledTimes(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Pair 1b — customer.subscription.updated WITHOUT rentalId
  // ─────────────────────────────────────────────────────────────────────────

  describe('customer.subscription.updated — without metadata.rentalId', () => {
    it('T49b: rentalsService.handleWebhook NOT called when no rentalId', async () => {
      const event = fakeEvent('customer.subscription.updated', {
        id: 'sub_free_shipping',
        status: 'active',
        metadata: {
          userId: 'user-free-shipping',
          // NO rentalId
        },
        current_period_start: 1000000,
        current_period_end: 1002592000,
      });

      mockPaymentsService.constructWebhookEvent.mockReturnValueOnce(event);

      const req = makeRawRequest(event);
      await controller.webhook(req, 'sig_test');

      // subscriptionService STILL called
      expect(mockSubscriptionService.handleWebhook).toHaveBeenCalledTimes(1);

      // rentalsService NOT called
      expect(mockRentalsService.handleWebhook).not.toHaveBeenCalled();
    });

    it('T49b-empty: rentalsService NOT called when metadata is empty object', async () => {
      const event = fakeEvent('customer.subscription.updated', {
        id: 'sub_no_metadata',
        status: 'active',
        metadata: {},
        current_period_start: 1000000,
        current_period_end: 1002592000,
      });

      mockPaymentsService.constructWebhookEvent.mockReturnValueOnce(event);

      await controller.webhook(makeRawRequest(event), 'sig_test');

      expect(mockRentalsService.handleWebhook).not.toHaveBeenCalled();
    });

    it('T49b-null: rentalsService NOT called when metadata is null/undefined', async () => {
      const event = fakeEvent('customer.subscription.updated', {
        id: 'sub_null_metadata',
        status: 'active',
        // metadata omitted
        current_period_start: 1000000,
        current_period_end: 1002592000,
      });

      mockPaymentsService.constructWebhookEvent.mockReturnValueOnce(event);

      await controller.webhook(makeRawRequest(event), 'sig_test');

      expect(mockRentalsService.handleWebhook).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Pair 1c — invoice.payment_succeeded: fetch subscription to read rentalId
  // ─────────────────────────────────────────────────────────────────────────

  describe('invoice.payment_succeeded — subscription fetch to read rentalId', () => {
    it('T49c: invoice event with subscription fetched having rentalId → rentalsService.handleWebhook called', async () => {
      // For invoice events, the invoice object does NOT carry subscription metadata.
      // The controller must call paymentsService.retrieveSubscription(subId) to
      // read the subscription's metadata.rentalId before deciding to dispatch.

      const event = fakeEvent('invoice.payment_succeeded', {
        id: 'in_xxx',
        subscription: 'sub_rental_for_invoice',
        period_start: 1000000,
        period_end: 1002592000,
        // Invoice object itself doesn't carry subscription metadata
      });

      mockPaymentsService.constructWebhookEvent.mockReturnValueOnce(event);

      // Mock paymentsService.retrieveSubscription to return a sub with rentalId
      mockPaymentsService.retrieveSubscription.mockResolvedValueOnce({
        id: 'sub_rental_for_invoice',
        metadata: {
          rentalId: 'r-invoice',
          userId: 'user-1',
          productId: 'product-1',
        },
        status: 'active',
      });

      const req = makeRawRequest(event);
      await controller.webhook(req, 'sig_test');

      // After T50 implementation, controller fetches subscription and dispatches to rentalsService
      expect(mockPaymentsService.retrieveSubscription).toHaveBeenCalledWith(
        'sub_rental_for_invoice',
      );
      expect(mockRentalsService.handleWebhook).toHaveBeenCalledTimes(1);
      expect(mockRentalsService.handleWebhook).toHaveBeenCalledWith(event);
    });

    it('T49c-no-rental: invoice event with subscription having NO rentalId → rentalsService NOT called', async () => {
      const event = fakeEvent('invoice.payment_succeeded', {
        id: 'in_free_shipping',
        subscription: 'sub_free_shipping',
        period_start: 1000000,
        period_end: 1002592000,
      });

      mockPaymentsService.constructWebhookEvent.mockReturnValueOnce(event);

      // Sub has no rentalId (free-shipping subscription)
      mockPaymentsService.retrieveSubscription.mockResolvedValueOnce({
        id: 'sub_free_shipping',
        metadata: {
          userId: 'user-free',
          // no rentalId
        },
        status: 'active',
      });

      await controller.webhook(makeRawRequest(event), 'sig_test');

      // subscriptionService still called
      expect(mockSubscriptionService.handleWebhook).toHaveBeenCalledTimes(1);
      // rentalsService NOT called
      expect(mockRentalsService.handleWebhook).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Pair 1d — rentalsService failure does NOT crash webhook (ADR-5: never 500)
  // ─────────────────────────────────────────────────────────────────────────

  describe('error isolation', () => {
    it('T49d: rentalsService.handleWebhook failure is caught and logged, returns {received:true}', async () => {
      const event = fakeEvent('customer.subscription.updated', {
        id: 'sub_rental_err',
        status: 'active',
        metadata: { rentalId: 'r-err' },
        current_period_start: 1000000,
        current_period_end: 1002592000,
      });

      mockPaymentsService.constructWebhookEvent.mockReturnValueOnce(event);
      mockRentalsService.handleWebhook.mockRejectedValueOnce(
        new Error('Rental DB down'),
      );

      const req = makeRawRequest(event);
      const result = await controller.webhook(req, 'sig_test');

      // Does not throw; returns {received: true}
      expect(result).toEqual({ received: true });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Idempotency + replay protection wiring (controller-level)
  // ─────────────────────────────────────────────────────────────────────────

  describe('webhook idempotency + replay protection wiring', () => {
    it('parses Stripe-Signature t= and calls idempotency.assertFresh with it BEFORE running the handler', async () => {
      const event = fakeEvent('payment_intent.succeeded', { id: 'pi_fresh' });
      mockPaymentsService.constructWebhookEvent.mockReturnValueOnce(event);
      mockIdempotencyService.parseSignatureTimestamp.mockReturnValueOnce(
        1700000000,
      );

      await controller.webhook(makeRawRequest(event), 'sig_test');

      expect(
        mockIdempotencyService.parseSignatureTimestamp,
      ).toHaveBeenCalledWith('sig_test');

      const eventWithId = event as { id: string };
      const created: unknown = expect.any(Number);
      expect(mockIdempotencyService.assertFresh).toHaveBeenCalledWith(
        expect.objectContaining({
          id: eventWithId.id,
          type: 'payment_intent.succeeded',
          created,
        }),
        1700000000,
      );
    });

    it('returns {received:true} without re-running the handler on duplicate events', async () => {
      const event = fakeEvent('payment_intent.succeeded', { id: 'pi_dup' });
      mockPaymentsService.constructWebhookEvent.mockReturnValueOnce(event);

      // Idempotency reports a duplicate → handler must NOT run
      mockIdempotencyService.runOnce.mockImplementationOnce(() =>
        Promise.resolve({ status: 'duplicate' as const }),
      );

      const result = await controller.webhook(
        makeRawRequest(event),
        'sig_test',
      );

      expect(result).toEqual({ received: true });
      // The handler never fired, so the order-marking method was never called
      expect(mockPaymentsService.markPaidByIntentId).not.toHaveBeenCalled();
    });

    it('THROWS 500 when handler fails so Stripe retries (NC3 fix)', async () => {
      const event = fakeEvent('payment_intent.succeeded', { id: 'pi_fail' });
      mockPaymentsService.constructWebhookEvent.mockReturnValueOnce(event);
      mockIdempotencyService.runOnce.mockImplementationOnce(() =>
        Promise.resolve({
          status: 'failed' as const,
          error: new Error('downstream DB unreachable'),
        }),
      );

      // Previous behaviour returned {received:true} on failed — that 200'd
      // Stripe and DROPPED the event. New behaviour: throw 500 so Stripe
      // re-delivers and our retry_count bumps.
      await expect(
        controller.webhook(makeRawRequest(event), 'sig_test'),
      ).rejects.toBeInstanceOf(Error);
    });

    it('THROWS 500 on dead status so Stripe stops retrying after we exhaust MAX_WEBHOOK_RETRIES', async () => {
      const event = fakeEvent('payment_intent.succeeded', { id: 'pi_dead' });
      mockPaymentsService.constructWebhookEvent.mockReturnValueOnce(event);
      mockIdempotencyService.runOnce.mockImplementationOnce(() =>
        Promise.resolve({
          status: 'dead' as const,
          error: new Error('exceeded MAX_WEBHOOK_RETRIES=5'),
        }),
      );

      await expect(
        controller.webhook(makeRawRequest(event), 'sig_test'),
      ).rejects.toBeInstanceOf(Error);
    });

    it('propagates BadRequestException from assertFresh (stale event → HTTP 400)', async () => {
      const event = fakeEvent('payment_intent.succeeded', { id: 'pi_stale' });
      mockPaymentsService.constructWebhookEvent.mockReturnValueOnce(event);

      const staleErr = Object.assign(new Error('too old'), { status: 400 });
      mockIdempotencyService.assertFresh.mockImplementationOnce(() => {
        throw staleErr;
      });

      await expect(
        controller.webhook(makeRawRequest(event), 'sig_test'),
      ).rejects.toBe(staleErr);

      // Handler must NOT be reached when freshness fails
      expect(mockIdempotencyService.runOnce).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // createIntent — authenticated payment-intent creation
  // ─────────────────────────────────────────────────────────────────────────

  describe('createIntent', () => {
    it('delegates to paymentsService.createIntentForItems with the user id and dto fields', () => {
      const intentResult = { clientSecret: 'cs_123', paymentIntentId: 'pi_1' };
      mockPaymentsService.createIntentForItems.mockReturnValueOnce(intentResult);

      const user = { id: 'user-42', email: 'u@example.com' } as never;
      const dto = {
        items: [{ productId: 'prod-1', quantity: 2 }],
        usePoints: true,
        deliveryAddress: { text: '123 Main St', lat: 1, lng: 2 },
      } as never;

      const result = controller.createIntent(user, dto);

      expect(result).toBe(intentResult);
      expect(mockPaymentsService.createIntentForItems).toHaveBeenCalledWith({
        userId: 'user-42',
        items: [{ productId: 'prod-1', quantity: 2 }],
        usePoints: true,
        deliveryAddress: { text: '123 Main St', lat: 1, lng: 2 },
      });
    });

    it('forwards undefined optional fields (usePoints/deliveryAddress) unchanged', () => {
      mockPaymentsService.createIntentForItems.mockReturnValueOnce({
        clientSecret: 'cs_x',
      });

      const user = { id: 'user-7' } as never;
      const dto = { items: [{ productId: 'p', quantity: 1 }] } as never;

      controller.createIntent(user, dto);

      expect(mockPaymentsService.createIntentForItems).toHaveBeenCalledWith({
        userId: 'user-7',
        items: [{ productId: 'p', quantity: 1 }],
        usePoints: undefined,
        deliveryAddress: undefined,
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // dispatch switch — payment_intent.* order-flow branches
  // ─────────────────────────────────────────────────────────────────────────

  describe('dispatch — payment_intent.amount_capturable_updated', () => {
    it('calls markAuthorizedByIntentId with the intent id', async () => {
      const event = fakeEvent('payment_intent.amount_capturable_updated', {
        id: 'pi_auth',
      });
      mockPaymentsService.constructWebhookEvent.mockReturnValueOnce(event);

      await controller.webhook(makeRawRequest(event), 'sig_test');

      expect(mockPaymentsService.markAuthorizedByIntentId).toHaveBeenCalledWith(
        'pi_auth',
      );
      expect(mockPaymentsService.markPaidByIntentId).not.toHaveBeenCalled();
    });
  });

  describe('dispatch — payment_intent.succeeded (order flow, no credit kind)', () => {
    it('calls markPaidByIntentId when metadata.kind is not credit_payment', async () => {
      const event = fakeEvent('payment_intent.succeeded', {
        id: 'pi_order',
        metadata: { kind: 'order' },
      });
      mockPaymentsService.constructWebhookEvent.mockReturnValueOnce(event);

      await controller.webhook(makeRawRequest(event), 'sig_test');

      expect(mockPaymentsService.markPaidByIntentId).toHaveBeenCalledWith(
        'pi_order',
      );
      expect(mockCreditService.recordPaymentFromStripe).not.toHaveBeenCalled();
    });

    it('calls markPaidByIntentId when there is no metadata at all', async () => {
      const event = fakeEvent('payment_intent.succeeded', { id: 'pi_nometa' });
      mockPaymentsService.constructWebhookEvent.mockReturnValueOnce(event);

      await controller.webhook(makeRawRequest(event), 'sig_test');

      expect(mockPaymentsService.markPaidByIntentId).toHaveBeenCalledWith(
        'pi_nometa',
      );
    });
  });

  describe('dispatch — payment_intent.succeeded (credit_payment kind)', () => {
    it('records the credit payment using amount_received when present', async () => {
      const event = fakeEvent('payment_intent.succeeded', {
        id: 'pi_credit',
        amount: 5000,
        amount_received: 4200,
        metadata: { kind: 'credit_payment', userId: 'user-credit' },
      });
      mockPaymentsService.constructWebhookEvent.mockReturnValueOnce(event);

      await controller.webhook(makeRawRequest(event), 'sig_test');

      expect(mockCreditService.recordPaymentFromStripe).toHaveBeenCalledWith({
        userId: 'user-credit',
        amountCents: 4200, // amount_received preferred over amount
        stripePaymentIntentId: 'pi_credit',
      });
      // Order-flow path must NOT fire for credit payments
      expect(mockPaymentsService.markPaidByIntentId).not.toHaveBeenCalled();
    });

    it('falls back to amount when amount_received is missing', async () => {
      const event = fakeEvent('payment_intent.succeeded', {
        id: 'pi_credit2',
        amount: 7777,
        // no amount_received
        metadata: { kind: 'credit_payment', userId: 'user-credit-2' },
      });
      mockPaymentsService.constructWebhookEvent.mockReturnValueOnce(event);

      await controller.webhook(makeRawRequest(event), 'sig_test');

      expect(mockCreditService.recordPaymentFromStripe).toHaveBeenCalledWith({
        userId: 'user-credit-2',
        amountCents: 7777, // amount fallback
        stripePaymentIntentId: 'pi_credit2',
      });
    });

    it('does NOT record when userId is missing', async () => {
      const event = fakeEvent('payment_intent.succeeded', {
        id: 'pi_credit_nouser',
        amount: 1000,
        amount_received: 1000,
        metadata: { kind: 'credit_payment' }, // no userId
      });
      mockPaymentsService.constructWebhookEvent.mockReturnValueOnce(event);

      await controller.webhook(makeRawRequest(event), 'sig_test');

      expect(mockCreditService.recordPaymentFromStripe).not.toHaveBeenCalled();
    });

    it('does NOT record when amount resolves to 0 (no amount/amount_received)', async () => {
      const event = fakeEvent('payment_intent.succeeded', {
        id: 'pi_credit_zero',
        // no amount, no amount_received → 0
        metadata: { kind: 'credit_payment', userId: 'user-zero' },
      });
      mockPaymentsService.constructWebhookEvent.mockReturnValueOnce(event);

      await controller.webhook(makeRawRequest(event), 'sig_test');

      expect(mockCreditService.recordPaymentFromStripe).not.toHaveBeenCalled();
    });

    it('swallows and logs an error from credit.recordPaymentFromStripe (does not throw)', async () => {
      const event = fakeEvent('payment_intent.succeeded', {
        id: 'pi_credit_err',
        amount_received: 999,
        metadata: { kind: 'credit_payment', userId: 'user-err' },
      });
      mockPaymentsService.constructWebhookEvent.mockReturnValueOnce(event);
      mockCreditService.recordPaymentFromStripe.mockRejectedValueOnce(
        new Error('credit ledger down'),
      );

      const result = await controller.webhook(
        makeRawRequest(event),
        'sig_test',
      );

      // Error is caught internally → webhook still resolves 200
      expect(result).toEqual({ received: true });
      expect(mockCreditService.recordPaymentFromStripe).toHaveBeenCalled();
    });
  });

  describe('dispatch — payment_intent auth failure branches', () => {
    it('calls handleAuthFailureByIntentId on payment_intent.canceled', async () => {
      const event = fakeEvent('payment_intent.canceled', { id: 'pi_cancel' });
      mockPaymentsService.constructWebhookEvent.mockReturnValueOnce(event);

      await controller.webhook(makeRawRequest(event), 'sig_test');

      expect(
        mockPaymentsService.handleAuthFailureByIntentId,
      ).toHaveBeenCalledWith('pi_cancel');
    });

    it('calls handleAuthFailureByIntentId on payment_intent.payment_failed', async () => {
      const event = fakeEvent('payment_intent.payment_failed', {
        id: 'pi_failed',
      });
      mockPaymentsService.constructWebhookEvent.mockReturnValueOnce(event);

      await controller.webhook(makeRawRequest(event), 'sig_test');

      expect(
        mockPaymentsService.handleAuthFailureByIntentId,
      ).toHaveBeenCalledWith('pi_failed');
    });
  });

  describe('dispatch — subscription handler error isolation', () => {
    it('catches and logs a subscriptionService.handleWebhook failure, still returns 200', async () => {
      const event = fakeEvent('customer.subscription.created', {
        id: 'sub_err',
        metadata: {},
      });
      mockPaymentsService.constructWebhookEvent.mockReturnValueOnce(event);
      mockSubscriptionService.handleWebhook.mockRejectedValueOnce(
        new Error('subscription service exploded'),
      );

      const result = await controller.webhook(
        makeRawRequest(event),
        'sig_test',
      );

      expect(result).toEqual({ received: true });
      expect(mockSubscriptionService.handleWebhook).toHaveBeenCalledTimes(1);
      // rental path not triggered (no rentalId)
      expect(mockRentalsService.handleWebhook).not.toHaveBeenCalled();
    });
  });

  describe('dispatch — default case (unhandled event type)', () => {
    it('does nothing for an unrecognized event type', async () => {
      const event = fakeEvent('charge.refunded', { id: 'ch_1' });
      mockPaymentsService.constructWebhookEvent.mockReturnValueOnce(event);

      const result = await controller.webhook(
        makeRawRequest(event),
        'sig_test',
      );

      expect(result).toEqual({ received: true });
      expect(mockPaymentsService.markPaidByIntentId).not.toHaveBeenCalled();
      expect(mockSubscriptionService.handleWebhook).not.toHaveBeenCalled();
      expect(mockRentalsService.handleWebhook).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // resolveRentalId — invoice subscription resolution edge cases
  // ─────────────────────────────────────────────────────────────────────────

  describe('resolveRentalId — invoice subscription edge cases', () => {
    it('returns null (rental NOT dispatched) when invoice has no subscription', async () => {
      const event = fakeEvent('invoice.payment_failed', {
        id: 'in_no_sub',
        // no subscription field
      });
      mockPaymentsService.constructWebhookEvent.mockReturnValueOnce(event);

      await controller.webhook(makeRawRequest(event), 'sig_test');

      expect(mockPaymentsService.retrieveSubscription).not.toHaveBeenCalled();
      expect(mockRentalsService.handleWebhook).not.toHaveBeenCalled();
      // subscription path still runs
      expect(mockSubscriptionService.handleWebhook).toHaveBeenCalledTimes(1);
    });

    it('resolves subscription id from an object-shaped invoice.subscription', async () => {
      const event = fakeEvent('invoice.payment_succeeded', {
        id: 'in_obj_sub',
        subscription: { id: 'sub_obj_123' },
      });
      mockPaymentsService.constructWebhookEvent.mockReturnValueOnce(event);
      mockPaymentsService.retrieveSubscription.mockResolvedValueOnce({
        id: 'sub_obj_123',
        metadata: { rentalId: 'r-obj' },
      });

      await controller.webhook(makeRawRequest(event), 'sig_test');

      expect(mockPaymentsService.retrieveSubscription).toHaveBeenCalledWith(
        'sub_obj_123',
      );
      expect(mockRentalsService.handleWebhook).toHaveBeenCalledTimes(1);
    });

    it('returns null when fetched subscription has no metadata', async () => {
      const event = fakeEvent('invoice.payment_succeeded', {
        id: 'in_no_meta',
        subscription: 'sub_no_meta',
      });
      mockPaymentsService.constructWebhookEvent.mockReturnValueOnce(event);
      mockPaymentsService.retrieveSubscription.mockResolvedValueOnce({
        id: 'sub_no_meta',
        // no metadata key at all
      });

      await controller.webhook(makeRawRequest(event), 'sig_test');

      expect(mockPaymentsService.retrieveSubscription).toHaveBeenCalledWith(
        'sub_no_meta',
      );
      expect(mockRentalsService.handleWebhook).not.toHaveBeenCalled();
    });

    it('does not dispatch rental for checkout.session.completed without rentalId (non-subscription, non-invoice type)', async () => {
      const event = fakeEvent('checkout.session.completed', {
        id: 'cs_1',
        // checkout.session.* is neither customer.subscription.* nor invoice.*
        // so resolveRentalId returns null via the final fallthrough
      });
      mockPaymentsService.constructWebhookEvent.mockReturnValueOnce(event);

      await controller.webhook(makeRawRequest(event), 'sig_test');

      expect(mockPaymentsService.retrieveSubscription).not.toHaveBeenCalled();
      expect(mockRentalsService.handleWebhook).not.toHaveBeenCalled();
      expect(mockSubscriptionService.handleWebhook).toHaveBeenCalledTimes(1);
    });
  });
});
