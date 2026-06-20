/**
 * Unit specs for OrdersService — credit and subscription branches.
 *
 * Tests focus on: overdue gate, credit application by role, subscription
 * shipping override, and idempotent credit reversal on CANCELLED.
 */

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { OrdersService } from './orders.service';
import { Order, OrderItem, Product } from '../../entities';
import { UserAddress } from '../../entities/user-address.entity';
import { OrderStatus, PaymentMethod, UserRole } from '../../entities/enums';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { PaymentsService } from '../payments/payments.service';
import { PointsService } from '../points/points.service';
import { InvoicesService } from '../invoices/invoices.service';
import { PromotersService } from '../promoters/promoters.service';
import { ShippingService } from '../shipping/shipping.service';
import { CreditService } from '../credit/credit.service';
import { SubscriptionService } from '../subscription/subscription.service';
import { TwilioService } from '../twilio/twilio.service';
import { RentalsService } from '../rentals/rentals.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRepoMock<T>(): jest.Mocked<Repository<T>> {
  return {
    find: jest.fn(),
    findOne: jest.fn(),
    findOneOrFail: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    create: jest.fn((dto: Partial<T>) => dto as T),
    createQueryBuilder: jest.fn(),
    count: jest.fn(),
  } as unknown as jest.Mocked<Repository<T>>;
}

function fakeUser(role: UserRole = UserRole.CLIENT): AuthenticatedUser {
  return { id: 'user-1', role, email: null };
}

function fakeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'prod-1',
    name: 'Test Product',
    isAvailable: true,
    stock: 10,
    requiresQuote: true,         // default — orders need a manual cotización
    priceToPublic: '5.00',       // getEffectivePrice reads this; 5.00 → 500 cents
    priceCents: 500,             // legacy field used in tests that cast to unknown
    salePrice: null,
    salePriceStart: null,
    salePriceEnd: null,
    description: null,
    imageUrl: null,
    categoryId: 'cat-1',
    pricingMode: 'single_payment',
    monthlyRentCents: 0,
    lateFeeCents: 0,
    stripeProductId: null,
    stripePriceId: null,
    offerDiscountPct: null,
    offerStartsAt: null,
    offerEndsAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as Product;
}

function fakeRentalProduct(overrides: Partial<Product> = {}): Product {
  return fakeProduct({
    id: 'prod-rental-1',
    name: 'Dispenser (rental)',
    priceToPublic: '0.00',
    pricingMode: 'rental',
    monthlyRentCents: 2000,
    lateFeeCents: 300,
    stripePriceId: 'price_rental_123',
    stripeProductId: 'prod_stripe_123',
    ...overrides,
  });
}

function fakeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'order-1',
    customerId: 'user-1',
    customerNameSnapshot: null,
    customerPhoneSnapshot: null,
    status: OrderStatus.PENDING_QUOTE,
    deliveryAddress: { text: '123 Test St' },
    subtotal: '10.00',
    pointsRedeemed: '0.00',
    shipping: '0.00',
    tax: '0.00',
    taxRate: '0.08887',
    totalAmount: '10.00',
    creditApplied: '0.00',
    paymentMethod: PaymentMethod.CASH,
    stripePaymentIntentId: null,
    paidAt: null,
    quotedAt: null,
    authorizedAt: null,
    capturedAt: null,
    wasSubscriberAtQuote: false,
    skipQuote: false,
    createdAt: new Date(),
    items: [],
    customer: {} as never,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('OrdersService', () => {
  let service: OrdersService;
  let ordersRepo: jest.Mocked<Repository<Order>>;
  let itemsRepo: jest.Mocked<Repository<OrderItem>>;
  let productsRepo: jest.Mocked<Repository<Product>>;
  let userAddressesRepo: jest.Mocked<Repository<UserAddress>>;
  let dataSource: jest.Mocked<DataSource>;
  let paymentsService: jest.Mocked<PaymentsService>;
  let pointsService: jest.Mocked<PointsService>;
  let invoicesService: jest.Mocked<InvoicesService>;
  let promotersService: jest.Mocked<PromotersService>;
  let shippingService: jest.Mocked<ShippingService>;
  let creditService: jest.Mocked<CreditService>;
  let subscriptionService: jest.Mocked<SubscriptionService>;
  let twilioService: jest.Mocked<TwilioService>;
  let rentalsService: jest.Mocked<RentalsService>;

  beforeEach(async () => {
    ordersRepo = makeRepoMock<Order>();
    itemsRepo = makeRepoMock<OrderItem>();
    productsRepo = makeRepoMock<Product>();
    userAddressesRepo = makeRepoMock<UserAddress>();

    paymentsService = {
      createAuthorizationIntent: jest.fn(),
      retrieveIntent: jest.fn(),
      captureIntent: jest.fn(),
      handleAuthFailureByIntentId: jest.fn(),
    } as unknown as jest.Mocked<PaymentsService>;

    pointsService = {
      getBalance: jest.fn().mockResolvedValue({ claimableCents: 0 }),
      redeemAllClaimable: jest.fn(),
      creditForOrder: jest.fn(),
      reverseRedemptionForOrder: jest.fn(),
    } as unknown as jest.Mocked<PointsService>;

    invoicesService = {
      createForOrder: jest.fn(),
    } as unknown as jest.Mocked<InvoicesService>;

    promotersService = {
      creditCommissionsForOrder: jest.fn(),
    } as unknown as jest.Mocked<PromotersService>;

    shippingService = {
      computeQuote: jest.fn().mockResolvedValue({ shippingCents: 0 }),
    } as unknown as jest.Mocked<ShippingService>;

    creditService = {
      assertNotOverdue: jest.fn().mockResolvedValue(undefined),
      getAccountWithLock: jest.fn(),
      applyCharge: jest.fn(),
      reverseCharge: jest.fn(),
      isOverdue: jest.fn(),
    } as unknown as jest.Mocked<CreditService>;

    subscriptionService = {
      isActiveSubscriber: jest.fn().mockResolvedValue(false),
      getOrCreateStripeCustomer: jest.fn().mockResolvedValue('cus_test_default'),
      getPlanNetCents: jest.fn().mockResolvedValue(699),
    } as unknown as jest.Mocked<SubscriptionService>;

    twilioService = {
      sendOrderNotificationSms: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<TwilioService>;

    rentalsService = {
      findActiveByUserAndProduct: jest.fn().mockResolvedValue(null),
      activateRentalsForOrder: jest.fn().mockResolvedValue([]),
      activateForOrder: jest.fn().mockResolvedValue({} as never),
      createForOrder: jest.fn().mockResolvedValue({}),
      cancelPendingForOrder: jest.fn().mockResolvedValue(undefined),
      getOrderIdsWithRentals: jest.fn().mockResolvedValue([]),
      countBebederoRentalsForUser: jest.fn().mockResolvedValue(0),
      ensureBebederoRatePrices: jest.fn().mockResolvedValue({
        freePriceId: 'price_free_existing',
        subscriberPriceId: 'price_sub_existing',
      }),
    } as unknown as jest.Mocked<RentalsService>;

    dataSource = {
      transaction: jest.fn(),
      query: jest.fn(),
    } as unknown as jest.Mocked<DataSource>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: getRepositoryToken(Order), useValue: ordersRepo },
        { provide: getRepositoryToken(OrderItem), useValue: itemsRepo },
        { provide: getRepositoryToken(Product), useValue: productsRepo },
        { provide: getRepositoryToken(UserAddress), useValue: userAddressesRepo },
        { provide: DataSource, useValue: dataSource },
        { provide: PaymentsService, useValue: paymentsService },
        { provide: PointsService, useValue: pointsService },
        { provide: InvoicesService, useValue: invoicesService },
        { provide: PromotersService, useValue: promotersService },
        { provide: ShippingService, useValue: shippingService },
        { provide: CreditService, useValue: creditService },
        { provide: SubscriptionService, useValue: subscriptionService },
        { provide: TwilioService, useValue: twilioService },
        { provide: RentalsService, useValue: rentalsService },
      ],
    }).compile();

    service = module.get<OrdersService>(OrdersService);
  });

  // -------------------------------------------------------------------------
  // skip-cotización auto-confirm (PENDING_VALIDATION → CONFIRMED_BY_COLMADO)
  // -------------------------------------------------------------------------

  type ConfirmStockSpyTarget = {
    confirmAndDecrementStock(orderId: string): Promise<void>;
  };
  const spyConfirmStock = () =>
    jest
      .spyOn(
        service as unknown as ConfirmStockSpyTarget,
        'confirmAndDecrementStock',
      )
      .mockResolvedValue(undefined);

  type AutoConfirmFreeTarget = {
    tryAutoConfirmFreeOrder(orderId: string): Promise<void>;
  };
  const callAutoConfirmFree = (orderId: string) =>
    (
      service as unknown as AutoConfirmFreeTarget
    ).tryAutoConfirmFreeOrder(orderId);
  const spyAutoConfirmFree = () =>
    jest
      .spyOn(
        service as unknown as AutoConfirmFreeTarget,
        'tryAutoConfirmFreeOrder',
      )
      .mockResolvedValue(undefined);

  describe('confirmNonStripeOrder — skip-quote auto-confirm', () => {
    const user = fakeUser(UserRole.CLIENT);

    const quotedCashOrder = (overrides: Partial<Order> = {}) =>
      fakeOrder({
        status: OrderStatus.QUOTED,
        paymentMethod: PaymentMethod.CASH,
        stripePaymentIntentId: null,
        ...overrides,
      });

    it('auto-confirms a skip-quote order after cash confirm (decrements stock)', async () => {
      ordersRepo.findOne.mockResolvedValue(quotedCashOrder({ skipQuote: true }));
      ordersRepo.update.mockResolvedValue({} as never);
      const confirmSpy = spyConfirmStock();

      await service.confirmNonStripeOrder('order-1', user);

      expect(ordersRepo.update).toHaveBeenCalledWith('order-1', {
        status: OrderStatus.PENDING_VALIDATION,
      });
      expect(confirmSpy).toHaveBeenCalledWith('order-1');
    });

    it('does NOT auto-confirm a normal (non-skip-quote) order', async () => {
      ordersRepo.findOne.mockResolvedValue(
        quotedCashOrder({ skipQuote: false }),
      );
      ordersRepo.update.mockResolvedValue({} as never);
      const confirmSpy = spyConfirmStock();

      await service.confirmNonStripeOrder('order-1', user);

      expect(ordersRepo.update).toHaveBeenCalledWith('order-1', {
        status: OrderStatus.PENDING_VALIDATION,
      });
      expect(confirmSpy).not.toHaveBeenCalled();
    });

    it('is non-blocking: insufficient stock leaves the order in PENDING_VALIDATION', async () => {
      ordersRepo.findOne.mockResolvedValue(quotedCashOrder({ skipQuote: true }));
      ordersRepo.update.mockResolvedValue({} as never);
      jest
        .spyOn(
          service as unknown as ConfirmStockSpyTarget,
          'confirmAndDecrementStock',
        )
        .mockRejectedValue(new Error('Stock insuficiente'));

      await expect(
        service.confirmNonStripeOrder('order-1', user),
      ).resolves.toBeDefined();
    });
  });

  describe('autoConfirmSkipQuoteByIntentId (digital webhook)', () => {
    it('auto-confirms a skip-quote digital order once the hold is authorized', async () => {
      ordersRepo.findOne.mockResolvedValue(
        fakeOrder({
          id: 'order-9',
          skipQuote: true,
          status: OrderStatus.PENDING_VALIDATION,
          paymentMethod: PaymentMethod.DIGITAL,
          stripePaymentIntentId: 'pi_123',
        }),
      );
      const confirmSpy = spyConfirmStock();

      await service.autoConfirmSkipQuoteByIntentId('pi_123');

      expect(confirmSpy).toHaveBeenCalledWith('order-9');
    });

    it('no-op for a normal (non-skip-quote) order', async () => {
      ordersRepo.findOne.mockResolvedValue(
        fakeOrder({
          skipQuote: false,
          status: OrderStatus.PENDING_VALIDATION,
          stripePaymentIntentId: 'pi_123',
        }),
      );
      const confirmSpy = spyConfirmStock();

      await service.autoConfirmSkipQuoteByIntentId('pi_123');

      expect(confirmSpy).not.toHaveBeenCalled();
    });

    it('no-op when the order is not in PENDING_VALIDATION', async () => {
      ordersRepo.findOne.mockResolvedValue(
        fakeOrder({
          skipQuote: true,
          status: OrderStatus.QUOTED,
          stripePaymentIntentId: 'pi_123',
        }),
      );
      const confirmSpy = spyConfirmStock();

      await service.autoConfirmSkipQuoteByIntentId('pi_123');

      expect(confirmSpy).not.toHaveBeenCalled();
    });

    it('no-op when no order matches the intent', async () => {
      ordersRepo.findOne.mockResolvedValue(null);
      const confirmSpy = spyConfirmStock();

      await service.autoConfirmSkipQuoteByIntentId('pi_unknown');

      expect(confirmSpy).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // free-shipping auto-confirm (customer never taps "Confirmar pedido")
  // -------------------------------------------------------------------------

  describe('tryAutoConfirmFreeOrder — free-shipping / $0 auto-confirm', () => {
    const freeQuotedCash = (overrides: Partial<Order> = {}) =>
      fakeOrder({
        status: OrderStatus.QUOTED,
        paymentMethod: PaymentMethod.CASH,
        shipping: '0.00',
        totalAmount: '0.00',
        creditApplied: '0.00',
        stripePaymentIntentId: null,
        ...overrides,
      });

    it('auto-confirms a free-shipping cash order (PENDING_VALIDATION + decrement stock)', async () => {
      ordersRepo.findOne.mockResolvedValue(freeQuotedCash());
      ordersRepo.update.mockResolvedValue({} as never);
      const confirmSpy = spyConfirmStock();

      await callAutoConfirmFree('order-1');

      expect(ordersRepo.update).toHaveBeenCalledWith('order-1', {
        status: OrderStatus.PENDING_VALIDATION,
      });
      expect(confirmSpy).toHaveBeenCalledWith('order-1');
    });

    it('does NOT auto-confirm when shipping is charged (> 0)', async () => {
      ordersRepo.findOne.mockResolvedValue(
        freeQuotedCash({ shipping: '5.00', totalAmount: '15.00' }),
      );
      const confirmSpy = spyConfirmStock();

      await callAutoConfirmFree('order-1');

      expect(confirmSpy).not.toHaveBeenCalled();
    });

    it('does NOT auto-confirm a digital order that still owes a card charge', async () => {
      ordersRepo.findOne.mockResolvedValue(
        freeQuotedCash({
          paymentMethod: PaymentMethod.DIGITAL,
          totalAmount: '10.00',
          creditApplied: '0.00',
        }),
      );
      const confirmSpy = spyConfirmStock();

      await callAutoConfirmFree('order-1');

      expect(confirmSpy).not.toHaveBeenCalled();
    });

    it('auto-confirms a $0 digital order (nothing owed by card)', async () => {
      ordersRepo.findOne.mockResolvedValue(
        freeQuotedCash({ paymentMethod: PaymentMethod.DIGITAL, totalAmount: '0.00' }),
      );
      ordersRepo.update.mockResolvedValue({} as never);
      const confirmSpy = spyConfirmStock();

      await callAutoConfirmFree('order-1');

      expect(confirmSpy).toHaveBeenCalledWith('order-1');
    });

    it('auto-confirms a free-shipping digital order fully covered by credit', async () => {
      ordersRepo.findOne.mockResolvedValue(
        freeQuotedCash({
          paymentMethod: PaymentMethod.DIGITAL,
          totalAmount: '10.00',
          creditApplied: '10.00',
        }),
      );
      ordersRepo.update.mockResolvedValue({} as never);
      const confirmSpy = spyConfirmStock();

      await callAutoConfirmFree('order-1');

      expect(confirmSpy).toHaveBeenCalledWith('order-1');
    });

    it('no-op when the order is not QUOTED', async () => {
      ordersRepo.findOne.mockResolvedValue(
        freeQuotedCash({ status: OrderStatus.PENDING_QUOTE }),
      );
      const confirmSpy = spyConfirmStock();

      await callAutoConfirmFree('order-1');

      expect(confirmSpy).not.toHaveBeenCalled();
    });

    it('no-op when a digital hold is already pending (stripePaymentIntentId set)', async () => {
      ordersRepo.findOne.mockResolvedValue(
        freeQuotedCash({
          paymentMethod: PaymentMethod.DIGITAL,
          stripePaymentIntentId: 'pi_1',
        }),
      );
      const confirmSpy = spyConfirmStock();

      await callAutoConfirmFree('order-1');

      expect(confirmSpy).not.toHaveBeenCalled();
    });

    it('no-op when no order matches the id', async () => {
      ordersRepo.findOne.mockResolvedValue(null);
      const confirmSpy = spyConfirmStock();

      await callAutoConfirmFree('order-x');

      expect(confirmSpy).not.toHaveBeenCalled();
    });

    it('is non-blocking: a stock failure does not throw', async () => {
      ordersRepo.findOne.mockResolvedValue(freeQuotedCash());
      ordersRepo.update.mockResolvedValue({} as never);
      jest
        .spyOn(
          service as unknown as ConfirmStockSpyTarget,
          'confirmAndDecrementStock',
        )
        .mockRejectedValue(new Error('Stock insuficiente'));

      await expect(callAutoConfirmFree('order-1')).resolves.toBeUndefined();
    });
  });

  describe('backfillAutoConfirmFreeShippingOrders (one-time backfill)', () => {
    it('runs auto-confirm on every QUOTED order and counts those confirmed', async () => {
      ordersRepo.find.mockResolvedValue([
        fakeOrder({ id: 'o1', status: OrderStatus.QUOTED }),
        fakeOrder({ id: 'o2', status: OrderStatus.QUOTED }),
      ]);
      const autoSpy = spyAutoConfirmFree();
      // Post-confirm re-fetch: o1 became confirmed, o2 stayed QUOTED (didn't qualify)
      ordersRepo.findOne
        .mockResolvedValueOnce(
          fakeOrder({ id: 'o1', status: OrderStatus.CONFIRMED_BY_COLMADO }),
        )
        .mockResolvedValueOnce(fakeOrder({ id: 'o2', status: OrderStatus.QUOTED }));

      const result = await service.backfillAutoConfirmFreeShippingOrders();

      expect(ordersRepo.find).toHaveBeenCalledWith({
        where: { status: OrderStatus.QUOTED },
      });
      expect(autoSpy).toHaveBeenCalledWith('o1');
      expect(autoSpy).toHaveBeenCalledWith('o2');
      expect(result).toEqual({ scanned: 2, confirmed: 1 });
    });

    it('returns zero and runs nothing when there are no QUOTED orders', async () => {
      ordersRepo.find.mockResolvedValue([]);
      const autoSpy = spyAutoConfirmFree();

      const result = await service.backfillAutoConfirmFreeShippingOrders();

      expect(autoSpy).not.toHaveBeenCalled();
      expect(result).toEqual({ scanned: 0, confirmed: 0 });
    });
  });

  describe('cancelNonRentalOrders (one-time op)', () => {
    type CancelReversalsTarget = {
      cancelOrderWithReversals(order: Order): Promise<void>;
    };
    const spyCancelReversals = () =>
      jest
        .spyOn(
          service as unknown as CancelReversalsTarget,
          'cancelOrderWithReversals',
        )
        .mockResolvedValue(undefined);

    it('dry run: reports the breakdown by status and writes nothing', async () => {
      rentalsService.getOrderIdsWithRentals.mockResolvedValue(['o-rental']);
      ordersRepo.find.mockResolvedValue([
        fakeOrder({ id: 'o-rental', status: OrderStatus.QUOTED }), // kept (rental-linked)
        fakeOrder({ id: 'o1', status: OrderStatus.QUOTED }),
        fakeOrder({ id: 'o2', status: OrderStatus.PENDING_QUOTE }),
        fakeOrder({ id: 'o3', status: OrderStatus.CANCELLED }), // skipped (already cancelled)
      ]);
      const spy = spyCancelReversals();

      const result = await service.cancelNonRentalOrders({ dryRun: true });

      expect(spy).not.toHaveBeenCalled();
      expect(result).toEqual({
        dryRun: true,
        rentalLinkedKept: 1,
        candidates: 2,
        byStatus: {
          [OrderStatus.QUOTED]: 1,
          [OrderStatus.PENDING_QUOTE]: 1,
        },
        cancelled: 0,
        orders: [
          { id: 'o1', prevStatus: OrderStatus.QUOTED },
          { id: 'o2', prevStatus: OrderStatus.PENDING_QUOTE },
        ],
      });
    });

    it('apply: cancels non-rental, non-cancelled orders; keeps rental-linked', async () => {
      rentalsService.getOrderIdsWithRentals.mockResolvedValue(['o-rental']);
      ordersRepo.find.mockResolvedValue([
        fakeOrder({ id: 'o-rental', status: OrderStatus.QUOTED }),
        fakeOrder({ id: 'o1', status: OrderStatus.QUOTED }),
        fakeOrder({ id: 'o2', status: OrderStatus.CANCELLED }),
      ]);
      const spy = spyCancelReversals();

      const result = await service.cancelNonRentalOrders({ dryRun: false });

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ id: 'o1' }));
      expect(result.cancelled).toBe(1);
      expect(result.rentalLinkedKept).toBe(1);
    });

    it('respects the statuses filter', async () => {
      rentalsService.getOrderIdsWithRentals.mockResolvedValue([]);
      ordersRepo.find.mockResolvedValue([
        fakeOrder({ id: 'o1', status: OrderStatus.QUOTED }),
        fakeOrder({ id: 'o2', status: OrderStatus.DELIVERED }),
      ]);
      const spy = spyCancelReversals();

      const result = await service.cancelNonRentalOrders({
        dryRun: false,
        statuses: [OrderStatus.QUOTED],
      });

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ id: 'o1' }));
      expect(result.candidates).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // create — overdue gate
  // -------------------------------------------------------------------------

  describe('create', () => {
    const dto = {
      items: [{ productId: 'prod-1', quantity: 1 }],
      deliveryAddress: { text: '123 Test', lat: 18.4861, lng: -69.9312 },
      paymentMethod: PaymentMethod.CASH,
      usePoints: false,
      useCredit: false,
    } as import('./dto/create-order.dto').CreateOrderDto;

    it('throws 402 CREDIT_OVERDUE when user has overdue debt', async () => {
      creditService.assertNotOverdue.mockRejectedValue(
        new HttpException(
          { statusCode: 402, code: 'CREDIT_OVERDUE', message: 'Overdue' },
          HttpStatus.PAYMENT_REQUIRED,
        ),
      );

      await expect(service.create(fakeUser(UserRole.CLIENT), dto)).rejects.toThrow(
        HttpException,
      );

      // Verify assertNotOverdue was called before any product fetch
      expect(creditService.assertNotOverdue).toHaveBeenCalledWith('user-1');
      expect(productsRepo.find).not.toHaveBeenCalled();
    });

    it('throws 409 ACTIVE_ORDER_EXISTS when the client already has an order in progress', async () => {
      ordersRepo.count.mockResolvedValueOnce(1);

      await expect(
        service.create(fakeUser(UserRole.CLIENT), dto),
      ).rejects.toMatchObject({ response: { code: 'ACTIVE_ORDER_EXISTS' } });

      // Blocks BEFORE the overdue gate and any product fetch / TX.
      expect(creditService.assertNotOverdue).not.toHaveBeenCalled();
      expect(productsRepo.find).not.toHaveBeenCalled();
    });

    it('allows a CLIENT order when no active order exists (count = 0)', async () => {
      ordersRepo.count.mockResolvedValueOnce(0);
      productsRepo.find.mockResolvedValue([fakeProduct()]);

      const savedOrder = fakeOrder({});
      const orderWithItems = fakeOrder({ customer: fakeUser() as never, items: [] });
      (dataSource.transaction as jest.Mock).mockImplementation(
        async (cb: (mgr: EntityManager) => Promise<unknown>) => {
          const orderRepo = makeRepoMock<Order>();
          const itemRepo = makeRepoMock<OrderItem>();
          orderRepo.create.mockImplementation((d) => ({ ...d, id: 'order-1' }) as Order);
          orderRepo.save.mockResolvedValue(savedOrder);
          orderRepo.update.mockResolvedValue({ affected: 1 } as never);
          itemRepo.save.mockResolvedValue({} as never);
          itemRepo.create.mockImplementation((d) => d as OrderItem);
          const mgr = {
            getRepository: (entity: unknown) => {
              if (entity === Order) return orderRepo;
              if (entity === OrderItem) return itemRepo;
              return makeRepoMock();
            },
          };
          return cb(mgr as unknown as EntityManager);
        },
      );
      ordersRepo.findOne.mockResolvedValue(orderWithItems);

      await expect(
        service.create(fakeUser(UserRole.CLIENT), dto),
      ).resolves.toBeDefined();
      expect(productsRepo.find).toHaveBeenCalled();
    });

    it('applies credit for CLIENT with useCredit=true', async () => {
      productsRepo.find.mockResolvedValue([fakeProduct()]);

      const creditAccount = {
        balanceCents: 500,
        creditLimitCents: 200,
        userId: 'user-1',
      };
      creditService.getAccountWithLock.mockResolvedValue(creditAccount as never);
      creditService.applyCharge.mockResolvedValue({ amountCents: 500 } as never);

      const savedOrder = fakeOrder({ creditApplied: '5.00' });
      const orderWithItems = fakeOrder({
        creditApplied: '5.00',
        customer: fakeUser() as never,
        items: [],
      });

      // Simulate transaction: call the callback with a mock entity manager
      (dataSource.transaction as jest.Mock).mockImplementation(async (cb: (mgr: EntityManager) => Promise<unknown>) => {
        const orderRepo = makeRepoMock<Order>();
        const itemRepo = makeRepoMock<OrderItem>();
        orderRepo.create.mockImplementation((dto) => ({ ...dto, id: 'order-1' }) as Order);
        orderRepo.save.mockResolvedValue(savedOrder);
        orderRepo.update.mockResolvedValue({ affected: 1 } as never);
        itemRepo.save.mockResolvedValue({} as never);
        itemRepo.create.mockImplementation((dto) => dto as OrderItem);

        const mgr = {
          getRepository: (entity: unknown) => {
            if (entity === Order) return orderRepo;
            if (entity === OrderItem) return itemRepo;
            return makeRepoMock();
          },
        };
        return cb(mgr as unknown as EntityManager);
      });

      // findOne returns the order with customer relation
      ordersRepo.findOne.mockResolvedValue(orderWithItems);

      await service.create(fakeUser(UserRole.CLIENT), {
        ...dto,
        useCredit: true,
      });

      expect(creditService.getAccountWithLock).toHaveBeenCalled();
    });

    it('ignores useCredit=true for PROMOTER — no credit movement', async () => {
      productsRepo.find.mockResolvedValue([fakeProduct()]);

      const savedOrder = fakeOrder({ creditApplied: '0.00' });
      (dataSource.transaction as jest.Mock).mockImplementation(async (cb: (mgr: EntityManager) => Promise<unknown>) => {
        const orderRepo = makeRepoMock<Order>();
        const itemRepo = makeRepoMock<OrderItem>();
        orderRepo.create.mockImplementation((d) => ({ ...d, id: 'order-1' }) as Order);
        orderRepo.save.mockResolvedValue(savedOrder);
        orderRepo.update.mockResolvedValue({ affected: 1 } as never);
        itemRepo.save.mockResolvedValue({} as never);
        itemRepo.create.mockImplementation((d) => d as OrderItem);

        const mgr = {
          getRepository: (entity: unknown) => {
            if (entity === Order) return orderRepo;
            if (entity === OrderItem) return itemRepo;
            return makeRepoMock();
          },
        };
        return cb(mgr as unknown as EntityManager);
      });

      ordersRepo.findOne.mockResolvedValue(fakeOrder({ customer: fakeUser() as never }));

      await service.create(fakeUser(UserRole.PROMOTER), {
        ...dto,
        useCredit: true,
      });

      // For PROMOTER, credit is silently skipped
      expect(creditService.getAccountWithLock).not.toHaveBeenCalled();
      expect(creditService.applyCharge).not.toHaveBeenCalled();
    });

    it('ignores useCredit=true for SUPER_ADMIN_DELIVERY — no credit movement', async () => {
      // SUPER_ADMIN_DELIVERY cannot create orders (ForbiddenException)
      // Only CLIENT and PROMOTER can create orders per the service logic.
      await expect(
        service.create(fakeUser(UserRole.SUPER_ADMIN_DELIVERY), dto),
      ).rejects.toThrow(ForbiddenException);

      expect(creditService.applyCharge).not.toHaveBeenCalled();
    });

    // -----------------------------------------------------------------------
    // SMS fire-and-forget hook (REQ-12–15)
    // -----------------------------------------------------------------------

    function setupSuccessfulCreate(orderOverrides: Partial<Order> = {}) {
      productsRepo.find.mockResolvedValue([fakeProduct()]);

      const savedOrder = fakeOrder();
      const orderWithRelations = fakeOrder({
        customer: fakeUser() as never,
        items: [],
        ...orderOverrides,
      });

      (dataSource.transaction as jest.Mock).mockImplementation(
        async (cb: (mgr: EntityManager) => Promise<unknown>) => {
          const orderRepo = makeRepoMock<Order>();
          const itemRepo = makeRepoMock<OrderItem>();
          orderRepo.create.mockImplementation((d) => ({ ...d, id: 'order-1' }) as Order);
          orderRepo.save.mockResolvedValue(savedOrder);
          orderRepo.update.mockResolvedValue({ affected: 1 } as never);
          itemRepo.save.mockResolvedValue({} as never);
          itemRepo.create.mockImplementation((d) => d as OrderItem);

          const mgr = {
            getRepository: (entity: unknown) => {
              if (entity === Order) return orderRepo;
              if (entity === OrderItem) return itemRepo;
              return makeRepoMock();
            },
          };
          return cb(mgr as unknown as EntityManager);
        },
      );

      ordersRepo.findOne.mockResolvedValue(orderWithRelations);
      return orderWithRelations;
    }

    it('calls sendOrderNotificationSms with the order returned by findOne', async () => {
      const orderWithRelations = setupSuccessfulCreate();

      const result = await service.create(fakeUser(UserRole.CLIENT), dto);

      expect(twilioService.sendOrderNotificationSms).toHaveBeenCalledTimes(1);
      expect(twilioService.sendOrderNotificationSms).toHaveBeenCalledWith(
        orderWithRelations,
      );
      expect(result).toBe(orderWithRelations);
    });

    it('returns the order even when sendOrderNotificationSms returns a never-settling promise (fire-and-forget)', async () => {
      setupSuccessfulCreate();

      // sendOrderNotificationSms hangs forever — create() must still resolve
      twilioService.sendOrderNotificationSms.mockReturnValue(new Promise(() => {/* never resolves */}));

      const resultPromise = service.create(fakeUser(UserRole.CLIENT), dto);

      // Use a race: if create() awaits SMS, it would hang and this would timeout.
      // We race with a fast-resolving promise to confirm create() resolves quickly.
      const result = await Promise.race([
        resultPromise,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('create() was blocked by SMS')), 500),
        ),
      ]);

      expect(result).toBeDefined();
    });

    it('returns the order even when sendOrderNotificationSms rejects (SMS failure does not break create)', async () => {
      setupSuccessfulCreate();

      twilioService.sendOrderNotificationSms.mockRejectedValue(
        new Error('SMS service error'),
      );

      // create() must resolve (not reject) despite SMS failure
      await expect(service.create(fakeUser(UserRole.CLIENT), dto)).resolves.toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // updateStatus — CANCELLED reverses credit idempotently
  // -------------------------------------------------------------------------

  describe('updateStatus', () => {
    it('reverses credit exactly once on first CANCELLED call', async () => {
      const order = fakeOrder({
        status: OrderStatus.QUOTED,
        creditApplied: '5.00',
        customer: fakeUser() as never,
      });
      creditService.reverseCharge.mockResolvedValue({ amountCents: 500 } as never);

      const cancelledOrder = fakeOrder({
        status: OrderStatus.CANCELLED,
        customer: fakeUser() as never,
      });

      // Transaction mock for the cancel branch
      (dataSource.transaction as jest.Mock).mockImplementation(async (cb: (mgr: EntityManager) => Promise<unknown>) => {
        const orderRepo = makeRepoMock<Order>();
        orderRepo.update.mockResolvedValue({ affected: 1 } as never);

        const mgr = {
          getRepository: (entity: unknown) => {
            if (entity === Order) return orderRepo;
            return makeRepoMock();
          },
        };
        return cb(mgr as unknown as EntityManager);
      });

      // Set up findOne responses in order: first for the lookup, second for the final read
      ordersRepo.findOne
        .mockResolvedValueOnce(order) // first findOne inside updateStatus
        .mockResolvedValueOnce(cancelledOrder); // second findOne at end

      await service.updateStatus(
        'order-1',
        { status: OrderStatus.CANCELLED },
        fakeUser(UserRole.SUPER_ADMIN_DELIVERY),
      );

      // reverseCharge must be called exactly once
      expect(creditService.reverseCharge).toHaveBeenCalledTimes(1);
      expect(creditService.reverseCharge).toHaveBeenCalledWith(
        'order-1',
        expect.anything(), // EntityManager from the TX
      );
    });

    it('does not call reverseCharge when creditApplied is 0', async () => {
      const order = fakeOrder({
        status: OrderStatus.QUOTED,
        creditApplied: '0.00',
        customer: fakeUser() as never,
      });
      const cancelledOrder = fakeOrder({ status: OrderStatus.CANCELLED, customer: fakeUser() as never });

      // Reset findOne to return fresh values for this test
      ordersRepo.findOne
        .mockReset()
        .mockResolvedValueOnce(order)      // first call inside updateStatus → findOne
        .mockResolvedValueOnce(cancelledOrder); // second call at end of updateStatus

      (dataSource.transaction as jest.Mock).mockImplementation(async (cb: (mgr: EntityManager) => Promise<unknown>) => {
        const orderRepo = makeRepoMock<Order>();
        orderRepo.update.mockResolvedValue({ affected: 1 } as never);
        const mgr = {
          getRepository: (entity: unknown) => {
            if (entity === Order) return orderRepo;
            return makeRepoMock();
          },
        };
        return cb(mgr as unknown as EntityManager);
      });

      await service.updateStatus(
        'order-1',
        { status: OrderStatus.CANCELLED },
        fakeUser(UserRole.SUPER_ADMIN_DELIVERY),
      );

      expect(creditService.reverseCharge).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // setQuote — subscription shipping override
  // -------------------------------------------------------------------------

  describe('setQuote', () => {
    const superUser = fakeUser(UserRole.SUPER_ADMIN_DELIVERY);

    it('active subscriber gets free shipping (override to 0) and wasSubscriberAtQuote=true', async () => {
      const order = fakeOrder({
        status: OrderStatus.PENDING_QUOTE,
        customerId: 'user-1',
        customer: fakeUser() as never,
        subtotal: '10.00',
        pointsRedeemed: '0.00',
      });
      ordersRepo.findOne
        .mockResolvedValueOnce(order) // inside findOne called by setQuote
        .mockResolvedValueOnce({ ...order, shipping: '0.00', wasSubscriberAtQuote: true } as never);

      subscriptionService.isActiveSubscriber.mockResolvedValue(true);
      ordersRepo.update.mockResolvedValue({ affected: 1 } as never);
      // Isolate the quote assertion from the free-shipping auto-confirm
      // side effect (covered separately in its own tests).
      spyAutoConfirmFree();

      await service.setQuote('order-1', 300 /* admin quoted 3.00 */, superUser);

      const updateCall = ordersRepo.update.mock.calls[0][1] as Record<string, unknown>;
      // Free-shipping override: subscribers pay 0 regardless of admin-quoted amount
      expect(updateCall.shipping).toBe('0.00');
      expect(ordersRepo.update).toHaveBeenCalledWith(
        'order-1',
        expect.objectContaining({
          wasSubscriberAtQuote: true,
        }),
      );
    });

    it('uses provided shippingCents and sets wasSubscriberAtQuote=false for non-subscriber', async () => {
      const order = fakeOrder({
        status: OrderStatus.PENDING_QUOTE,
        customerId: 'user-1',
        customer: fakeUser() as never,
        subtotal: '10.00',
        pointsRedeemed: '0.00',
      });
      ordersRepo.findOne
        .mockResolvedValueOnce(order)
        .mockResolvedValueOnce({ ...order, shipping: '3.00', wasSubscriberAtQuote: false } as never);

      subscriptionService.isActiveSubscriber.mockResolvedValue(false);
      ordersRepo.update.mockResolvedValue({ affected: 1 } as never);

      await service.setQuote('order-1', 300 /* 3.00 */, superUser);

      expect(ordersRepo.update).toHaveBeenCalledWith(
        'order-1',
        expect.objectContaining({
          wasSubscriberAtQuote: false,
        }),
      );
      // Shipping should be non-zero
      const updateCall = ordersRepo.update.mock.calls[0][1] as Record<string, unknown>;
      expect(updateCall.shipping).not.toBe('0.00');
    });

    it('auto-confirms after quoting when shipping is free (subscriber benefit)', async () => {
      const order = fakeOrder({
        status: OrderStatus.PENDING_QUOTE,
        customerId: 'user-1',
        customer: fakeUser() as never,
        subtotal: '10.00',
        pointsRedeemed: '0.00',
      });
      ordersRepo.findOne
        .mockResolvedValueOnce(order)
        .mockResolvedValueOnce({ ...order, shipping: '0.00' } as never);
      subscriptionService.isActiveSubscriber.mockResolvedValue(true);
      ordersRepo.update.mockResolvedValue({ affected: 1 } as never);
      const autoSpy = spyAutoConfirmFree();

      await service.setQuote('order-1', 300, superUser);

      expect(autoSpy).toHaveBeenCalledWith('order-1');
    });

    it('does NOT auto-confirm after quoting when shipping is charged', async () => {
      const order = fakeOrder({
        status: OrderStatus.PENDING_QUOTE,
        customerId: 'user-1',
        customer: fakeUser() as never,
        subtotal: '10.00',
        pointsRedeemed: '0.00',
      });
      ordersRepo.findOne
        .mockResolvedValueOnce(order)
        .mockResolvedValueOnce({ ...order, shipping: '3.00' } as never);
      subscriptionService.isActiveSubscriber.mockResolvedValue(false);
      ordersRepo.update.mockResolvedValue({ affected: 1 } as never);
      const autoSpy = spyAutoConfirmFree();

      await service.setQuote('order-1', 300, superUser);

      expect(autoSpy).not.toHaveBeenCalled();
    });
  });

  describe('create — free-shipping auto-confirm', () => {
    const dto = {
      items: [{ productId: 'prod-1', quantity: 1 }],
      deliveryAddress: { text: '123 Test', lat: 18.4861, lng: -69.9312 },
      paymentMethod: PaymentMethod.CASH,
      usePoints: false,
      useCredit: false,
    } as import('./dto/create-order.dto').CreateOrderDto;

    it('auto-confirms a free-shipping cash order that lands in QUOTED at creation', async () => {
      ordersRepo.count.mockResolvedValueOnce(0);
      productsRepo.find.mockResolvedValue([fakeProduct()]);
      setupMixedCartCreateTx([fakeProduct()], {
        status: OrderStatus.QUOTED,
        shipping: '0.00',
        paymentMethod: PaymentMethod.CASH,
        totalAmount: '0.00',
      });
      const autoSpy = spyAutoConfirmFree();

      await service.create(fakeUser(UserRole.CLIENT), dto);

      expect(autoSpy).toHaveBeenCalledWith('order-1');
    });

    it('does NOT auto-confirm an order left in PENDING_QUOTE (needs admin quote)', async () => {
      ordersRepo.count.mockResolvedValueOnce(0);
      productsRepo.find.mockResolvedValue([fakeProduct()]);
      setupMixedCartCreateTx([fakeProduct()], {
        status: OrderStatus.PENDING_QUOTE,
      });
      const autoSpy = spyAutoConfirmFree();

      await service.create(fakeUser(UserRole.CLIENT), dto);

      expect(autoSpy).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Phase 6 — Mixed cart + OrdersService integration (T57–T67)
  // -------------------------------------------------------------------------

  /**
   * Helper: builds a transaction mock that simulates the create() TX.
   * Returns the savedOrder from the TX callback.
   */
  function setupMixedCartCreateTx(products: Product[], savedOrderOverride: Partial<Order> = {}) {
    const savedOrder = fakeOrder({ ...savedOrderOverride });
    const orderWithRelations = fakeOrder({
      customer: fakeUser() as never,
      items: products.map((p) => ({
        productId: p.id,
        quantity: 1,
        priceAtOrder: p.pricingMode === 'rental'
          ? (p.monthlyRentCents / 100).toFixed(2)
          : p.priceToPublic,
        product: p,
      })) as never,
      ...savedOrderOverride,
    });

    (dataSource.transaction as jest.Mock).mockImplementation(
      async (cb: (mgr: EntityManager) => Promise<unknown>) => {
        const orderRepo = makeRepoMock<Order>();
        const itemRepo = makeRepoMock<OrderItem>();
        orderRepo.create.mockImplementation((d) => ({ ...d, id: 'order-1' }) as Order);
        orderRepo.save.mockResolvedValue(savedOrder);
        orderRepo.update.mockResolvedValue({ affected: 1 } as never);
        itemRepo.save.mockResolvedValue({} as never);
        itemRepo.create.mockImplementation((d) => d as OrderItem);

        const mgr = {
          getRepository: (entity: unknown) => {
            if (entity === Order) return orderRepo;
            if (entity === OrderItem) return itemRepo;
            return makeRepoMock();
          },
        };
        return cb(mgr as unknown as EntityManager);
      },
    );

    ordersRepo.findOne.mockResolvedValue(orderWithRelations);
    return { savedOrder, orderWithRelations };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // T57 — Rental pricing: monthlyRentCents used for all-rental cart total
  //
  // NOTE: T57 originally tested a mixed cart for pricing. Since T6.4 introduced
  // the MIXED_CART_NOT_ALLOWED guard, mixed carts are rejected before pricing runs.
  // T57 now tests the same pricing behavior using an all-rental cart, which is
  // the valid path that exercises rental pricing logic.
  // ─────────────────────────────────────────────────────────────────────────

  describe('create — Phase 6 rental pricing', () => {
    const singlePaymentProduct = fakeProduct({
      id: 'prod-water',
      priceToPublic: '5.00',   // 500 cents
      pricingMode: 'single_payment',
    });
    const rentalProduct = fakeRentalProduct({
      id: 'prod-dispenser',
      monthlyRentCents: 2000,
    });

    // T57 — rental-only cart uses monthlyRentCents for total
    it('T57: calculates subtotal using monthlyRentCents for all-rental cart (2000 cents → 20.00)', async () => {
      productsRepo.find.mockResolvedValue([rentalProduct]);
      setupMixedCartCreateTx([rentalProduct]);

      const allRentalDto = {
        items: [{ productId: 'prod-dispenser', quantity: 1 }],
        deliveryAddress: { text: '123 Test', lat: 18.4861, lng: -69.9312 },
        paymentMethod: PaymentMethod.CASH,
        usePoints: false,
        useCredit: false,
      } as import('./dto/create-order.dto').CreateOrderDto;

      await service.create(fakeUser(UserRole.CLIENT), allRentalDto);

      // Verify the transaction was called (meaning create() reached TX step)
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);

      // The order passed to save() inside the TX should have subtotal = '20.00'
      const txCallback = (dataSource.transaction as jest.Mock).mock.calls[0][0] as (mgr: EntityManager) => Promise<unknown>;
      let capturedSubtotal: string | undefined;

      // Re-run the callback with a spy to capture the create() call
      await (async () => {
        const orderRepo = makeRepoMock<Order>();
        const itemRepo = makeRepoMock<OrderItem>();
        orderRepo.create.mockImplementation((d) => {
          capturedSubtotal = (d as Partial<Order>).subtotal;
          return { ...d, id: 'order-1' } as Order;
        });
        orderRepo.save.mockResolvedValue(fakeOrder());
        orderRepo.update.mockResolvedValue({ affected: 1 } as never);
        itemRepo.save.mockResolvedValue({} as never);
        itemRepo.create.mockImplementation((d) => d as OrderItem);

        const mgr = {
          getRepository: (entity: unknown) => {
            if (entity === Order) return orderRepo;
            if (entity === OrderItem) return itemRepo;
            return makeRepoMock();
          },
        };
        await txCallback(mgr as unknown as EntityManager);
      })();

      expect(capturedSubtotal).toBe('20.00'); // 2000 cents / 100 = 20.00
    });

    // T57: Single-payment-only order total unchanged
    it('T57: single-payment-only cart still uses priceToPublic for total', async () => {
      const singleDto = {
        items: [{ productId: 'prod-water', quantity: 1 }],
        deliveryAddress: { text: '123 Test', lat: 18.4861, lng: -69.9312 },
        paymentMethod: PaymentMethod.CASH,
        usePoints: false,
        useCredit: false,
      } as import('./dto/create-order.dto').CreateOrderDto;

      productsRepo.find.mockResolvedValue([singlePaymentProduct]);
      setupMixedCartCreateTx([singlePaymentProduct]);

      await service.create(fakeUser(UserRole.CLIENT), singleDto);

      const txCallback = (dataSource.transaction as jest.Mock).mock.calls[0][0] as (mgr: EntityManager) => Promise<unknown>;
      let capturedSubtotal: string | undefined;

      await (async () => {
        const orderRepo = makeRepoMock<Order>();
        const itemRepo = makeRepoMock<OrderItem>();
        orderRepo.create.mockImplementation((d) => {
          capturedSubtotal = (d as Partial<Order>).subtotal;
          return { ...d, id: 'order-1' } as Order;
        });
        orderRepo.save.mockResolvedValue(fakeOrder());
        orderRepo.update.mockResolvedValue({ affected: 1 } as never);
        itemRepo.save.mockResolvedValue({} as never);
        itemRepo.create.mockImplementation((d) => d as OrderItem);

        const mgr = {
          getRepository: (entity: unknown) => {
            if (entity === Order) return orderRepo;
            if (entity === OrderItem) return itemRepo;
            return makeRepoMock();
          },
        };
        await txCallback(mgr as unknown as EntityManager);
      })();

      expect(capturedSubtotal).toBe('5.00'); // 500 cents / 100
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Address book: auto-save first pinned location + auto-inherit default
  // ─────────────────────────────────────────────────────────────────────────

  describe('setDeliveryAddress — auto-save first location to customer', () => {
    const admin = fakeUser(UserRole.SUPER_ADMIN_DELIVERY);
    const address = {
      text: 'Calle 1',
      lat: 18.48,
      lng: -69.93,
      building: 'Edif. 4',
      houseNumber: '24',
      unit: 'Apto 3B',
      reference: 'frente al colmado',
    } as import('./dto/create-order.dto').DeliveryAddressDto;

    it('auto-saves the first location as the customer default with full detail', async () => {
      ordersRepo.findOne.mockResolvedValue(fakeOrder({ customerId: 'cust-9' }));
      ordersRepo.update.mockResolvedValue({ affected: 1 } as never);
      userAddressesRepo.count.mockResolvedValue(0);
      userAddressesRepo.save.mockResolvedValue({} as never);

      await service.setDeliveryAddress('order-1', address, admin);

      expect(userAddressesRepo.count).toHaveBeenCalledWith({
        where: { userId: 'cust-9' },
      });
      expect(userAddressesRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'cust-9',
          line1: 'Calle 1',
          line2: 'Apto 3B',
          building: 'Edif. 4',
          instructions: 'frente al colmado',
          lat: 18.48,
          lng: -69.93,
          isDefault: true,
        }),
      );
      expect(userAddressesRepo.save).toHaveBeenCalledTimes(1);
    });

    it('does NOT auto-save when the customer already has saved addresses', async () => {
      ordersRepo.findOne.mockResolvedValue(fakeOrder({ customerId: 'cust-9' }));
      ordersRepo.update.mockResolvedValue({ affected: 1 } as never);
      userAddressesRepo.count.mockResolvedValue(2);

      await service.setDeliveryAddress('order-1', address, admin);

      expect(userAddressesRepo.save).not.toHaveBeenCalled();
    });

    it('still persists the order location even if the auto-save throws', async () => {
      ordersRepo.findOne.mockResolvedValue(fakeOrder({ customerId: 'cust-9' }));
      ordersRepo.update.mockResolvedValue({ affected: 1 } as never);
      userAddressesRepo.count.mockResolvedValue(0);
      userAddressesRepo.save.mockRejectedValue(new Error('db down'));

      await expect(
        service.setDeliveryAddress('order-1', address, admin),
      ).resolves.toBeDefined();
      expect(ordersRepo.update).toHaveBeenCalledTimes(1);
    });
  });

  describe('create — auto-inherit customer default address', () => {
    const product = fakeProduct({
      id: 'prod-water',
      priceToPublic: '5.00',
      pricingMode: 'single_payment',
    });

    it('fills deliveryAddress from the customer default when none is provided', async () => {
      productsRepo.find.mockResolvedValue([product]);
      setupMixedCartCreateTx([product]);
      userAddressesRepo.findOne.mockResolvedValue({
        id: 'a1',
        userId: 'user-1',
        label: 'Casa',
        line1: 'Calle Duarte 100',
        line2: 'Apto 3B',
        building: 'Torre B',
        lat: 18.47,
        lng: -69.9,
        instructions: 'frente al colmado',
        isDefault: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as UserAddress);

      const dtoNoAddr = {
        items: [{ productId: 'prod-water', quantity: 1 }],
        paymentMethod: PaymentMethod.CASH,
        usePoints: false,
        useCredit: false,
      } as import('./dto/create-order.dto').CreateOrderDto;

      await service.create(fakeUser(UserRole.CLIENT), dtoNoAddr);

      const txCallback = (dataSource.transaction as jest.Mock).mock
        .calls[0][0] as (mgr: EntityManager) => Promise<unknown>;
      let capturedAddress: Order['deliveryAddress'] | undefined;

      await (async () => {
        const orderRepo = makeRepoMock<Order>();
        const itemRepo = makeRepoMock<OrderItem>();
        orderRepo.create.mockImplementation((d) => {
          capturedAddress = (d as Partial<Order>).deliveryAddress;
          return { ...d, id: 'order-1' } as Order;
        });
        orderRepo.save.mockResolvedValue(fakeOrder());
        orderRepo.update.mockResolvedValue({ affected: 1 } as never);
        itemRepo.save.mockResolvedValue({} as never);
        itemRepo.create.mockImplementation((d) => d as OrderItem);
        const mgr = {
          getRepository: (entity: unknown) => {
            if (entity === Order) return orderRepo;
            if (entity === OrderItem) return itemRepo;
            return makeRepoMock();
          },
        };
        await txCallback(mgr as unknown as EntityManager);
      })();

      expect(capturedAddress).toEqual({
        text: 'Calle Duarte 100, Apto 3B',
        lat: 18.47,
        lng: -69.9,
        building: 'Torre B',
        houseNumber: null,
        unit: null,
        reference: 'frente al colmado',
      });
    });

    it('leaves deliveryAddress null when the customer has no default', async () => {
      productsRepo.find.mockResolvedValue([product]);
      setupMixedCartCreateTx([product]);
      userAddressesRepo.findOne.mockResolvedValue(null);

      const dtoNoAddr = {
        items: [{ productId: 'prod-water', quantity: 1 }],
        paymentMethod: PaymentMethod.CASH,
        usePoints: false,
        useCredit: false,
      } as import('./dto/create-order.dto').CreateOrderDto;

      await service.create(fakeUser(UserRole.CLIENT), dtoNoAddr);

      const txCallback = (dataSource.transaction as jest.Mock).mock
        .calls[0][0] as (mgr: EntityManager) => Promise<unknown>;
      let capturedAddress: Order['deliveryAddress'] | undefined = {
        text: 'sentinel',
      };

      await (async () => {
        const orderRepo = makeRepoMock<Order>();
        const itemRepo = makeRepoMock<OrderItem>();
        orderRepo.create.mockImplementation((d) => {
          capturedAddress = (d as Partial<Order>).deliveryAddress;
          return { ...d, id: 'order-1' } as Order;
        });
        orderRepo.save.mockResolvedValue(fakeOrder());
        orderRepo.update.mockResolvedValue({ affected: 1 } as never);
        itemRepo.save.mockResolvedValue({} as never);
        itemRepo.create.mockImplementation((d) => d as OrderItem);
        const mgr = {
          getRepository: (entity: unknown) => {
            if (entity === Order) return orderRepo;
            if (entity === OrderItem) return itemRepo;
            return makeRepoMock();
          },
        };
        await txCallback(mgr as unknown as EntityManager);
      })();

      expect(capturedAddress).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // T59 — PaymentIntent flags for mixed cart vs single-payment-only
  // ─────────────────────────────────────────────────────────────────────────

  describe('authorize — Phase 6 PaymentIntent flags', () => {
    it('T59: mixed-cart order → createAuthorizationIntent called with customerId and setupFutureUsage', async () => {
      const rentalItem = {
        id: 'item-1',
        orderId: 'order-1',
        productId: 'prod-dispenser',
        quantity: 1,
        priceAtOrder: '20.00',
        product: fakeRentalProduct({ id: 'prod-dispenser', pricingMode: 'rental' }),
      } as unknown as OrderItem;

      const mixedOrder = fakeOrder({
        id: 'order-1',
        customerId: 'user-1',
        status: OrderStatus.QUOTED,
        paymentMethod: PaymentMethod.DIGITAL,
        totalAmount: '25.00',
        creditApplied: '0.00',
        stripePaymentIntentId: null,
        items: [rentalItem],
        customer: { id: 'user-1', stripeCustomerId: 'cus_test_123' } as never,
      });

      ordersRepo.findOne.mockResolvedValue(mixedOrder);

      // subscriptionService.getOrCreateStripeCustomer returns customerId for rental orders
      subscriptionService.getOrCreateStripeCustomer.mockResolvedValue('cus_test_123');

      paymentsService.createAuthorizationIntent.mockResolvedValue({
        paymentIntentId: 'pi_test_123',
        clientSecret: 'secret_123',
        amount: 2500,
        currency: 'usd',
      });
      ordersRepo.update.mockResolvedValue({ affected: 1 } as never);

      await service.authorize('order-1', fakeUser(UserRole.CLIENT));

      expect(paymentsService.createAuthorizationIntent).toHaveBeenCalledWith(
        expect.objectContaining({
          customerId: 'cus_test_123',
          setupFutureUsage: 'off_session',
        }),
      );
    });

    it('T59: single-payment-only order → createAuthorizationIntent WITHOUT customerId and setupFutureUsage', async () => {
      const singleItem = {
        id: 'item-1',
        orderId: 'order-1',
        productId: 'prod-water',
        quantity: 1,
        priceAtOrder: '5.00',
        product: fakeProduct({ id: 'prod-water', pricingMode: 'single_payment' }),
      } as unknown as OrderItem;

      const singleOrder = fakeOrder({
        id: 'order-1',
        customerId: 'user-1',
        status: OrderStatus.QUOTED,
        paymentMethod: PaymentMethod.DIGITAL,
        totalAmount: '5.00',
        creditApplied: '0.00',
        stripePaymentIntentId: null,
        items: [singleItem],
        customer: { id: 'user-1', stripeCustomerId: null } as never,
      });

      ordersRepo.findOne.mockResolvedValue(singleOrder);
      paymentsService.createAuthorizationIntent.mockResolvedValue({
        paymentIntentId: 'pi_test_456',
        clientSecret: 'secret_456',
        amount: 500,
        currency: 'usd',
      });
      ordersRepo.update.mockResolvedValue({ affected: 1 } as never);

      await service.authorize('order-1', fakeUser(UserRole.CLIENT));

      // Should NOT have customerId or setupFutureUsage
      expect(paymentsService.createAuthorizationIntent).toHaveBeenCalledWith(
        expect.not.objectContaining({ customerId: expect.anything() }),
      );
      expect(paymentsService.createAuthorizationIntent).toHaveBeenCalledWith(
        expect.not.objectContaining({ setupFutureUsage: expect.anything() }),
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // T62 — Pre-check one-active-per-rental-product
  // ─────────────────────────────────────────────────────────────────────────

  describe('create — Phase 6 duplicate rental pre-check', () => {
    const rentalProduct = fakeRentalProduct({ id: 'prod-dispenser' });

    const rentalCartDto = {
      items: [{ productId: 'prod-dispenser', quantity: 1 }],
      deliveryAddress: { text: '123 Test', lat: 18.4861, lng: -69.9312 },
      paymentMethod: PaymentMethod.CASH,
      usePoints: false,
      useCredit: false,
    } as import('./dto/create-order.dto').CreateOrderDto;

    it('T62: throws 409 RENTAL_ALREADY_ACTIVE when user already has active rental for product', async () => {
      productsRepo.find.mockResolvedValue([rentalProduct]);

      // rentalsService.findActiveByUserAndProduct returns existing rental
      rentalsService.findActiveByUserAndProduct.mockResolvedValue({
        id: 'rental-existing',
        userId: 'user-1',
        productId: 'prod-dispenser',
        status: 'active',
      } as never);

      await expect(
        service.create(fakeUser(UserRole.CLIENT), rentalCartDto),
      ).rejects.toThrow(ConflictException);

      // Pre-check must be BEFORE TX
      expect(dataSource.transaction).not.toHaveBeenCalled();
      // Verify the pre-check was called with correct args
      expect(rentalsService.findActiveByUserAndProduct).toHaveBeenCalledWith('user-1', 'prod-dispenser');
    });

    it('T62: Stripe NOT called, no DB writes when duplicate rental pre-check triggers', async () => {
      productsRepo.find.mockResolvedValue([rentalProduct]);
      rentalsService.findActiveByUserAndProduct.mockResolvedValue({
        id: 'rental-existing',
      } as never);

      await expect(
        service.create(fakeUser(UserRole.CLIENT), rentalCartDto),
      ).rejects.toThrow(ConflictException);

      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(paymentsService.createAuthorizationIntent).not.toHaveBeenCalled();
    });

    it('T62: single-payment product skips rental pre-check', async () => {
      const singleProduct = fakeProduct({ id: 'prod-water' });
      productsRepo.find.mockResolvedValue([singleProduct]);
      setupMixedCartCreateTx([singleProduct]);

      await service.create(fakeUser(UserRole.CLIENT), {
        items: [{ productId: 'prod-water', quantity: 1 }],
        deliveryAddress: { text: '123 Test', lat: 18.4861, lng: -69.9312 },
        paymentMethod: PaymentMethod.CASH,
        usePoints: false,
        useCredit: false,
      } as import('./dto/create-order.dto').CreateOrderDto);

      // findActiveByUserAndProduct should NOT have been called for single-payment items
      expect(rentalsService.findActiveByUserAndProduct).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // T3.1 / T3.3 — create() calls rentalsService.createForOrder for rental items
  // ─────────────────────────────────────────────────────────────────────────

  describe('create — rental row creation (T3.1 / T3.3)', () => {
    const rentalProduct = fakeRentalProduct({ id: 'prod-dispenser' });

    const rentalCartDto = {
      items: [{ productId: 'prod-dispenser', quantity: 1 }],
      deliveryAddress: { text: '123 Test', lat: 18.4861, lng: -69.9312 },
      paymentMethod: PaymentMethod.CASH,
      usePoints: false,
      useCredit: false,
    } as import('./dto/create-order.dto').CreateOrderDto;

    it('T3.1: create() calls rentalsService.createForOrder for each rental-mode item inside the TX', async () => {
      productsRepo.find.mockResolvedValue([rentalProduct]);

      const savedOrder = fakeOrder({ id: 'order-created-1' });
      const orderWithRelations = fakeOrder({ id: 'order-created-1', customer: fakeUser() as never, items: [] });

      let capturedTx: EntityManager | undefined;

      (dataSource.transaction as jest.Mock).mockImplementation(
        async (cb: (mgr: EntityManager) => Promise<unknown>) => {
          const orderRepo = makeRepoMock<Order>();
          const itemRepo = makeRepoMock<OrderItem>();
          orderRepo.create.mockImplementation((d) => ({ ...d, id: 'order-created-1' }) as Order);
          orderRepo.save.mockResolvedValue(savedOrder);
          orderRepo.update.mockResolvedValue({ affected: 1 } as never);
          itemRepo.save.mockResolvedValue({} as never);
          itemRepo.create.mockImplementation((d) => d as OrderItem);

          const mgr = {
            getRepository: (entity: unknown) => {
              if (entity === Order) return orderRepo;
              if (entity === OrderItem) return itemRepo;
              return makeRepoMock();
            },
          } as unknown as EntityManager;

          capturedTx = mgr;
          return cb(mgr);
        },
      );

      ordersRepo.findOne.mockResolvedValue(orderWithRelations);

      await service.create(fakeUser(UserRole.CLIENT), rentalCartDto);

      // Must call createForOrder with the rental item's params + the TX EntityManager
      expect(rentalsService.createForOrder).toHaveBeenCalledTimes(1);
      expect(rentalsService.createForOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          productId: 'prod-dispenser',
          orderId: 'order-created-1',
        }),
        capturedTx,
      );
    });

    it('T3.1-triangulate: non-rental product cart does NOT call createForOrder', async () => {
      const singleProduct = fakeProduct({ id: 'prod-water' });
      productsRepo.find.mockResolvedValue([singleProduct]);
      setupMixedCartCreateTx([singleProduct]);

      await service.create(fakeUser(UserRole.CLIENT), {
        items: [{ productId: 'prod-water', quantity: 1 }],
        deliveryAddress: { text: '123 Test', lat: 18.4861, lng: -69.9312 },
        paymentMethod: PaymentMethod.CASH,
        usePoints: false,
        useCredit: false,
      } as import('./dto/create-order.dto').CreateOrderDto);

      expect(rentalsService.createForOrder).not.toHaveBeenCalled();
    });

    it('allowDuplicateRental=true: skips the pre-check and stacks a second rental', async () => {
      productsRepo.find.mockResolvedValue([rentalProduct]);
      // User already holds an active rental of this product — normally a 409.
      rentalsService.findActiveByUserAndProduct.mockResolvedValue({
        id: 'rental-existing',
      } as never);

      const savedOrder = fakeOrder({ id: 'order-dup-1' });
      (dataSource.transaction as jest.Mock).mockImplementation(
        async (cb: (mgr: EntityManager) => Promise<unknown>) => {
          const orderRepo = makeRepoMock<Order>();
          const itemRepo = makeRepoMock<OrderItem>();
          orderRepo.create.mockImplementation(
            (d) => ({ ...d, id: 'order-dup-1' }) as Order,
          );
          orderRepo.save.mockResolvedValue(savedOrder);
          orderRepo.update.mockResolvedValue({ affected: 1 } as never);
          itemRepo.save.mockResolvedValue({} as never);
          itemRepo.create.mockImplementation((d) => d as OrderItem);
          const mgr = {
            getRepository: (entity: unknown) => {
              if (entity === Order) return orderRepo;
              if (entity === OrderItem) return itemRepo;
              return makeRepoMock();
            },
          } as unknown as EntityManager;
          return cb(mgr);
        },
      );
      ordersRepo.findOne.mockResolvedValue(
        fakeOrder({
          id: 'order-dup-1',
          customer: fakeUser() as never,
          items: [],
        }),
      );

      await expect(
        service.create(fakeUser(UserRole.CLIENT), rentalCartDto, {
          allowDuplicateRental: true,
        }),
      ).resolves.toBeDefined();

      // Guard bypassed: the pre-check is never consulted, and the rental is
      // created with allowDuplicate so the inner guard is skipped too.
      expect(rentalsService.findActiveByUserAndProduct).not.toHaveBeenCalled();
      expect(rentalsService.createForOrder).toHaveBeenCalledWith(
        expect.objectContaining({ allowDuplicate: true }),
        expect.anything(),
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Subscriber bebedero pricing — first free ($0), additional $6.99
  // ─────────────────────────────────────────────────────────────────────────

  describe('create — subscriber bebedero pricing', () => {
    const bebedero = fakeRentalProduct({
      id: 'prod-bebedero',
      requiresMaintenance: true,
      monthlyRentCents: 2000, // $20 catalog
    });

    const bebederoCart = {
      items: [{ productId: 'prod-bebedero', quantity: 1 }],
      deliveryAddress: { text: '123 Test', lat: 18.4861, lng: -69.9312 },
      paymentMethod: PaymentMethod.CASH,
      usePoints: false,
      useCredit: false,
    } as import('./dto/create-order.dto').CreateOrderDto;

    let savedOrderArg: Partial<Order> | undefined;

    function setupTx() {
      savedOrderArg = undefined;
      (dataSource.transaction as jest.Mock).mockImplementation(
        async (cb: (mgr: EntityManager) => Promise<unknown>) => {
          const orderRepo = makeRepoMock<Order>();
          const itemRepo = makeRepoMock<OrderItem>();
          orderRepo.create.mockImplementation((d) => {
            savedOrderArg = d as Partial<Order>;
            return { ...d, id: 'order-bebedero-1' } as Order;
          });
          orderRepo.save.mockResolvedValue(
            fakeOrder({ id: 'order-bebedero-1' }),
          );
          orderRepo.update.mockResolvedValue({ affected: 1 } as never);
          itemRepo.save.mockResolvedValue({} as never);
          itemRepo.create.mockImplementation((d) => d as OrderItem);
          const mgr = {
            getRepository: (entity: unknown) => {
              if (entity === Order) return orderRepo;
              if (entity === OrderItem) return itemRepo;
              return makeRepoMock();
            },
          } as unknown as EntityManager;
          return cb(mgr);
        },
      );
      ordersRepo.findOne.mockResolvedValue(
        fakeOrder({ id: 'order-bebedero-1', customer: fakeUser() as never, items: [] }),
      );
    }

    it('active subscriber, FIRST bebedero → $0/mo + free Stripe price snapshot', async () => {
      productsRepo.find.mockResolvedValue([bebedero]);
      subscriptionService.isActiveSubscriber.mockResolvedValue(true);
      rentalsService.countBebederoRentalsForUser.mockResolvedValue(0);
      setupTx();

      await service.create(fakeUser(UserRole.CLIENT), bebederoCart);

      // Order subtotal (first month charged in the order) is $0
      expect(savedOrderArg?.subtotal).toBe('0.00');
      // Rental snapshot uses the free recurring price + $0 rent
      expect(rentalsService.createForOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          productId: 'prod-bebedero',
          monthlyRentCentsOverride: 0,
          stripePriceIdOverride: 'price_free_existing',
        }),
        expect.anything(),
      );
    });

    it('active subscriber, ADDITIONAL bebedero → $6.99/mo + subscriber Stripe price snapshot', async () => {
      productsRepo.find.mockResolvedValue([bebedero]);
      subscriptionService.isActiveSubscriber.mockResolvedValue(true);
      rentalsService.countBebederoRentalsForUser.mockResolvedValue(1);
      setupTx();

      await service.create(fakeUser(UserRole.CLIENT), bebederoCart);

      expect(savedOrderArg?.subtotal).toBe('6.99');
      expect(rentalsService.createForOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          productId: 'prod-bebedero',
          monthlyRentCentsOverride: 699,
          stripePriceIdOverride: 'price_sub_existing',
        }),
        expect.anything(),
      );
    });

    it('active subscriber, ADDITIONAL bebedero → tracks the live subscription price (not the frozen rate)', async () => {
      // Plan now charges $12.99/mo — the additional bebedero must rent at $12.99,
      // and the Stripe rate price is resolved for that same amount.
      productsRepo.find.mockResolvedValue([bebedero]);
      subscriptionService.isActiveSubscriber.mockResolvedValue(true);
      subscriptionService.getPlanNetCents.mockResolvedValue(1299);
      rentalsService.countBebederoRentalsForUser.mockResolvedValue(1);
      rentalsService.ensureBebederoRatePrices.mockResolvedValue({
        freePriceId: 'price_free_existing',
        subscriberPriceId: 'price_sub_1299',
      });
      setupTx();

      await service.create(fakeUser(UserRole.CLIENT), bebederoCart);

      expect(rentalsService.ensureBebederoRatePrices).toHaveBeenCalledWith(1299);
      expect(savedOrderArg?.subtotal).toBe('12.99');
      expect(rentalsService.createForOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          productId: 'prod-bebedero',
          monthlyRentCentsOverride: 1299,
          stripePriceIdOverride: 'price_sub_1299',
        }),
        expect.anything(),
      );
    });

    it('NON-subscriber bebedero → catalog rent, no override', async () => {
      productsRepo.find.mockResolvedValue([bebedero]);
      subscriptionService.isActiveSubscriber.mockResolvedValue(false);
      setupTx();

      await service.create(fakeUser(UserRole.CLIENT), bebederoCart);

      expect(savedOrderArg?.subtotal).toBe('20.00');
      expect(rentalsService.ensureBebederoRatePrices).not.toHaveBeenCalled();
      const call = rentalsService.createForOrder.mock.calls[0][0];
      expect(call.monthlyRentCentsOverride).toBeUndefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // T64 — markDelivered activates rentals
  // ─────────────────────────────────────────────────────────────────────────

  describe('updateStatus → markDelivered — Phase 6 rental activation', () => {
    it('T64: markDelivered calls rentalsService.activateForOrder for each pending_setup rental', async () => {
      const deliveredOrder = fakeOrder({
        status: OrderStatus.IN_DELIVERY_ROUTE,
        paymentMethod: PaymentMethod.DIGITAL,
        stripePaymentIntentId: 'pi_test_123',
        paidAt: null,
        customer: fakeUser() as never,
        items: [],
      });

      // First findOne: for the updateStatus lookup
      // Second findOne: at end of updateStatus for final return
      ordersRepo.findOne
        .mockResolvedValueOnce(deliveredOrder)
        .mockResolvedValueOnce({ ...deliveredOrder, status: OrderStatus.DELIVERED } as Order);

      paymentsService.captureIntent.mockResolvedValue({} as never);

      rentalsService.activateRentalsForOrder.mockResolvedValue([]);

      (dataSource.transaction as jest.Mock).mockImplementation(
        async (cb: (mgr: EntityManager) => Promise<unknown>) => {
          const orderRepo = makeRepoMock<Order>();
          orderRepo.findOne.mockResolvedValue({ ...deliveredOrder, id: 'order-1' } as never);
          orderRepo.update.mockResolvedValue({ affected: 1 } as never);

          const mgr = {
            getRepository: (entity: unknown) => {
              if (entity === Order) return orderRepo;
              return makeRepoMock();
            },
          };
          return cb(mgr as unknown as EntityManager);
        },
      );

      await service.updateStatus(
        'order-1',
        { status: OrderStatus.DELIVERED },
        fakeUser(UserRole.SUPER_ADMIN_DELIVERY),
      );

      // activateRentalsForOrder should have been called with the orderId
      expect(rentalsService.activateRentalsForOrder).toHaveBeenCalledWith('order-1');
    });

    it('T64: markDelivered activation failure does NOT fail the delivery (best-effort)', async () => {
      const deliveredOrder = fakeOrder({
        status: OrderStatus.IN_DELIVERY_ROUTE,
        paymentMethod: PaymentMethod.DIGITAL,
        stripePaymentIntentId: 'pi_test_123',
        paidAt: null,
        customer: fakeUser() as never,
        items: [],
      });

      ordersRepo.findOne
        .mockResolvedValueOnce(deliveredOrder)
        .mockResolvedValueOnce({ ...deliveredOrder, status: OrderStatus.DELIVERED } as Order);

      paymentsService.captureIntent.mockResolvedValue({} as never);

      // activateRentalsForOrder throws — should NOT propagate
      rentalsService.activateRentalsForOrder.mockRejectedValue(new Error('Stripe failed'));

      (dataSource.transaction as jest.Mock).mockImplementation(
        async (cb: (mgr: EntityManager) => Promise<unknown>) => {
          const orderRepo = makeRepoMock<Order>();
          orderRepo.findOne.mockResolvedValue({ ...deliveredOrder, id: 'order-1' } as never);
          orderRepo.update.mockResolvedValue({ affected: 1 } as never);

          const mgr = {
            getRepository: (entity: unknown) => {
              if (entity === Order) return orderRepo;
              return makeRepoMock();
            },
          };
          return cb(mgr as unknown as EntityManager);
        },
      );

      // Should resolve without throwing even though activateForOrder fails
      await expect(
        service.updateStatus(
          'order-1',
          { status: OrderStatus.DELIVERED },
          fakeUser(UserRole.SUPER_ADMIN_DELIVERY),
        ),
      ).resolves.toBeDefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // T66 — confirmed_by_colmado stock decrement unchanged for all items
  // ─────────────────────────────────────────────────────────────────────────

  describe('updateStatus → confirmAndDecrementStock — Phase 6 stock decrement regression', () => {
    it('T66: both single_payment AND rental items decrement stock at CONFIRMED_BY_COLMADO', async () => {
      const singleItem: OrderItem = {
        id: 'item-1',
        orderId: 'order-1',
        productId: 'prod-water',
        quantity: 2,
        priceAtOrder: '5.00',
        product: fakeProduct({ id: 'prod-water' }),
      } as unknown as OrderItem;

      const rentalItem: OrderItem = {
        id: 'item-2',
        orderId: 'order-1',
        productId: 'prod-dispenser',
        quantity: 1,
        priceAtOrder: '20.00',
        product: fakeRentalProduct({ id: 'prod-dispenser', stock: 5 }),
      } as unknown as OrderItem;

      const pendingOrder = fakeOrder({
        status: OrderStatus.PENDING_VALIDATION,
        customer: fakeUser() as never,
        items: [singleItem, rentalItem],
      });

      ordersRepo.findOne
        .mockResolvedValueOnce(pendingOrder)
        .mockResolvedValueOnce({ ...pendingOrder, status: OrderStatus.CONFIRMED_BY_COLMADO } as Order);

      let stockUpdates: Record<string, number> = {};

      (dataSource.transaction as jest.Mock).mockImplementation(
        async (cb: (mgr: EntityManager) => Promise<unknown>) => {
          const orderRepo = makeRepoMock<Order>();
          const itemRepo = makeRepoMock<OrderItem>();
          const productRepo = makeRepoMock<Product>();

          orderRepo.findOne.mockResolvedValue({ ...pendingOrder, id: 'order-1', status: OrderStatus.PENDING_VALIDATION } as never);
          orderRepo.update.mockResolvedValue({ affected: 1 } as never);
          itemRepo.find.mockResolvedValue([singleItem, rentalItem]);

          // Each product.findOne returns appropriate product
          productRepo.findOne
            .mockResolvedValueOnce(fakeProduct({ id: 'prod-water', stock: 10 }))
            .mockResolvedValueOnce(fakeRentalProduct({ id: 'prod-dispenser', stock: 5 }));

          productRepo.update.mockImplementation((id: string, data: Partial<Product>) => {
            if (data.stock !== undefined) {
              stockUpdates[id as string] = data.stock as number;
            }
            return Promise.resolve({ affected: 1 }) as never;
          });

          const mgr = {
            getRepository: (entity: unknown) => {
              if (entity === Order) return orderRepo;
              if (entity === OrderItem) return itemRepo;
              if (entity === Product) return productRepo;
              return makeRepoMock();
            },
          };
          return cb(mgr as unknown as EntityManager);
        },
      );

      await service.updateStatus(
        'order-1',
        { status: OrderStatus.CONFIRMED_BY_COLMADO },
        fakeUser(UserRole.SUPER_ADMIN_DELIVERY),
      );

      // Both items should have had stock decremented
      expect(stockUpdates['prod-water']).toBe(8);      // 10 - 2
      expect(stockUpdates['prod-dispenser']).toBe(4);  // 5 - 1
    });

    it('T66: existing single-payment stock decrement still works (regression guard)', async () => {
      const singleItem: OrderItem = {
        id: 'item-1',
        orderId: 'order-1',
        productId: 'prod-water',
        quantity: 3,
        priceAtOrder: '5.00',
        product: fakeProduct({ id: 'prod-water', stock: 10 }),
      } as unknown as OrderItem;

      const pendingOrder = fakeOrder({
        status: OrderStatus.PENDING_VALIDATION,
        customer: fakeUser() as never,
        items: [singleItem],
      });

      ordersRepo.findOne
        .mockResolvedValueOnce(pendingOrder)
        .mockResolvedValueOnce({ ...pendingOrder, status: OrderStatus.CONFIRMED_BY_COLMADO } as Order);

      let stockUpdate: number | undefined;

      (dataSource.transaction as jest.Mock).mockImplementation(
        async (cb: (mgr: EntityManager) => Promise<unknown>) => {
          const orderRepo = makeRepoMock<Order>();
          const itemRepo = makeRepoMock<OrderItem>();
          const productRepo = makeRepoMock<Product>();

          orderRepo.findOne.mockResolvedValue({ ...pendingOrder, id: 'order-1', status: OrderStatus.PENDING_VALIDATION } as never);
          orderRepo.update.mockResolvedValue({ affected: 1 } as never);
          itemRepo.find.mockResolvedValue([singleItem]);
          productRepo.findOne.mockResolvedValue(fakeProduct({ id: 'prod-water', stock: 10 }));
          productRepo.update.mockImplementation((_id: string, data: Partial<Product>) => {
            if (data.stock !== undefined) stockUpdate = data.stock as number;
            return Promise.resolve({ affected: 1 }) as never;
          });

          const mgr = {
            getRepository: (entity: unknown) => {
              if (entity === Order) return orderRepo;
              if (entity === OrderItem) return itemRepo;
              if (entity === Product) return productRepo;
              return makeRepoMock();
            },
          };
          return cb(mgr as unknown as EntityManager);
        },
      );

      await service.updateStatus(
        'order-1',
        { status: OrderStatus.CONFIRMED_BY_COLMADO },
        fakeUser(UserRole.SUPER_ADMIN_DELIVERY),
      );

      expect(stockUpdate).toBe(7); // 10 - 3
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 6 — Mixed-cart server enforcement (T6.1–T6.3)
  //
  // Server MUST reject orders that mix rental + single_payment products.
  // Error code: MIXED_CART_NOT_ALLOWED (400 BadRequestException).
  // ─────────────────────────────────────────────────────────────────────────

  describe('create — mixed-cart server enforcement (T6.1–T6.3)', () => {
    const rentalProduct = fakeRentalProduct({ id: 'prod-dispenser' });
    const singleProduct = fakeProduct({ id: 'prod-water' });

    // T6.1 — MUST throw 400 MIXED_CART_NOT_ALLOWED for mixed cart
    it('T6.1: throws BadRequestException with code MIXED_CART_NOT_ALLOWED when cart mixes rental + single_payment', async () => {
      productsRepo.find.mockResolvedValue([rentalProduct, singleProduct]);

      const mixedCartDto = {
        items: [
          { productId: 'prod-dispenser', quantity: 1 },
          { productId: 'prod-water', quantity: 1 },
        ],
        deliveryAddress: { text: '123 Test', lat: 18.4861, lng: -69.9312 },
        paymentMethod: PaymentMethod.CASH,
        usePoints: false,
        useCredit: false,
      } as import('./dto/create-order.dto').CreateOrderDto;

      await expect(
        service.create(fakeUser(UserRole.CLIENT), mixedCartDto),
      ).rejects.toThrow(BadRequestException);

      // Must NOT reach TX
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('T6.1-triangulate: mixed-cart error response contains MIXED_CART_NOT_ALLOWED code', async () => {
      productsRepo.find.mockResolvedValue([rentalProduct, singleProduct]);

      const mixedCartDto = {
        items: [
          { productId: 'prod-dispenser', quantity: 1 },
          { productId: 'prod-water', quantity: 2 },
        ],
        deliveryAddress: { text: '123 Test', lat: 18.4861, lng: -69.9312 },
        paymentMethod: PaymentMethod.CASH,
        usePoints: false,
        useCredit: false,
      } as import('./dto/create-order.dto').CreateOrderDto;

      let thrown: BadRequestException | undefined;
      try {
        await service.create(fakeUser(UserRole.CLIENT), mixedCartDto);
      } catch (err) {
        thrown = err as BadRequestException;
      }

      expect(thrown).toBeInstanceOf(BadRequestException);
      const responseBody = thrown!.getResponse() as Record<string, unknown>;
      expect(responseBody.code).toBe('MIXED_CART_NOT_ALLOWED');
    });

    // T6.2 — all-rental cart MUST succeed (no error)
    it('T6.2: accepts all-rental cart (no BadRequestException thrown)', async () => {
      const rentalProduct2 = fakeRentalProduct({ id: 'prod-dispenser-2', name: 'Dispenser B' });
      productsRepo.find.mockResolvedValue([rentalProduct, rentalProduct2]);

      setupMixedCartCreateTx([rentalProduct, rentalProduct2]);

      const allRentalDto = {
        items: [
          { productId: 'prod-dispenser', quantity: 1 },
          { productId: 'prod-dispenser-2', quantity: 1 },
        ],
        deliveryAddress: { text: '123 Test', lat: 18.4861, lng: -69.9312 },
        paymentMethod: PaymentMethod.CASH,
        usePoints: false,
        useCredit: false,
      } as import('./dto/create-order.dto').CreateOrderDto;

      // Must NOT throw — all-rental cart is allowed
      await expect(
        service.create(fakeUser(UserRole.CLIENT), allRentalDto),
      ).resolves.toBeDefined();

      // TX reached
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    });

    // T6.3 — all-single_payment cart MUST succeed (regression guard)
    it('T6.3: accepts all-single_payment cart (regression guard — existing behavior unchanged)', async () => {
      productsRepo.find.mockResolvedValue([singleProduct]);

      setupMixedCartCreateTx([singleProduct]);

      const singleCartDto = {
        items: [{ productId: 'prod-water', quantity: 1 }],
        deliveryAddress: { text: '123 Test', lat: 18.4861, lng: -69.9312 },
        paymentMethod: PaymentMethod.CASH,
        usePoints: false,
        useCredit: false,
      } as import('./dto/create-order.dto').CreateOrderDto;

      // Must NOT throw
      await expect(
        service.create(fakeUser(UserRole.CLIENT), singleCartDto),
      ).resolves.toBeDefined();

      // TX reached
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Skip cotización — auto-quote at creation (requiresQuote = false)
  //
  // A product with requiresQuote=false (e.g. water) skips the manual quote
  // step. An order whose items are ALL skip-eligible is auto-quoted at
  // creation: shipping = $0, tax computed now, status = QUOTED, quotedAt set.
  // If ANY item requires a quote, the whole order stays PENDING_QUOTE.
  // ─────────────────────────────────────────────────────────────────────────

  describe('create — skip cotización (auto-quote)', () => {
    const skipProduct = fakeProduct({ id: 'prod-water', requiresQuote: false });
    const quoteProduct = fakeProduct({
      id: 'prod-dispenser',
      requiresQuote: true,
    });

    const dtoFor = (items: { productId: string; quantity: number }[]) =>
      ({
        items,
        deliveryAddress: { text: '123 Test', lat: 18.4861, lng: -69.9312 },
        paymentMethod: PaymentMethod.CASH,
        usePoints: false,
        useCredit: false,
      }) as import('./dto/create-order.dto').CreateOrderDto;

    /** Runs create() and returns the order object passed to orderRepo.create(). */
    async function captureCreatedOrder(
      products: Product[],
      items: { productId: string; quantity: number }[],
    ): Promise<Partial<Order>> {
      productsRepo.find.mockResolvedValue(products);
      let captured: Partial<Order> = {};

      (dataSource.transaction as jest.Mock).mockImplementation(
        async (cb: (mgr: EntityManager) => Promise<unknown>) => {
          const orderRepo = makeRepoMock<Order>();
          const itemRepo = makeRepoMock<OrderItem>();
          orderRepo.create.mockImplementation((d) => {
            captured = d as Partial<Order>;
            return { ...d, id: 'order-1' } as Order;
          });
          orderRepo.save.mockResolvedValue(fakeOrder());
          orderRepo.update.mockResolvedValue({ affected: 1 } as never);
          itemRepo.save.mockResolvedValue({} as never);
          itemRepo.create.mockImplementation((d) => d as OrderItem);

          const mgr = {
            getRepository: (entity: unknown) => {
              if (entity === Order) return orderRepo;
              if (entity === OrderItem) return itemRepo;
              return makeRepoMock();
            },
          };
          return cb(mgr as unknown as EntityManager);
        },
      );

      ordersRepo.findOne.mockResolvedValue(
        fakeOrder({ customer: fakeUser() as never, items: [] }),
      );

      await service.create(fakeUser(UserRole.CLIENT), dtoFor(items));
      return captured;
    }

    it('all-skip cart → order created in QUOTED with shipping $0 and tax computed', async () => {
      const created = await captureCreatedOrder(
        [skipProduct],
        [{ productId: 'prod-water', quantity: 1 }],
      );

      expect(created.status).toBe(OrderStatus.QUOTED);
      expect(created.shipping).toBe('0.00');
      expect(created.subtotal).toBe('5.00');
      // tax = round(500 * 0.08887) = 44 cents
      expect(created.tax).toBe('0.44');
      expect(created.totalAmount).toBe('5.44');
      expect(created.quotedAt).toBeInstanceOf(Date);
    });

    it('all-skip cart with quantity → tax computed on the full subtotal', async () => {
      const created = await captureCreatedOrder(
        [skipProduct],
        [{ productId: 'prod-water', quantity: 3 }],
      );

      // 3 × 5.00 = 15.00 → tax = round(1500 * 0.08887) = 133 cents
      expect(created.status).toBe(OrderStatus.QUOTED);
      expect(created.subtotal).toBe('15.00');
      expect(created.tax).toBe('1.33');
      expect(created.totalAmount).toBe('16.33');
    });

    it('mixed cart (any requires_quote item) stays PENDING_QUOTE with tax 0', async () => {
      const created = await captureCreatedOrder(
        [skipProduct, quoteProduct],
        [
          { productId: 'prod-water', quantity: 1 },
          { productId: 'prod-dispenser', quantity: 1 },
        ],
      );

      expect(created.status).toBe(OrderStatus.PENDING_QUOTE);
      expect(created.shipping).toBe('0.00');
      expect(created.tax).toBe('0.00');
      expect(created.totalAmount).toBe('10.00');
      expect(created.quotedAt).toBeNull();
    });

    it('regression: all-requires_quote cart stays PENDING_QUOTE (existing behavior)', async () => {
      const created = await captureCreatedOrder(
        [quoteProduct],
        [{ productId: 'prod-dispenser', quantity: 1 }],
      );

      expect(created.status).toBe(OrderStatus.PENDING_QUOTE);
      expect(created.tax).toBe('0.00');
      expect(created.quotedAt).toBeNull();
    });

    // Subscriber benefit: bebedero maintenance is free. The maintenance-service
    // line is zeroed at creation for active subscribers, regardless of the
    // product's list price — mirrors the free-shipping benefit in setQuote().
    const maintenanceProduct = fakeProduct({
      id: 'prod-maint',
      name: 'Mantenimiento de Bebedero',
      requiresQuote: false,
      isMaintenanceService: true,
      priceToPublic: '10.00',
    });

    it('active subscriber → maintenance line is free (total $0, wasSubscriberAtQuote=true)', async () => {
      subscriptionService.isActiveSubscriber.mockResolvedValue(true);

      const created = await captureCreatedOrder(
        [maintenanceProduct],
        [{ productId: 'prod-maint', quantity: 1 }],
      );

      expect(created.status).toBe(OrderStatus.QUOTED);
      expect(created.subtotal).toBe('0.00');
      expect(created.tax).toBe('0.00');
      expect(created.totalAmount).toBe('0.00');
      expect(created.wasSubscriberAtQuote).toBe(true);
    });

    it('non-subscriber → maintenance billed at the product list price', async () => {
      subscriptionService.isActiveSubscriber.mockResolvedValue(false);

      const created = await captureCreatedOrder(
        [maintenanceProduct],
        [{ productId: 'prod-maint', quantity: 1 }],
      );

      // 10.00 → tax = round(1000 * 0.08887) = 89 cents
      expect(created.subtotal).toBe('10.00');
      expect(created.tax).toBe('0.89');
      expect(created.totalAmount).toBe('10.89');
      expect(created.wasSubscriberAtQuote).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // findAll / findOne — scope + not-found branches
  // ─────────────────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('SUPER_ADMIN_DELIVERY scope returns all orders (empty where scope)', async () => {
      const list = [fakeOrder(), fakeOrder({ id: 'order-2' })];
      ordersRepo.find.mockResolvedValue(list);

      const result = await service.findAll(fakeUser(UserRole.SUPER_ADMIN_DELIVERY));

      expect(result).toBe(list);
      const callArg = ordersRepo.find.mock.calls[0][0] as Record<string, unknown>;
      // SUPER_ADMIN_DELIVERY → unrestricted scope ({})
      expect(callArg.where).toEqual({});
    });

    it('CLIENT scope restricts to customerId', async () => {
      ordersRepo.find.mockResolvedValue([]);

      await service.findAll(fakeUser(UserRole.CLIENT));

      const callArg = ordersRepo.find.mock.calls[0][0] as Record<string, unknown>;
      expect(callArg.where).toEqual({ customerId: 'user-1' });
    });
  });

  describe('findOne', () => {
    it('returns the order when found', async () => {
      const order = fakeOrder();
      ordersRepo.findOne.mockResolvedValue(order);

      const result = await service.findOne('order-1', fakeUser(UserRole.CLIENT));

      expect(result).toBe(order);
    });

    it('throws NotFoundException when order is missing', async () => {
      ordersRepo.findOne.mockResolvedValue(null);

      await expect(
        service.findOne('missing', fakeUser(UserRole.CLIENT)),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // create — product validation guard branches (lines 110/113/118)
  // ─────────────────────────────────────────────────────────────────────────

  describe('create — product validation guards', () => {
    const baseDto = {
      items: [{ productId: 'prod-1', quantity: 1 }],
      deliveryAddress: { text: '123 Test', lat: 18.4861, lng: -69.9312 },
      paymentMethod: PaymentMethod.CASH,
      usePoints: false,
      useCredit: false,
    } as import('./dto/create-order.dto').CreateOrderDto;

    it('throws BadRequest when a product does not exist (not in byId map)', async () => {
      // products.find returns empty → byId.get(productId) is undefined
      productsRepo.find.mockResolvedValue([]);

      await expect(
        service.create(fakeUser(UserRole.CLIENT), baseDto),
      ).rejects.toThrow('Uno o más productos no existen');

      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('throws BadRequest when a product is not available', async () => {
      productsRepo.find.mockResolvedValue([
        fakeProduct({ id: 'prod-1', isAvailable: false }),
      ]);

      await expect(
        service.create(fakeUser(UserRole.CLIENT), baseDto),
      ).rejects.toThrow('no está disponible');
    });

    it('throws BadRequest when stock is insufficient', async () => {
      productsRepo.find.mockResolvedValue([
        fakeProduct({ id: 'prod-1', stock: 0 }),
      ]);

      await expect(
        service.create(fakeUser(UserRole.CLIENT), {
          ...baseDto,
          items: [{ productId: 'prod-1', quantity: 5 }],
        } as import('./dto/create-order.dto').CreateOrderDto),
      ).rejects.toThrow('Stock insuficiente');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // create — points redemption + credit no-account catch (lines 187-189, 203)
  // ─────────────────────────────────────────────────────────────────────────

  describe('create — points + credit branches', () => {
    const baseDto = {
      items: [{ productId: 'prod-1', quantity: 1 }],
      deliveryAddress: { text: '123 Test', lat: 18.4861, lng: -69.9312 },
      paymentMethod: PaymentMethod.CASH,
      usePoints: true,
      useCredit: false,
    } as import('./dto/create-order.dto').CreateOrderDto;

    function setupCreateTx(savedOverride: Partial<Order> = {}) {
      const savedOrder = fakeOrder({ ...savedOverride });
      (dataSource.transaction as jest.Mock).mockImplementation(
        async (cb: (mgr: EntityManager) => Promise<unknown>) => {
          const orderRepo = makeRepoMock<Order>();
          const itemRepo = makeRepoMock<OrderItem>();
          orderRepo.create.mockImplementation((d) => ({ ...d, id: 'order-1' }) as Order);
          orderRepo.save.mockResolvedValue(savedOrder);
          orderRepo.update.mockResolvedValue({ affected: 1 } as never);
          itemRepo.save.mockResolvedValue({} as never);
          itemRepo.create.mockImplementation((d) => d as OrderItem);

          const mgr = {
            getRepository: (entity: unknown) => {
              if (entity === Order) return orderRepo;
              if (entity === OrderItem) return itemRepo;
              return makeRepoMock();
            },
          };
          return cb(mgr as unknown as EntityManager);
        },
      );
      ordersRepo.findOne.mockResolvedValue(
        fakeOrder({ customer: fakeUser() as never, items: [] }),
      );
    }

    it('redeems points when usePoints=true and claimable balance > 0', async () => {
      productsRepo.find.mockResolvedValue([fakeProduct()]);
      pointsService.getBalance.mockResolvedValue({ claimableCents: 300 } as never);
      pointsService.redeemAllClaimable.mockResolvedValue(undefined as never);
      setupCreateTx();

      await service.create(fakeUser(UserRole.CLIENT), baseDto);

      // claimableCents (300) < subtotal (500) → 300 redeemed → redeemAllClaimable called
      expect(pointsService.getBalance).toHaveBeenCalledWith('user-1');
      expect(pointsService.redeemAllClaimable).toHaveBeenCalledWith(
        'user-1',
        'order-1',
        expect.anything(),
      );
    });

    it('does NOT redeem points when claimable balance is 0', async () => {
      productsRepo.find.mockResolvedValue([fakeProduct()]);
      pointsService.getBalance.mockResolvedValue({ claimableCents: 0 } as never);
      setupCreateTx();

      await service.create(fakeUser(UserRole.CLIENT), baseDto);

      expect(pointsService.redeemAllClaimable).not.toHaveBeenCalled();
    });

    it('silently skips credit when no credit account exists (getAccountWithLock throws)', async () => {
      productsRepo.find.mockResolvedValue([fakeProduct()]);
      creditService.getAccountWithLock.mockRejectedValue(
        new Error('No account'),
      );
      setupCreateTx();

      await service.create(fakeUser(UserRole.CLIENT), {
        ...baseDto,
        usePoints: false,
        useCredit: true,
      } as import('./dto/create-order.dto').CreateOrderDto);

      // The catch swallows the error → applyCharge never runs, create() succeeds
      expect(creditService.getAccountWithLock).toHaveBeenCalled();
      expect(creditService.applyCharge).not.toHaveBeenCalled();
    });

    it('does NOT apply credit when available credit is 0 or negative', async () => {
      productsRepo.find.mockResolvedValue([fakeProduct()]);
      creditService.getAccountWithLock.mockResolvedValue({
        balanceCents: -100,
        creditLimitCents: 100,
        userId: 'user-1',
      } as never);
      setupCreateTx();

      await service.create(fakeUser(UserRole.CLIENT), {
        ...baseDto,
        usePoints: false,
        useCredit: true,
      } as import('./dto/create-order.dto').CreateOrderDto);

      // available = -100 + 100 = 0 → no charge
      expect(creditService.applyCharge).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // setQuote — guard branches (lines 315, 318, 327)
  // ─────────────────────────────────────────────────────────────────────────

  describe('setQuote — guards', () => {
    it('throws Forbidden when user is not SUPER_ADMIN_DELIVERY', async () => {
      await expect(
        service.setQuote('order-1', 300, fakeUser(UserRole.CLIENT)),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequest when shippingCents is not an integer', async () => {
      await expect(
        service.setQuote('order-1', 12.5, fakeUser(UserRole.SUPER_ADMIN_DELIVERY)),
      ).rejects.toThrow('shippingCents inválido');
    });

    it('throws BadRequest when shippingCents is negative', async () => {
      await expect(
        service.setQuote('order-1', -1, fakeUser(UserRole.SUPER_ADMIN_DELIVERY)),
      ).rejects.toThrow('shippingCents inválido');
    });

    it('throws BadRequest when order is in a non-quotable status', async () => {
      const order = fakeOrder({
        status: OrderStatus.DELIVERED,
        customer: fakeUser() as never,
      });
      ordersRepo.findOne.mockResolvedValue(order);

      await expect(
        service.setQuote('order-1', 300, fakeUser(UserRole.SUPER_ADMIN_DELIVERY)),
      ).rejects.toThrow('No se puede cotizar un pedido en estado');
    });

    it('allows re-quoting a QUOTED order and preserves existing quotedAt', async () => {
      const existingQuotedAt = new Date('2026-01-01T00:00:00.000Z');
      const order = fakeOrder({
        status: OrderStatus.QUOTED,
        quotedAt: existingQuotedAt,
        customer: fakeUser() as never,
      });
      ordersRepo.findOne
        .mockResolvedValueOnce(order)
        .mockResolvedValueOnce(order);
      subscriptionService.isActiveSubscriber.mockResolvedValue(false);
      ordersRepo.update.mockResolvedValue({ affected: 1 } as never);

      await service.setQuote('order-1', 300, fakeUser(UserRole.SUPER_ADMIN_DELIVERY));

      const updateCall = ordersRepo.update.mock.calls[0][1] as Record<string, unknown>;
      // quotedAt preserved via the ?? fallback
      expect(updateCall.quotedAt).toBe(existingQuotedAt);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // authorize — guard + idempotency + credit-covered branches
  // (lines 372, 375, 380, 385-392, 412)
  // ─────────────────────────────────────────────────────────────────────────

  describe('authorize — guards and idempotency', () => {
    it('throws Forbidden when the order belongs to a different customer', async () => {
      ordersRepo.findOne.mockResolvedValue(
        fakeOrder({ customerId: 'other-user', customer: fakeUser() as never }),
      );

      await expect(
        service.authorize('order-1', fakeUser(UserRole.CLIENT)),
      ).rejects.toThrow('No sos el dueño de este pedido');
    });

    it('throws BadRequest when order is not in QUOTED status', async () => {
      ordersRepo.findOne.mockResolvedValue(
        fakeOrder({
          customerId: 'user-1',
          status: OrderStatus.PENDING_QUOTE,
          paymentMethod: PaymentMethod.DIGITAL,
          customer: fakeUser() as never,
        }),
      );

      await expect(
        service.authorize('order-1', fakeUser(UserRole.CLIENT)),
      ).rejects.toThrow('No se puede autorizar un pedido en estado');
    });

    it('throws BadRequest when the order is cash (not digital)', async () => {
      ordersRepo.findOne.mockResolvedValue(
        fakeOrder({
          customerId: 'user-1',
          status: OrderStatus.QUOTED,
          paymentMethod: PaymentMethod.CASH,
          customer: fakeUser() as never,
        }),
      );

      await expect(
        service.authorize('order-1', fakeUser(UserRole.CLIENT)),
      ).rejects.toThrow('Este pedido es en efectivo');
    });

    it('idempotent: returns the existing intent client secret when intent is still active', async () => {
      ordersRepo.findOne.mockResolvedValue(
        fakeOrder({
          customerId: 'user-1',
          status: OrderStatus.QUOTED,
          paymentMethod: PaymentMethod.DIGITAL,
          stripePaymentIntentId: 'pi_existing',
          customer: fakeUser() as never,
        }),
      );
      paymentsService.retrieveIntent.mockResolvedValue({
        id: 'pi_existing',
        status: 'requires_payment_method',
        client_secret: 'secret_existing',
        amount: 1000,
        currency: 'usd',
      } as never);

      const result = await service.authorize('order-1', fakeUser(UserRole.CLIENT));

      expect(result).toEqual({
        paymentIntentId: 'pi_existing',
        clientSecret: 'secret_existing',
        amount: 1000,
        currency: 'usd',
      });
      // Must short-circuit before creating a new intent
      expect(paymentsService.createAuthorizationIntent).not.toHaveBeenCalled();
    });

    it('idempotent fallback: empty client_secret coalesces to "" via ?? operator', async () => {
      ordersRepo.findOne.mockResolvedValue(
        fakeOrder({
          customerId: 'user-1',
          status: OrderStatus.QUOTED,
          paymentMethod: PaymentMethod.DIGITAL,
          stripePaymentIntentId: 'pi_existing',
          customer: fakeUser() as never,
        }),
      );
      paymentsService.retrieveIntent.mockResolvedValue({
        id: 'pi_existing',
        status: 'requires_confirmation',
        client_secret: null,
        amount: 1000,
        currency: 'usd',
      } as never);

      const result = await service.authorize('order-1', fakeUser(UserRole.CLIENT));

      expect(result.clientSecret).toBe('');
    });

    it('creates a fresh intent when the existing intent is canceled', async () => {
      ordersRepo.findOne.mockResolvedValue(
        fakeOrder({
          customerId: 'user-1',
          status: OrderStatus.QUOTED,
          paymentMethod: PaymentMethod.DIGITAL,
          totalAmount: '10.00',
          creditApplied: '0.00',
          stripePaymentIntentId: 'pi_canceled',
          items: [],
          customer: fakeUser() as never,
        }),
      );
      paymentsService.retrieveIntent.mockResolvedValue({
        id: 'pi_canceled',
        status: 'canceled',
        client_secret: 'x',
        amount: 1000,
        currency: 'usd',
      } as never);
      paymentsService.createAuthorizationIntent.mockResolvedValue({
        paymentIntentId: 'pi_new',
        clientSecret: 'secret_new',
        amount: 1000,
        currency: 'usd',
      });
      ordersRepo.update.mockResolvedValue({ affected: 1 } as never);

      await service.authorize('order-1', fakeUser(UserRole.CLIENT));

      // Canceled intent → proceed to create a new one
      expect(paymentsService.createAuthorizationIntent).toHaveBeenCalledTimes(1);
      expect(ordersRepo.update).toHaveBeenCalledWith('order-1', {
        stripePaymentIntentId: 'pi_new',
      });
    });

    it('throws BadRequest when the order is fully covered by credit (stripeAmount <= 0)', async () => {
      ordersRepo.findOne.mockResolvedValue(
        fakeOrder({
          customerId: 'user-1',
          status: OrderStatus.QUOTED,
          paymentMethod: PaymentMethod.DIGITAL,
          totalAmount: '10.00',
          creditApplied: '10.00',
          stripePaymentIntentId: null,
          items: [],
          customer: fakeUser() as never,
        }),
      );

      await expect(
        service.authorize('order-1', fakeUser(UserRole.CLIENT)),
      ).rejects.toThrow('cubierto por crédito');
    });

    it('handles null creditApplied via "|| 0" fallback when computing stripe amount', async () => {
      ordersRepo.findOne.mockResolvedValue(
        fakeOrder({
          customerId: 'user-1',
          status: OrderStatus.QUOTED,
          paymentMethod: PaymentMethod.DIGITAL,
          totalAmount: '10.00',
          creditApplied: null as never,
          stripePaymentIntentId: null,
          items: [],
          customer: fakeUser() as never,
        }),
      );
      paymentsService.createAuthorizationIntent.mockResolvedValue({
        paymentIntentId: 'pi_new',
        clientSecret: 'secret_new',
        amount: 1000,
        currency: 'usd',
      });
      ordersRepo.update.mockResolvedValue({ affected: 1 } as never);

      const result = await service.authorize('order-1', fakeUser(UserRole.CLIENT));

      // creditApplied null → '0' fallback → full 1000 cents to Stripe
      expect(paymentsService.createAuthorizationIntent).toHaveBeenCalledWith(
        expect.objectContaining({ amountCents: 1000 }),
      );
      expect(result.paymentIntentId).toBe('pi_new');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // confirmNonStripeOrder / confirmCashOrder (lines 460-486)
  // ─────────────────────────────────────────────────────────────────────────

  describe('confirmNonStripeOrder', () => {
    it('throws Forbidden when order belongs to another customer', async () => {
      ordersRepo.findOne.mockResolvedValue(
        fakeOrder({ customerId: 'other', customer: fakeUser() as never }),
      );

      await expect(
        service.confirmNonStripeOrder('order-1', fakeUser(UserRole.CLIENT)),
      ).rejects.toThrow('No sos el dueño de este pedido');
    });

    it('throws BadRequest when order is not QUOTED', async () => {
      ordersRepo.findOne.mockResolvedValue(
        fakeOrder({
          customerId: 'user-1',
          status: OrderStatus.PENDING_QUOTE,
          customer: fakeUser() as never,
        }),
      );

      await expect(
        service.confirmNonStripeOrder('order-1', fakeUser(UserRole.CLIENT)),
      ).rejects.toThrow('No se puede confirmar un pedido en estado');
    });

    it('throws BadRequest when an active Stripe intent exists', async () => {
      ordersRepo.findOne.mockResolvedValue(
        fakeOrder({
          customerId: 'user-1',
          status: OrderStatus.QUOTED,
          stripePaymentIntentId: 'pi_active',
          customer: fakeUser() as never,
        }),
      );

      await expect(
        service.confirmNonStripeOrder('order-1', fakeUser(UserRole.CLIENT)),
      ).rejects.toThrow('pago digital pendiente');
    });

    it('confirms a cash/full-credit order → transitions to PENDING_VALIDATION', async () => {
      const quoted = fakeOrder({
        customerId: 'user-1',
        status: OrderStatus.QUOTED,
        stripePaymentIntentId: null,
        customer: fakeUser() as never,
      });
      const confirmed = fakeOrder({
        customerId: 'user-1',
        status: OrderStatus.PENDING_VALIDATION,
        customer: fakeUser() as never,
      });
      ordersRepo.findOne
        .mockResolvedValueOnce(quoted)
        .mockResolvedValueOnce(confirmed);
      ordersRepo.update.mockResolvedValue({ affected: 1 } as never);

      const result = await service.confirmNonStripeOrder(
        'order-1',
        fakeUser(UserRole.CLIENT),
      );

      expect(ordersRepo.update).toHaveBeenCalledWith('order-1', {
        status: OrderStatus.PENDING_VALIDATION,
      });
      expect(result).toBe(confirmed);
    });

    it('confirmCashOrder delegates to confirmNonStripeOrder (deprecated alias)', async () => {
      const quoted = fakeOrder({
        customerId: 'user-1',
        status: OrderStatus.QUOTED,
        stripePaymentIntentId: null,
        customer: fakeUser() as never,
      });
      const confirmed = fakeOrder({
        customerId: 'user-1',
        status: OrderStatus.PENDING_VALIDATION,
        customer: fakeUser() as never,
      });
      ordersRepo.findOne
        .mockResolvedValueOnce(quoted)
        .mockResolvedValueOnce(confirmed);
      ordersRepo.update.mockResolvedValue({ affected: 1 } as never);

      const result = await service.confirmCashOrder(
        'order-1',
        fakeUser(UserRole.CLIENT),
      );

      expect(result).toBe(confirmed);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // updateStatus — invalid transition + assertCanTransition client branches
  // (lines 499, 666-675)
  // ─────────────────────────────────────────────────────────────────────────

  describe('updateStatus — transition guards', () => {
    it('throws BadRequest for a disallowed status transition', async () => {
      // DELIVERED has no allowed transitions
      ordersRepo.findOne.mockResolvedValue(
        fakeOrder({ status: OrderStatus.DELIVERED, customer: fakeUser() as never }),
      );

      await expect(
        service.updateStatus(
          'order-1',
          { status: OrderStatus.CANCELLED },
          fakeUser(UserRole.SUPER_ADMIN_DELIVERY),
        ),
      ).rejects.toThrow('Transición inválida');
    });

    it('CLIENT may cancel from a cancellable status', async () => {
      const order = fakeOrder({
        status: OrderStatus.QUOTED,
        creditApplied: '0.00',
        customer: fakeUser() as never,
      });
      const cancelled = fakeOrder({
        status: OrderStatus.CANCELLED,
        customer: fakeUser() as never,
      });
      ordersRepo.findOne
        .mockResolvedValueOnce(order)
        .mockResolvedValueOnce(cancelled);
      (dataSource.transaction as jest.Mock).mockImplementation(
        async (cb: (mgr: EntityManager) => Promise<unknown>) => {
          const orderRepo = makeRepoMock<Order>();
          orderRepo.update.mockResolvedValue({ affected: 1 } as never);
          const mgr = {
            getRepository: (entity: unknown) =>
              entity === Order ? orderRepo : makeRepoMock(),
          };
          return cb(mgr as unknown as EntityManager);
        },
      );

      await expect(
        service.updateStatus(
          'order-1',
          { status: OrderStatus.CANCELLED },
          fakeUser(UserRole.CLIENT),
        ),
      ).resolves.toBeDefined();
    });

    it('CLIENT cannot perform a non-cancel transition (assertCanTransition throws)', async () => {
      // PENDING_VALIDATION → CONFIRMED_BY_COLMADO is allowed by ALLOWED_TRANSITIONS
      // but assertCanTransition forbids a CLIENT from doing it.
      ordersRepo.findOne.mockResolvedValue(
        fakeOrder({
          status: OrderStatus.PENDING_VALIDATION,
          customer: fakeUser() as never,
        }),
      );

      await expect(
        service.updateStatus(
          'order-1',
          { status: OrderStatus.CONFIRMED_BY_COLMADO },
          fakeUser(UserRole.CLIENT),
        ),
      ).rejects.toThrow('Cliente no puede ejecutar esta transición');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // updateStatus — cancel with stock re-increment (lines 542-555)
  // ─────────────────────────────────────────────────────────────────────────

  describe('updateStatus — cancel restores stock when previously decremented', () => {
    it('re-increments product stock for each item when cancelling a CONFIRMED order', async () => {
      const item1 = { productId: 'prod-1', quantity: 2 } as OrderItem;
      const item2 = { productId: 'prod-2', quantity: 3 } as OrderItem;

      const order = fakeOrder({
        status: OrderStatus.CONFIRMED_BY_COLMADO,
        creditApplied: '0.00',
        customer: fakeUser() as never,
      });
      ordersRepo.findOne
        .mockResolvedValueOnce(order)
        .mockResolvedValueOnce(
          fakeOrder({ status: OrderStatus.CANCELLED, customer: fakeUser() as never }),
        );

      const incrementCalls: Array<{ id: string; qty: number }> = [];

      (dataSource.transaction as jest.Mock).mockImplementation(
        async (cb: (mgr: EntityManager) => Promise<unknown>) => {
          const orderRepo = makeRepoMock<Order>();
          const itemRepo = makeRepoMock<OrderItem>();
          const productRepo = makeRepoMock<Product>();
          orderRepo.update.mockResolvedValue({ affected: 1 } as never);
          itemRepo.find.mockResolvedValue([item1, item2]);
          (productRepo as unknown as { increment: jest.Mock }).increment = jest
            .fn()
            .mockImplementation((where: { id: string }, _col: string, qty: number) => {
              incrementCalls.push({ id: where.id, qty });
              return Promise.resolve({ affected: 1 });
            });

          const mgr = {
            getRepository: (entity: unknown) => {
              if (entity === Order) return orderRepo;
              if (entity === OrderItem) return itemRepo;
              if (entity === Product) return productRepo;
              return makeRepoMock();
            },
          };
          return cb(mgr as unknown as EntityManager);
        },
      );

      await service.updateStatus(
        'order-1',
        { status: OrderStatus.CANCELLED },
        fakeUser(UserRole.SUPER_ADMIN_DELIVERY),
      );

      expect(incrementCalls).toEqual([
        { id: 'prod-1', qty: 2 },
        { id: 'prod-2', qty: 3 },
      ]);
      // points + rental reversals always run on cancel
      expect(pointsService.reverseRedemptionForOrder).toHaveBeenCalledWith(
        'order-1',
        expect.anything(),
      );
      expect(rentalsService.cancelPendingForOrder).toHaveBeenCalledWith(
        'order-1',
        expect.anything(),
      );
    });

    it('does NOT re-increment stock when cancelling an order that was never confirmed', async () => {
      const order = fakeOrder({
        status: OrderStatus.PENDING_QUOTE,
        creditApplied: '0.00',
        customer: fakeUser() as never,
      });
      ordersRepo.findOne
        .mockResolvedValueOnce(order)
        .mockResolvedValueOnce(
          fakeOrder({ status: OrderStatus.CANCELLED, customer: fakeUser() as never }),
        );

      const incrementSpy = jest.fn();

      (dataSource.transaction as jest.Mock).mockImplementation(
        async (cb: (mgr: EntityManager) => Promise<unknown>) => {
          const orderRepo = makeRepoMock<Order>();
          const productRepo = makeRepoMock<Product>();
          orderRepo.update.mockResolvedValue({ affected: 1 } as never);
          (productRepo as unknown as { increment: jest.Mock }).increment = incrementSpy;

          const mgr = {
            getRepository: (entity: unknown) => {
              if (entity === Order) return orderRepo;
              if (entity === Product) return productRepo;
              return makeRepoMock();
            },
          };
          return cb(mgr as unknown as EntityManager);
        },
      );

      await service.updateStatus(
        'order-1',
        { status: OrderStatus.CANCELLED },
        fakeUser(UserRole.SUPER_ADMIN_DELIVERY),
      );

      expect(incrementSpy).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // markDelivered — non-stripe / already-paid else branch (line 589)
  // ─────────────────────────────────────────────────────────────────────────

  describe('updateStatus → markDelivered — capture vs no-capture', () => {
    function setupDeliverTx(order: Order) {
      ordersRepo.findOne
        .mockResolvedValueOnce(order)
        .mockResolvedValueOnce({ ...order, status: OrderStatus.DELIVERED } as Order);

      (dataSource.transaction as jest.Mock).mockImplementation(
        async (cb: (mgr: EntityManager) => Promise<unknown>) => {
          const orderRepo = makeRepoMock<Order>();
          orderRepo.findOne.mockResolvedValue({ ...order, id: 'order-1' } as never);
          orderRepo.update.mockResolvedValue({ affected: 1 } as never);
          const mgr = {
            getRepository: (entity: unknown) =>
              entity === Order ? orderRepo : makeRepoMock(),
          };
          return cb(mgr as unknown as EntityManager);
        },
      );
    }

    it('does NOT capture for a cash order — uses the no-capture else branch', async () => {
      const cashOrder = fakeOrder({
        status: OrderStatus.IN_DELIVERY_ROUTE,
        paymentMethod: PaymentMethod.CASH,
        stripePaymentIntentId: null,
        paidAt: null,
        customer: fakeUser() as never,
        items: [],
      });
      setupDeliverTx(cashOrder);

      await service.updateStatus(
        'order-1',
        { status: OrderStatus.DELIVERED },
        fakeUser(UserRole.SUPER_ADMIN_DELIVERY),
      );

      expect(paymentsService.captureIntent).not.toHaveBeenCalled();
      expect(pointsService.creditForOrder).toHaveBeenCalled();
      expect(invoicesService.createForOrder).toHaveBeenCalled();
      expect(promotersService.creditCommissionsForOrder).toHaveBeenCalled();
    });

    it('does NOT capture for an already-paid digital order (paidAt set)', async () => {
      const paidOrder = fakeOrder({
        status: OrderStatus.IN_DELIVERY_ROUTE,
        paymentMethod: PaymentMethod.DIGITAL,
        stripePaymentIntentId: 'pi_already',
        paidAt: new Date(),
        customer: fakeUser() as never,
        items: [],
      });
      setupDeliverTx(paidOrder);

      await service.updateStatus(
        'order-1',
        { status: OrderStatus.DELIVERED },
        fakeUser(UserRole.SUPER_ADMIN_DELIVERY),
      );

      expect(paymentsService.captureIntent).not.toHaveBeenCalled();
    });

    it('throws NotFound when the order disappears inside the markDelivered TX', async () => {
      const order = fakeOrder({
        status: OrderStatus.IN_DELIVERY_ROUTE,
        paymentMethod: PaymentMethod.CASH,
        customer: fakeUser() as never,
        items: [],
      });
      ordersRepo.findOne.mockResolvedValueOnce(order);

      (dataSource.transaction as jest.Mock).mockImplementation(
        async (cb: (mgr: EntityManager) => Promise<unknown>) => {
          const orderRepo = makeRepoMock<Order>();
          orderRepo.findOne.mockResolvedValue(null); // gone inside TX
          const mgr = {
            getRepository: (entity: unknown) =>
              entity === Order ? orderRepo : makeRepoMock(),
          };
          return cb(mgr as unknown as EntityManager);
        },
      );

      await expect(
        service.updateStatus(
          'order-1',
          { status: OrderStatus.DELIVERED },
          fakeUser(UserRole.SUPER_ADMIN_DELIVERY),
        ),
      ).rejects.toThrow('Pedido no encontrado');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // confirmAndDecrementStock — guard branches (lines 627, 642, 639)
  // ─────────────────────────────────────────────────────────────────────────

  describe('updateStatus → confirmAndDecrementStock — guards', () => {
    it('throws NotFound when the order disappears inside the confirm TX', async () => {
      const order = fakeOrder({
        status: OrderStatus.PENDING_VALIDATION,
        customer: fakeUser() as never,
        items: [],
      });
      ordersRepo.findOne.mockResolvedValueOnce(order);

      (dataSource.transaction as jest.Mock).mockImplementation(
        async (cb: (mgr: EntityManager) => Promise<unknown>) => {
          const orderRepo = makeRepoMock<Order>();
          orderRepo.findOne.mockResolvedValue(null);
          const mgr = {
            getRepository: (entity: unknown) =>
              entity === Order ? orderRepo : makeRepoMock(),
          };
          return cb(mgr as unknown as EntityManager);
        },
      );

      await expect(
        service.updateStatus(
          'order-1',
          { status: OrderStatus.CONFIRMED_BY_COLMADO },
          fakeUser(UserRole.SUPER_ADMIN_DELIVERY),
        ),
      ).rejects.toThrow('Pedido no encontrado');
    });

    it('throws BadRequest when the order is no longer PENDING_VALIDATION inside the TX', async () => {
      const order = fakeOrder({
        status: OrderStatus.PENDING_VALIDATION,
        customer: fakeUser() as never,
        items: [],
      });
      ordersRepo.findOne.mockResolvedValueOnce(order);

      (dataSource.transaction as jest.Mock).mockImplementation(
        async (cb: (mgr: EntityManager) => Promise<unknown>) => {
          const orderRepo = makeRepoMock<Order>();
          // Inside TX the locked row shows a different status (race lost)
          orderRepo.findOne.mockResolvedValue({
            ...order,
            status: OrderStatus.CONFIRMED_BY_COLMADO,
          } as never);
          const mgr = {
            getRepository: (entity: unknown) =>
              entity === Order ? orderRepo : makeRepoMock(),
          };
          return cb(mgr as unknown as EntityManager);
        },
      );

      await expect(
        service.updateStatus(
          'order-1',
          { status: OrderStatus.CONFIRMED_BY_COLMADO },
          fakeUser(UserRole.SUPER_ADMIN_DELIVERY),
        ),
      ).rejects.toThrow('ya no está pendiente de validación');
    });

    it('skips a missing product (productRepo.findOne returns null) and continues', async () => {
      const item = { productId: 'prod-gone', quantity: 1 } as OrderItem;
      const order = fakeOrder({
        status: OrderStatus.PENDING_VALIDATION,
        customer: fakeUser() as never,
        items: [],
      });
      ordersRepo.findOne
        .mockResolvedValueOnce(order)
        .mockResolvedValueOnce({
          ...order,
          status: OrderStatus.CONFIRMED_BY_COLMADO,
        } as Order);

      let productUpdateCalled = false;

      (dataSource.transaction as jest.Mock).mockImplementation(
        async (cb: (mgr: EntityManager) => Promise<unknown>) => {
          const orderRepo = makeRepoMock<Order>();
          const itemRepo = makeRepoMock<OrderItem>();
          const productRepo = makeRepoMock<Product>();
          orderRepo.findOne.mockResolvedValue({
            ...order,
            id: 'order-1',
            status: OrderStatus.PENDING_VALIDATION,
          } as never);
          orderRepo.update.mockResolvedValue({ affected: 1 } as never);
          itemRepo.find.mockResolvedValue([item]);
          productRepo.findOne.mockResolvedValue(null); // product gone → continue
          productRepo.update.mockImplementation(() => {
            productUpdateCalled = true;
            return Promise.resolve({ affected: 1 }) as never;
          });

          const mgr = {
            getRepository: (entity: unknown) => {
              if (entity === Order) return orderRepo;
              if (entity === OrderItem) return itemRepo;
              if (entity === Product) return productRepo;
              return makeRepoMock();
            },
          };
          return cb(mgr as unknown as EntityManager);
        },
      );

      await service.updateStatus(
        'order-1',
        { status: OrderStatus.CONFIRMED_BY_COLMADO },
        fakeUser(UserRole.SUPER_ADMIN_DELIVERY),
      );

      // No stock update because the product was missing
      expect(productUpdateCalled).toBe(false);
    });

    it('throws BadRequest when stock is insufficient at confirm time', async () => {
      const item = { productId: 'prod-low', quantity: 5 } as OrderItem;
      const order = fakeOrder({
        status: OrderStatus.PENDING_VALIDATION,
        customer: fakeUser() as never,
        items: [],
      });
      ordersRepo.findOne.mockResolvedValueOnce(order);

      (dataSource.transaction as jest.Mock).mockImplementation(
        async (cb: (mgr: EntityManager) => Promise<unknown>) => {
          const orderRepo = makeRepoMock<Order>();
          const itemRepo = makeRepoMock<OrderItem>();
          const productRepo = makeRepoMock<Product>();
          orderRepo.findOne.mockResolvedValue({
            ...order,
            id: 'order-1',
            status: OrderStatus.PENDING_VALIDATION,
          } as never);
          itemRepo.find.mockResolvedValue([item]);
          productRepo.findOne.mockResolvedValue(
            fakeProduct({ id: 'prod-low', stock: 2, name: 'Low Stock' }),
          );

          const mgr = {
            getRepository: (entity: unknown) => {
              if (entity === Order) return orderRepo;
              if (entity === OrderItem) return itemRepo;
              if (entity === Product) return productRepo;
              return makeRepoMock();
            },
          };
          return cb(mgr as unknown as EntityManager);
        },
      );

      await expect(
        service.updateStatus(
          'order-1',
          { status: OrderStatus.CONFIRMED_BY_COLMADO },
          fakeUser(UserRole.SUPER_ADMIN_DELIVERY),
        ),
      ).rejects.toThrow('Stock insuficiente para el producto');
    });

    it('sets isAvailable=false when stock hits 0 on confirm', async () => {
      const item = { productId: 'prod-last', quantity: 4 } as OrderItem;
      const order = fakeOrder({
        status: OrderStatus.PENDING_VALIDATION,
        customer: fakeUser() as never,
        items: [],
      });
      ordersRepo.findOne
        .mockResolvedValueOnce(order)
        .mockResolvedValueOnce({
          ...order,
          status: OrderStatus.CONFIRMED_BY_COLMADO,
        } as Order);

      let captured: Partial<Product> | undefined;

      (dataSource.transaction as jest.Mock).mockImplementation(
        async (cb: (mgr: EntityManager) => Promise<unknown>) => {
          const orderRepo = makeRepoMock<Order>();
          const itemRepo = makeRepoMock<OrderItem>();
          const productRepo = makeRepoMock<Product>();
          orderRepo.findOne.mockResolvedValue({
            ...order,
            id: 'order-1',
            status: OrderStatus.PENDING_VALIDATION,
          } as never);
          orderRepo.update.mockResolvedValue({ affected: 1 } as never);
          itemRepo.find.mockResolvedValue([item]);
          // stock exactly equals quantity → nextStock = 0 → isAvailable forced false
          productRepo.findOne.mockResolvedValue(
            fakeProduct({ id: 'prod-last', stock: 4, isAvailable: true }),
          );
          productRepo.update.mockImplementation(
            (_id: string, data: Partial<Product>) => {
              captured = data;
              return Promise.resolve({ affected: 1 }) as never;
            },
          );

          const mgr = {
            getRepository: (entity: unknown) => {
              if (entity === Order) return orderRepo;
              if (entity === OrderItem) return itemRepo;
              if (entity === Product) return productRepo;
              return makeRepoMock();
            },
          };
          return cb(mgr as unknown as EntityManager);
        },
      );

      await service.updateStatus(
        'order-1',
        { status: OrderStatus.CONFIRMED_BY_COLMADO },
        fakeUser(UserRole.SUPER_ADMIN_DELIVERY),
      );

      expect(captured).toEqual({ stock: 0, isAvailable: false });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // updateStatus — plain status update (else branch, line 555)
  // ─────────────────────────────────────────────────────────────────────────

  describe('updateStatus — plain transition (no side effects)', () => {
    it('updates status directly for CONFIRMED → IN_DELIVERY_ROUTE', async () => {
      const order = fakeOrder({
        status: OrderStatus.CONFIRMED_BY_COLMADO,
        customer: fakeUser() as never,
      });
      ordersRepo.findOne
        .mockResolvedValueOnce(order)
        .mockResolvedValueOnce({
          ...order,
          status: OrderStatus.IN_DELIVERY_ROUTE,
        } as Order);
      ordersRepo.update.mockResolvedValue({ affected: 1 } as never);

      await service.updateStatus(
        'order-1',
        { status: OrderStatus.IN_DELIVERY_ROUTE },
        fakeUser(UserRole.SUPER_ADMIN_DELIVERY),
      );

      expect(ordersRepo.update).toHaveBeenCalledWith('order-1', {
        status: OrderStatus.IN_DELIVERY_ROUTE,
      });
      // Direct update path → no transaction, no stock changes
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });
  });
});
