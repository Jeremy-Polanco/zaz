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
    customerNameSnapshot: null,
    customerPhoneSnapshot: null,
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

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'prod-1',
    name: 'Test Product',
    priceToPublic: '5.00',
    isAvailable: true,
    offerDiscountPct: null,
    offerStartsAt: null,
    offerEndsAt: null,
    ...overrides,
  } as unknown as Product;
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
  let pointsService: jest.Mocked<PointsService>;
  let shippingService: jest.Mocked<ShippingService>;

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

    pointsService = {
      getBalance: jest.fn().mockResolvedValue({ claimableCents: 0 }),
    } as unknown as jest.Mocked<PointsService>;

    shippingService = {
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

    it('reverts a PENDING_VALIDATION order back to QUOTED', async () => {
      const order = fakeOrder({
        status: OrderStatus.PENDING_VALIDATION,
        creditApplied: '0.00',
        paidAt: null,
      });
      ordersRepo.findOne.mockResolvedValue(order);
      ordersRepo.update.mockResolvedValue({ affected: 1 } as never);

      await service.handleAuthFailureByIntentId('pi_test_1');

      expect(ordersRepo.update).toHaveBeenCalledWith(
        'order-1',
        expect.objectContaining({ status: OrderStatus.QUOTED }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Builds a PaymentsService with a custom ConfigService implementation, so we
  // can exercise the disabled-Stripe and missing-webhook-secret branches.
  // -------------------------------------------------------------------------
  async function buildService(
    configImpl: (key: string) => unknown,
  ): Promise<PaymentsService> {
    const cfg = {
      get: jest.fn().mockImplementation(configImpl),
      getOrThrow: jest.fn(),
    } as unknown as jest.Mocked<ConfigService>;
    const mod = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: getRepositoryToken(Order), useValue: ordersRepo },
        { provide: getRepositoryToken(Product), useValue: productsRepo },
        { provide: ConfigService, useValue: cfg },
        { provide: PointsService, useValue: pointsService },
        { provide: ShippingService, useValue: shippingService },
        { provide: CreditService, useValue: creditService },
      ],
    }).compile();
    const svc = mod.get<PaymentsService>(PaymentsService);
    svc.onModuleInit();
    return svc;
  }

  // -------------------------------------------------------------------------
  // onModuleInit / isEnabled / requireStripe
  // -------------------------------------------------------------------------
  describe('onModuleInit / isEnabled', () => {
    it('initializes Stripe and reports enabled when STRIPE_SECRET_KEY is set', () => {
      expect(service.isEnabled()).toBe(true);
    });

    it('stays disabled when STRIPE_SECRET_KEY is missing', async () => {
      const disabled = await buildService((key) =>
        key === 'STRIPE_WEBHOOK_SECRET' ? 'whsec_test' : undefined,
      );
      expect(disabled.isEnabled()).toBe(false);
    });

    it('methods throw ServiceUnavailable when Stripe is disabled', async () => {
      const disabled = await buildService(() => undefined);
      await expect(disabled.retrieveIntent('pi_x')).rejects.toThrow(
        'Stripe no configurado en el servidor',
      );
    });
  });

  // -------------------------------------------------------------------------
  // createIntentForItems
  // -------------------------------------------------------------------------
  describe('createIntentForItems', () => {
    it('computes subtotal + shipping + tax and creates a PaymentIntent', async () => {
      productsRepo.find.mockResolvedValue([
        makeProduct({ id: 'prod-1', priceToPublic: '5.00' }),
      ]);
      mockStripeInstance.paymentIntents.create.mockResolvedValueOnce({
        id: 'pi_new',
        client_secret: 'secret_new',
        amount: 1089,
        currency: 'usd',
      });

      const result = await service.createIntentForItems({
        userId: 'user-1',
        items: [{ productId: 'prod-1', quantity: 2 }],
      });

      // subtotal 1000, shipping 0, tax round(1000 * 0.08887) = 89, total 1089
      expect(mockStripeInstance.paymentIntents.create).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 1089, currency: 'usd' }),
        { idempotencyKey: 'user_user-1_intent' },
      );
      expect(result).toEqual({
        paymentIntentId: 'pi_new',
        clientSecret: 'secret_new',
        amount: 1089,
        currency: 'usd',
      });
    });

    it('throws when a product does not exist', async () => {
      productsRepo.find.mockResolvedValue([]);
      await expect(
        service.createIntentForItems({
          userId: 'u',
          items: [{ productId: 'missing', quantity: 1 }],
        }),
      ).rejects.toThrow('Uno o más productos no existen');
    });

    it('throws when a product is not available', async () => {
      productsRepo.find.mockResolvedValue([
        makeProduct({ id: 'prod-1', isAvailable: false }),
      ]);
      await expect(
        service.createIntentForItems({
          userId: 'u',
          items: [{ productId: 'prod-1', quantity: 1 }],
        }),
      ).rejects.toThrow('no está disponible');
    });

    it('throws "Monto inválido" when subtotal is zero', async () => {
      productsRepo.find.mockResolvedValue([
        makeProduct({ id: 'prod-1', priceToPublic: '0.00' }),
      ]);
      await expect(
        service.createIntentForItems({
          userId: 'u',
          items: [{ productId: 'prod-1', quantity: 1 }],
        }),
      ).rejects.toThrow('Monto inválido');
    });

    it('redeems claimable points and reduces the taxable base', async () => {
      productsRepo.find.mockResolvedValue([
        makeProduct({ id: 'prod-1', priceToPublic: '10.00' }),
      ]);
      pointsService.getBalance.mockResolvedValueOnce({
        claimableCents: 300,
      } as never);

      await service.createIntentForItems({
        userId: 'user-1',
        usePoints: true,
        items: [{ productId: 'prod-1', quantity: 1 }],
      });

      // subtotal 1000, points 300 → taxable 700, tax round(700*0.08887)=62, total 762
      expect(mockStripeInstance.paymentIntents.create).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 762 }),
        expect.anything(),
      );
    });

    it('includes shipping in the taxable base and maps null client_secret to ""', async () => {
      productsRepo.find.mockResolvedValue([
        makeProduct({ id: 'prod-1', priceToPublic: '5.00' }),
      ]);
      shippingService.computeQuote.mockResolvedValueOnce({
        shippingCents: 200,
      } as never);
      mockStripeInstance.paymentIntents.create.mockResolvedValueOnce({
        id: 'pi_ship',
        client_secret: null,
        amount: 762,
        currency: 'usd',
      });

      const result = await service.createIntentForItems({
        userId: 'u',
        items: [{ productId: 'prod-1', quantity: 1 }],
        deliveryAddress: { text: 'x', lat: 1, lng: 2 },
      });

      // subtotal 500 + shipping 200 = 700, tax round(700*0.08887)=62, total 762
      expect(mockStripeInstance.paymentIntents.create).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 762 }),
        expect.anything(),
      );
      expect(result.clientSecret).toBe('');
    });
  });

  // -------------------------------------------------------------------------
  // createCreditPaymentIntent
  // -------------------------------------------------------------------------
  describe('createCreditPaymentIntent', () => {
    it('creates an intent tagged kind=credit_payment', async () => {
      mockStripeInstance.paymentIntents.create.mockResolvedValueOnce({
        id: 'pi_credit',
        client_secret: 'cs',
        amount: 500,
        currency: 'usd',
      });

      const result = await service.createCreditPaymentIntent({
        userId: 'user-1',
        amountCents: 500,
      });

      expect(mockStripeInstance.paymentIntents.create).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 500,
          metadata: expect.objectContaining({
            kind: 'credit_payment',
            userId: 'user-1',
          }),
        }),
      );
      expect(result).toEqual({
        paymentIntentId: 'pi_credit',
        clientSecret: 'cs',
        amount: 500,
        currency: 'usd',
      });
    });

    it.each([0, -100, 1.5])('rejects invalid amount %p', async (amt) => {
      await expect(
        service.createCreditPaymentIntent({ userId: 'u', amountCents: amt }),
      ).rejects.toThrow('Monto inválido');
    });
  });

  // -------------------------------------------------------------------------
  // createAuthorizationIntent
  // -------------------------------------------------------------------------
  describe('createAuthorizationIntent', () => {
    it('creates a manual-capture intent without customer/setup_future_usage', async () => {
      mockStripeInstance.paymentIntents.create.mockResolvedValueOnce({
        id: 'pi_auth',
        client_secret: 'cs',
        amount: 1500,
        currency: 'usd',
      });

      const result = await service.createAuthorizationIntent({
        userId: 'user-1',
        orderId: 'order-9',
        amountCents: 1500,
      });

      const [params, opts] =
        mockStripeInstance.paymentIntents.create.mock.calls[0];
      expect(params).toMatchObject({
        amount: 1500,
        capture_method: 'manual',
        metadata: { userId: 'user-1', orderId: 'order-9' },
      });
      expect(params).not.toHaveProperty('customer');
      expect(params).not.toHaveProperty('setup_future_usage');
      expect(opts).toEqual({ idempotencyKey: 'order_order-9_intent' });
      expect(result.paymentIntentId).toBe('pi_auth');
    });

    it('adds customer + setup_future_usage for off_session rental carts', async () => {
      await service.createAuthorizationIntent({
        userId: 'u',
        orderId: 'o',
        amountCents: 2000,
        customerId: 'cus_1',
        setupFutureUsage: 'off_session',
      });

      const [params] = mockStripeInstance.paymentIntents.create.mock.calls[0];
      expect(params).toMatchObject({
        customer: 'cus_1',
        setup_future_usage: 'off_session',
      });
    });

    it.each([0, -1, 2.5])('rejects invalid amount %p', async (amt) => {
      await expect(
        service.createAuthorizationIntent({
          userId: 'u',
          orderId: 'o',
          amountCents: amt,
        }),
      ).rejects.toThrow('Monto inválido');
    });
  });

  // -------------------------------------------------------------------------
  // retrieve / capture delegators
  // -------------------------------------------------------------------------
  describe('retrieve and capture delegators', () => {
    it('retrieveIntent delegates to stripe.paymentIntents.retrieve', async () => {
      mockStripeInstance.paymentIntents.retrieve.mockResolvedValueOnce({
        id: 'pi_r',
      });
      await expect(service.retrieveIntent('pi_r')).resolves.toMatchObject({
        id: 'pi_r',
      });
      expect(mockStripeInstance.paymentIntents.retrieve).toHaveBeenCalledWith(
        'pi_r',
      );
    });

    it('retrieveSubscription delegates to stripe.subscriptions.retrieve', async () => {
      mockStripeInstance.subscriptions.retrieve.mockResolvedValueOnce({
        id: 'sub_r',
      });
      await expect(
        service.retrieveSubscription('sub_r'),
      ).resolves.toMatchObject({ id: 'sub_r' });
      expect(mockStripeInstance.subscriptions.retrieve).toHaveBeenCalledWith(
        'sub_r',
      );
    });

    it('captureIntent delegates to stripe.paymentIntents.capture', async () => {
      mockStripeInstance.paymentIntents.capture.mockResolvedValueOnce({
        id: 'pi_c',
        status: 'succeeded',
      });
      await expect(service.captureIntent('pi_c')).resolves.toMatchObject({
        status: 'succeeded',
      });
      expect(mockStripeInstance.paymentIntents.capture).toHaveBeenCalledWith(
        'pi_c',
      );
    });
  });

  // -------------------------------------------------------------------------
  // constructWebhookEvent
  // -------------------------------------------------------------------------
  describe('constructWebhookEvent', () => {
    it('constructs the event when secret + signature are present', () => {
      const event = { type: 'payment_intent.succeeded' };
      mockStripeInstance.webhooks.constructEvent.mockReturnValueOnce(event);

      const result = service.constructWebhookEvent(Buffer.from('{}'), 'sig_1');

      expect(result).toBe(event);
      expect(mockStripeInstance.webhooks.constructEvent).toHaveBeenCalledWith(
        Buffer.from('{}'),
        'sig_1',
        'whsec_test',
      );
    });

    it('throws when the signature header is missing', () => {
      expect(() =>
        service.constructWebhookEvent(Buffer.from('{}'), undefined),
      ).toThrow('Stripe-Signature header requerido');
    });

    it('throws when no webhook secret is configured', async () => {
      const noSecret = await buildService((key) =>
        key === 'STRIPE_SECRET_KEY' ? 'sk_test_dummy' : undefined,
      );
      expect(() =>
        noSecret.constructWebhookEvent(Buffer.from('{}'), 'sig'),
      ).toThrow('Webhook secret no configurado');
    });
  });

  // -------------------------------------------------------------------------
  // markPaidByIntentId / markAuthorizedByIntentId
  // -------------------------------------------------------------------------
  describe('markPaidByIntentId', () => {
    it('stamps paidAt on the matching unpaid order', async () => {
      ordersRepo.update.mockResolvedValue({ affected: 1 } as never);
      await service.markPaidByIntentId('pi_1');
      expect(ordersRepo.update).toHaveBeenCalledWith(
        expect.objectContaining({ stripePaymentIntentId: 'pi_1' }),
        expect.objectContaining({ paidAt: expect.any(Date) }),
      );
    });
  });

  describe('markAuthorizedByIntentId', () => {
    it('moves a QUOTED order to PENDING_VALIDATION', async () => {
      ordersRepo.findOne.mockResolvedValue(
        fakeOrder({ id: 'order-2', status: OrderStatus.QUOTED }),
      );
      ordersRepo.update.mockResolvedValue({ affected: 1 } as never);

      await service.markAuthorizedByIntentId('pi_1');

      expect(ordersRepo.update).toHaveBeenCalledWith(
        'order-2',
        expect.objectContaining({
          status: OrderStatus.PENDING_VALIDATION,
          authorizedAt: expect.any(Date),
        }),
      );
    });

    it('is a no-op when no order matches the intent', async () => {
      ordersRepo.findOne.mockResolvedValue(null);
      await service.markAuthorizedByIntentId('pi_x');
      expect(ordersRepo.update).not.toHaveBeenCalled();
    });

    it('is a no-op when the order is not QUOTED', async () => {
      ordersRepo.findOne.mockResolvedValue(
        fakeOrder({ status: OrderStatus.PENDING_VALIDATION }),
      );
      await service.markAuthorizedByIntentId('pi_1');
      expect(ordersRepo.update).not.toHaveBeenCalled();
    });
  });
});
