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
    } as unknown as jest.Mocked<SubscriptionService>;

    twilioService = {
      sendOrderNotificationSms: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<TwilioService>;

    rentalsService = {
      findActiveByUserAndProduct: jest.fn().mockResolvedValue(null),
      activateRentalsForOrder: jest.fn().mockResolvedValue([]),
      activateForOrder: jest.fn().mockResolvedValue({} as never),
      createForOrder: jest.fn().mockResolvedValue({}),
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
  // the MIXED_CART_RENTAL guard, mixed carts are rejected before pricing runs.
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
  // Error code: MIXED_CART_RENTAL (400 BadRequestException).
  // ─────────────────────────────────────────────────────────────────────────

  describe('create — mixed-cart server enforcement (T6.1–T6.3)', () => {
    const rentalProduct = fakeRentalProduct({ id: 'prod-dispenser' });
    const singleProduct = fakeProduct({ id: 'prod-water' });

    // T6.1 — MUST throw 400 MIXED_CART_RENTAL for mixed cart
    it('T6.1: throws BadRequestException with code MIXED_CART_RENTAL when cart mixes rental + single_payment', async () => {
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

    it('T6.1-triangulate: mixed-cart error response contains MIXED_CART_RENTAL code', async () => {
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
      expect(responseBody.code).toBe('MIXED_CART_RENTAL');
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
});
