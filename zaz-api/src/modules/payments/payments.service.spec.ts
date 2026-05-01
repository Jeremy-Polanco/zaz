/**
 * Unit specs for PaymentsService — credit compensating reversal path.
 *
 * Focuses on handleAuthFailureByIntentId:
 *   1. Reverses credit when an order has creditApplied > 0
 *   2. Idempotent — no double-credit on a second call for the same intent
 */

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { PaymentsService } from './payments.service';
import { Order, Product } from '../../entities';
import { OrderStatus, PaymentMethod } from '../../entities/enums';
import { PointsService } from '../points/points.service';
import { ShippingService } from '../shipping/shipping.service';
import { CreditService } from '../credit/credit.service';
import { createMockStripe, MockStripe } from '../../test-utils/stripe';

// ---------------------------------------------------------------------------
// Module-level Stripe mock
// Production code uses `import Stripe = require('stripe')` (CommonJS interop).
// ---------------------------------------------------------------------------
jest.mock('stripe', () => {
  const mock = jest.fn().mockImplementation(() => mockStripeInstance);
  (mock as unknown as Record<string, unknown>)['default'] = mock;
  return mock;
});

let mockStripeInstance: MockStripe;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRepoMock<T>(): jest.Mocked<Repository<T>> {
  return {
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    create: jest.fn((dto: Partial<T>) => dto as T),
  } as unknown as jest.Mocked<Repository<T>>;
}

function fakeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'order-1',
    customerId: 'user-1',
    status: OrderStatus.QUOTED,
    deliveryAddress: { text: '123 Test' },
    subtotal: '10.00',
    pointsRedeemed: '0.00',
    shipping: '0.00',
    tax: '0.00',
    taxRate: '0.08887',
    totalAmount: '10.00',
    creditApplied: '5.00',
    paymentMethod: PaymentMethod.DIGITAL,
    stripePaymentIntentId: 'pi_test_1',
    paidAt: null,
    quotedAt: new Date(),
    authorizedAt: null,
    capturedAt: null,
    wasSubscriberAtQuote: false,
    createdAt: new Date(),
    items: [],
    customer: {} as never,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('PaymentsService', () => {
  let service: PaymentsService;
  let ordersRepo: jest.Mocked<Repository<Order>>;
  let productsRepo: jest.Mocked<Repository<Product>>;
  let creditService: jest.Mocked<CreditService>;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    mockStripeInstance = createMockStripe();

    ordersRepo = makeRepoMock<Order>();
    productsRepo = makeRepoMock<Product>();

    creditService = {
      reverseCharge: jest.fn(),
      assertNotOverdue: jest.fn(),
      applyCharge: jest.fn(),
      getAccountWithLock: jest.fn(),
    } as unknown as jest.Mocked<CreditService>;

    configService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'STRIPE_SECRET_KEY') return 'sk_test_dummy';
        if (key === 'STRIPE_WEBHOOK_SECRET') return 'whsec_test';
        return undefined;
      }),
      getOrThrow: jest.fn(),
    } as unknown as jest.Mocked<ConfigService>;

    const pointsService = {
      getBalance: jest.fn().mockResolvedValue({ claimableCents: 0 }),
    } as unknown as jest.Mocked<PointsService>;

    const shippingService = {
      computeQuote: jest.fn().mockResolvedValue({ shippingCents: 0 }),
    } as unknown as jest.Mocked<ShippingService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: getRepositoryToken(Order), useValue: ordersRepo },
        { provide: getRepositoryToken(Product), useValue: productsRepo },
        { provide: ConfigService, useValue: configService },
        { provide: PointsService, useValue: pointsService },
        { provide: ShippingService, useValue: shippingService },
        { provide: CreditService, useValue: creditService },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
    // Trigger onModuleInit to initialize Stripe
    service.onModuleInit();
  });

  // -------------------------------------------------------------------------
  // handleAuthFailureByIntentId
  // -------------------------------------------------------------------------

  describe('handleAuthFailureByIntentId', () => {
    it('reverses credit when order has creditApplied > 0', async () => {
      const order = fakeOrder({ creditApplied: '5.00', status: OrderStatus.QUOTED });
      ordersRepo.findOne.mockResolvedValue(order);
      ordersRepo.update.mockResolvedValue({ affected: 1 } as never);
      creditService.reverseCharge.mockResolvedValue({ amountCents: 500 } as never);

      await service.handleAuthFailureByIntentId('pi_test_1');

      expect(ordersRepo.update).toHaveBeenCalledWith('order-1', {
        status: OrderStatus.QUOTED,
        stripePaymentIntentId: null,
        authorizedAt: null,
      });
      expect(creditService.reverseCharge).toHaveBeenCalledWith('order-1');
    });

    it('is idempotent — does not call reverseCharge when order has creditApplied=0', async () => {
      const order = fakeOrder({
        creditApplied: '0.00',
        status: OrderStatus.QUOTED,
        stripePaymentIntentId: 'pi_test_1',
      });
      ordersRepo.findOne.mockResolvedValue(order);
      ordersRepo.update.mockResolvedValue({ affected: 1 } as never);

      await service.handleAuthFailureByIntentId('pi_test_1');

      expect(ordersRepo.update).toHaveBeenCalled();
      expect(creditService.reverseCharge).not.toHaveBeenCalled();
    });

    it('is a no-op when no order is found for the intentId', async () => {
      ordersRepo.findOne.mockResolvedValue(null);

      await service.handleAuthFailureByIntentId('pi_nonexistent');

      expect(ordersRepo.update).not.toHaveBeenCalled();
      expect(creditService.reverseCharge).not.toHaveBeenCalled();
    });

    it('is a no-op when order has already been paid (paidAt set)', async () => {
      const order = fakeOrder({
        paidAt: new Date(),
        status: OrderStatus.DELIVERED,
        creditApplied: '5.00',
      });
      ordersRepo.findOne.mockResolvedValue(order);

      await service.handleAuthFailureByIntentId('pi_test_1');

      expect(ordersRepo.update).not.toHaveBeenCalled();
      expect(creditService.reverseCharge).not.toHaveBeenCalled();
    });

    it('is a no-op when order is in a terminal status that is not QUOTED or PENDING_VALIDATION', async () => {
      const order = fakeOrder({
        status: OrderStatus.DELIVERED,
        paidAt: null,
        creditApplied: '5.00',
      });
      ordersRepo.findOne.mockResolvedValue(order);

      await service.handleAuthFailureByIntentId('pi_test_1');

      expect(ordersRepo.update).not.toHaveBeenCalled();
      expect(creditService.reverseCharge).not.toHaveBeenCalled();
    });
  });
});
