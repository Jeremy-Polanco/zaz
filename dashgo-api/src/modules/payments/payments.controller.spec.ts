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

function fakeEvent(type: string, data: object): object {
  return {
    type,
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
  markAuthorizedByIntentId: jest.fn().mockResolvedValue(undefined),
  markPaidByIntentId: jest.fn().mockResolvedValue(undefined),
  handleAuthFailureByIntentId: jest.fn().mockResolvedValue(undefined),
  retrieveSubscription: jest.fn().mockResolvedValue({ id: 'sub_default', metadata: {} }),
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

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('PaymentsController — webhook rental dispatch (T49/T50)', () => {
  let controller: PaymentsController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PaymentsController],
      providers: [
        { provide: PaymentsService, useValue: mockPaymentsService },
        { provide: SubscriptionService, useValue: mockSubscriptionService },
        { provide: CreditService, useValue: mockCreditService },
        { provide: RentalsService, useValue: mockRentalsService },
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
      expect(mockPaymentsService.retrieveSubscription).toHaveBeenCalledWith('sub_rental_for_invoice');
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
      mockRentalsService.handleWebhook.mockRejectedValueOnce(new Error('Rental DB down'));

      const req = makeRawRequest(event);
      const result = await controller.webhook(req, 'sig_test');

      // Does not throw; returns {received: true}
      expect(result).toEqual({ received: true });
    });
  });
});
