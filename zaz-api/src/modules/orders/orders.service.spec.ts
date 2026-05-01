/**
 * Unit specs for OrdersService — credit and subscription branches.
 *
 * Tests focus on: overdue gate, credit application by role, subscription
 * shipping override, and idempotent credit reversal on CANCELLED.
 */

import {
  BadRequestException,
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

function fakeProduct(): Product {
  return {
    id: 'prod-1',
    name: 'Test Product',
    isAvailable: true,
    stock: 10,
    priceCents: 1000,
    salePrice: null,
    salePriceStart: null,
    salePriceEnd: null,
    description: null,
    imageUrl: null,
    categoryId: 'cat-1',
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as Product;
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
    } as unknown as jest.Mocked<SubscriptionService>;

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

    it('sets shippingCents=0 and wasSubscriberAtQuote=true for active subscriber', async () => {
      const order = fakeOrder({
        status: OrderStatus.PENDING_QUOTE,
        customerId: 'user-1',
        customer: fakeUser() as never,
      });
      ordersRepo.findOne
        .mockResolvedValueOnce(order) // inside findOne called by setQuote
        .mockResolvedValueOnce({ ...order, shipping: '0.00', wasSubscriberAtQuote: true } as never);

      subscriptionService.isActiveSubscriber.mockResolvedValue(true);
      ordersRepo.update.mockResolvedValue({ affected: 1 } as never);

      await service.setQuote('order-1', 300 /* 3.00 */, superUser);

      expect(ordersRepo.update).toHaveBeenCalledWith(
        'order-1',
        expect.objectContaining({
          shipping: '0.00',
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
});
