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
import { DeliveryZone } from '../../entities/delivery-zone.entity';
import { OrderStatus, PaymentMethod, UserRole } from '../../entities/enums';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { PaymentsService } from '../payments/payments.service';
import { PointsService } from '../points/points.service';
import { InvoicesService } from '../invoices/invoices.service';
import { PromotersService } from '../promoters/promoters.service';
import { SellersService } from '../sellers/sellers.service';
import { SubscriptionTier } from '../../entities/subscription-plan.entity';
import { ShippingService } from '../shipping/shipping.service';
import { ShippingRateService } from '../shipping/shipping-rate.service';
import { CreditService } from '../credit/credit.service';
import { SubscriptionService } from '../subscription/subscription.service';
import { TwilioService } from '../twilio/twilio.service';
import { RentalsService } from '../rentals/rentals.service';
import { OrderNotificationsService } from './order-notifications.service';
import { DeliveryZonesService } from '../addresses/delivery-zones.service';
import { TAX_RATE } from '../../common/tax';

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
    query: jest.fn(),
    delete: jest.fn(),
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
    requiresQuote: true, // default — orders need a manual cotización
    priceToPublic: '5.00', // getEffectivePrice reads this; 5.00 → 500 cents
    priceCents: 500, // legacy field used in tests that cast to unknown
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
    deliverySurcharge: '0.00',
    scheduledDeliveryDate: null,
    tax: '0.00',
    taxRate: '0.08887',
    taxableSubtotal: '0.00',
    totalAmount: '10.00',
    tip: '0.00',
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
  let deliveryZonesRepo: jest.Mocked<Repository<DeliveryZone>>;
  let deliveryZonesService: { resolveTaxRate: jest.Mock };
  let dataSource: jest.Mocked<DataSource>;
  let paymentsService: jest.Mocked<PaymentsService>;
  let pointsService: jest.Mocked<PointsService>;
  let invoicesService: jest.Mocked<InvoicesService>;
  let promotersService: jest.Mocked<PromotersService>;
  let sellersService: jest.Mocked<SellersService>;
  let shippingService: jest.Mocked<ShippingService>;
  let shippingRateService: jest.Mocked<ShippingRateService>;
  let creditService: jest.Mocked<CreditService>;
  let subscriptionService: jest.Mocked<SubscriptionService>;
  let twilioService: jest.Mocked<TwilioService>;
  let rentalsService: jest.Mocked<RentalsService>;
  let orderNotifications: {
    notifyStatus: jest.Mock;
    notifyScheduledDelivery: jest.Mock;
  };

  beforeEach(async () => {
    ordersRepo = makeRepoMock<Order>();
    itemsRepo = makeRepoMock<OrderItem>();
    productsRepo = makeRepoMock<Product>();
    userAddressesRepo = makeRepoMock<UserAddress>();
    deliveryZonesRepo = makeRepoMock<DeliveryZone>();
    deliveryZonesRepo.find.mockResolvedValue([]);
    // Por defecto la dirección no cae en ninguna zona: se cobra el fallback
    // histórico, así que TODOS los tests de plata que ya existían siguen dando
    // exactamente el mismo número.
    deliveryZonesService = {
      resolveTaxRate: jest
        .fn()
        .mockResolvedValue({ zoneId: null, taxRate: TAX_RATE }),
    };

    paymentsService = {
      createAuthorizationIntent: jest.fn(),
      retrieveIntent: jest.fn(),
      captureIntent: jest.fn(),
      cancelIntent: jest.fn().mockResolvedValue(true),
      handleAuthFailureByIntentId: jest.fn(),
      markAuthorizedByIntentId: jest.fn(),
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

    sellersService = {
      creditCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<SellersService>;

    promotersService = {
      creditCommissionsForOrder: jest.fn(),
    } as unknown as jest.Mocked<PromotersService>;

    shippingService = {
      computeQuote: jest.fn().mockResolvedValue({ shippingCents: 0 }),
      getOrigin: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<ShippingService>;

    // La tarifa plana ya no es una constante: la lee OrdersService en cada
    // create(). Se mockea en 500 (el default) para que los tests viejos sigan
    // hablando de los $5 de siempre.
    shippingRateService = {
      getFlatShippingCents: jest.fn().mockResolvedValue(500),
      setFlatShippingCents: jest.fn((cents: number) => Promise.resolve(cents)),
    } as unknown as jest.Mocked<ShippingRateService>;

    creditService = {
      assertNotOverdue: jest.fn().mockResolvedValue(undefined),
      getAccountWithLock: jest.fn(),
      applyCharge: jest.fn(),
      reverseCharge: jest.fn(),
      isOverdue: jest.fn(),
    } as unknown as jest.Mocked<CreditService>;

    subscriptionService = {
      isActiveSubscriber: jest.fn().mockResolvedValue(false),
      getOrCreateStripeCustomer: jest
        .fn()
        .mockResolvedValue('cus_test_default'),
      getPlanNetCents: jest.fn().mockResolvedValue(699),
      getActiveTier: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<SubscriptionService>;

    twilioService = {
      sendOrderNotificationSms: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<TwilioService>;

    rentalsService = {
      findActiveByUserAndProduct: jest.fn().mockResolvedValue(null),
      activateRentalsForOrder: jest.fn().mockResolvedValue([]),
      activateForOrder: jest.fn().mockResolvedValue({}),
      createForOrder: jest.fn().mockResolvedValue({}),
      cancelPendingForOrder: jest.fn().mockResolvedValue(undefined),
      getOrderIdsWithRentals: jest.fn().mockResolvedValue([]),
      countBebederoRentalsForUser: jest.fn().mockResolvedValue(0),
      countRentalsForUserAndProduct: jest.fn().mockResolvedValue(0),
      ensurePremiumBebederoRatePrices: jest.fn().mockResolvedValue({
        freePriceId: 'price_free_existing',
        premiumPriceId: 'price_premium_rate',
        premiumCatalogPriceId: 'price_premium_catalog',
      }),
      ensureBebederoRatePrices: jest.fn().mockResolvedValue({
        freePriceId: 'price_free_existing',
        subscriberPriceId: 'price_sub_existing',
      }),
    } as unknown as jest.Mocked<RentalsService>;

    dataSource = {
      transaction: jest.fn(),
      query: jest.fn(),
    } as unknown as jest.Mocked<DataSource>;

    orderNotifications = {
      notifyStatus: jest.fn(),
      notifyScheduledDelivery: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: getRepositoryToken(Order), useValue: ordersRepo },
        { provide: getRepositoryToken(OrderItem), useValue: itemsRepo },
        { provide: getRepositoryToken(Product), useValue: productsRepo },
        {
          provide: getRepositoryToken(UserAddress),
          useValue: userAddressesRepo,
        },
        {
          provide: getRepositoryToken(DeliveryZone),
          useValue: deliveryZonesRepo,
        },
        { provide: DeliveryZonesService, useValue: deliveryZonesService },
        { provide: DataSource, useValue: dataSource },
        { provide: PaymentsService, useValue: paymentsService },
        { provide: PointsService, useValue: pointsService },
        { provide: InvoicesService, useValue: invoicesService },
        { provide: PromotersService, useValue: promotersService },
        { provide: SellersService, useValue: sellersService },
        { provide: ShippingService, useValue: shippingService },
        { provide: ShippingRateService, useValue: shippingRateService },
        { provide: CreditService, useValue: creditService },
        { provide: SubscriptionService, useValue: subscriptionService },
        { provide: TwilioService, useValue: twilioService },
        { provide: RentalsService, useValue: rentalsService },
        {
          provide: OrderNotificationsService,
          useValue: orderNotifications,
        },
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
    (service as unknown as AutoConfirmFreeTarget).tryAutoConfirmFreeOrder(
      orderId,
    );
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
      ordersRepo.findOne.mockResolvedValue(
        quotedCashOrder({ skipQuote: true }),
      );
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
      ordersRepo.findOne.mockResolvedValue(
        quotedCashOrder({ skipQuote: true }),
      );
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

    it('auto-confirma una orden skip_quote cash con envío fijo $5', async () => {
      // En skip-cotización el cliente ya aceptó el total FINAL (envío incluido)
      // en el checkout. El guard de envío protege a la orden cotizada por el
      // admin, que el cliente todavía no vio — no a ésta.
      ordersRepo.findOne.mockResolvedValue(
        freeQuotedCash({
          skipQuote: true,
          shipping: '5.00',
          totalAmount: '16.33',
        }),
      );
      ordersRepo.update.mockResolvedValue({} as never);
      const confirmSpy = spyConfirmStock();

      await callAutoConfirmFree('order-1');

      expect(ordersRepo.update).toHaveBeenCalledWith('order-1', {
        status: OrderStatus.PENDING_VALIDATION,
      });
      expect(confirmSpy).toHaveBeenCalledWith('order-1');
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
        freeQuotedCash({
          paymentMethod: PaymentMethod.DIGITAL,
          totalAmount: '0.00',
        }),
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
        .mockResolvedValueOnce(
          fakeOrder({ id: 'o2', status: OrderStatus.QUOTED }),
        );

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

      await expect(
        service.create(fakeUser(UserRole.CLIENT), dto),
      ).rejects.toThrow(HttpException);

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
      const orderWithItems = fakeOrder({
        customer: fakeUser() as never,
        items: [],
      });
      (dataSource.transaction as jest.Mock).mockImplementation(
        async (cb: (mgr: EntityManager) => Promise<unknown>) => {
          const orderRepo = makeRepoMock<Order>();
          const itemRepo = makeRepoMock<OrderItem>();
          orderRepo.create.mockImplementation(
            (d) => ({ ...d, id: 'order-1' }) as Order,
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
      creditService.getAccountWithLock.mockResolvedValue(
        creditAccount as never,
      );
      creditService.applyCharge.mockResolvedValue({
        amountCents: 500,
      } as never);

      const savedOrder = fakeOrder({ creditApplied: '5.00' });
      const orderWithItems = fakeOrder({
        creditApplied: '5.00',
        customer: fakeUser() as never,
        items: [],
      });

      // Simulate transaction: call the callback with a mock entity manager
      (dataSource.transaction as jest.Mock).mockImplementation(
        async (cb: (mgr: EntityManager) => Promise<unknown>) => {
          const orderRepo = makeRepoMock<Order>();
          const itemRepo = makeRepoMock<OrderItem>();
          orderRepo.create.mockImplementation(
            (dto) => ({ ...dto, id: 'order-1' }) as Order,
          );
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
        },
      );

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
      (dataSource.transaction as jest.Mock).mockImplementation(
        async (cb: (mgr: EntityManager) => Promise<unknown>) => {
          const orderRepo = makeRepoMock<Order>();
          const itemRepo = makeRepoMock<OrderItem>();
          orderRepo.create.mockImplementation(
            (d) => ({ ...d, id: 'order-1' }) as Order,
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
          };
          return cb(mgr as unknown as EntityManager);
        },
      );

      ordersRepo.findOne.mockResolvedValue(
        fakeOrder({ customer: fakeUser() as never }),
      );

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
          orderRepo.create.mockImplementation(
            (d) => ({ ...d, id: 'order-1' }) as Order,
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
      twilioService.sendOrderNotificationSms.mockReturnValue(
        new Promise(() => {
          /* never resolves */
        }),
      );

      const resultPromise = service.create(fakeUser(UserRole.CLIENT), dto);

      // Use a race: if create() awaits SMS, it would hang and this would timeout.
      // We race with a fast-resolving promise to confirm create() resolves quickly.
      const result = await Promise.race([
        resultPromise,
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('create() was blocked by SMS')),
            500,
          ),
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
      await expect(
        service.create(fakeUser(UserRole.CLIENT), dto),
      ).resolves.toBeDefined();
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
      creditService.reverseCharge.mockResolvedValue({
        amountCents: 500,
      } as never);

      const cancelledOrder = fakeOrder({
        status: OrderStatus.CANCELLED,
        customer: fakeUser() as never,
      });

      // Transaction mock for the cancel branch
      (dataSource.transaction as jest.Mock).mockImplementation(
        async (cb: (mgr: EntityManager) => Promise<unknown>) => {
          const orderRepo = makeRepoMock<Order>();
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
      const cancelledOrder = fakeOrder({
        status: OrderStatus.CANCELLED,
        customer: fakeUser() as never,
      });

      // Reset findOne to return fresh values for this test
      ordersRepo.findOne
        .mockReset()
        .mockResolvedValueOnce(order) // first call inside updateStatus → findOne
        .mockResolvedValueOnce(cancelledOrder); // second call at end of updateStatus

      (dataSource.transaction as jest.Mock).mockImplementation(
        async (cb: (mgr: EntityManager) => Promise<unknown>) => {
          const orderRepo = makeRepoMock<Order>();
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
        { status: OrderStatus.CANCELLED },
        fakeUser(UserRole.SUPER_ADMIN_DELIVERY),
      );

      expect(creditService.reverseCharge).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // setQuote — el envío que tipea el admin se cobra a todos
  //
  // Regla del dueño (2026-09-14): "los suscriptores tampoco van a tener el
  // envío gratis". La suscripción ya no perdona el viaje, así que setQuote ya
  // no pisa el monto cotizado: `wasSubscriberAtQuote` queda sólo como dato.
  // -------------------------------------------------------------------------

  describe('setQuote', () => {
    const superUser = fakeUser(UserRole.SUPER_ADMIN_DELIVERY);

    it('el suscriptor paga el envío que cotiza el admin; wasSubscriberAtQuote sigue en true', async () => {
      const order = fakeOrder({
        status: OrderStatus.PENDING_QUOTE,
        customerId: 'user-1',
        customer: fakeUser() as never,
        subtotal: '10.00',
        pointsRedeemed: '0.00',
      });
      ordersRepo.findOne
        .mockResolvedValueOnce(order) // inside findOne called by setQuote
        .mockResolvedValueOnce({
          ...order,
          shipping: '3.00',
          wasSubscriberAtQuote: true,
        });

      subscriptionService.isActiveSubscriber.mockResolvedValue(true);
      ordersRepo.update.mockResolvedValue({ affected: 1 } as never);
      // Isolate the quote assertion from the free-shipping auto-confirm
      // side effect (covered separately in its own tests).
      spyAutoConfirmFree();

      await service.setQuote('order-1', 300 /* admin quoted 3.00 */, superUser);

      const updateCall = ordersRepo.update.mock.calls[0][1] as Record<
        string,
        unknown
      >;
      // Sin override: el suscriptor paga exactamente lo que cotizó el admin.
      expect(updateCall.shipping).toBe('3.00');
      // 1000 + 300 = 1300 gravable → round(1300 * 0.08887) = 116
      expect(updateCall.tax).toBe('1.16');
      expect(updateCall.totalAmount).toBe('14.16');
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
      ordersRepo.findOne.mockResolvedValueOnce(order).mockResolvedValueOnce({
        ...order,
        shipping: '3.00',
        wasSubscriberAtQuote: false,
      });

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
      const updateCall = ordersRepo.update.mock.calls[0][1] as Record<
        string,
        unknown
      >;
      expect(updateCall.shipping).not.toBe('0.00');
    });

    it('auto-confirms after quoting when the admin quotes $0 shipping', async () => {
      const order = fakeOrder({
        status: OrderStatus.PENDING_QUOTE,
        customerId: 'user-1',
        customer: fakeUser() as never,
        subtotal: '10.00',
        pointsRedeemed: '0.00',
      });
      ordersRepo.findOne
        .mockResolvedValueOnce(order)
        .mockResolvedValueOnce({ ...order, shipping: '0.00' });
      // Ya no hay envío gratis por suscripción: el único envío $0 es el que
      // el admin decide perdonar al cotizar.
      subscriptionService.isActiveSubscriber.mockResolvedValue(false);
      ordersRepo.update.mockResolvedValue({ affected: 1 } as never);
      const autoSpy = spyAutoConfirmFree();

      await service.setQuote('order-1', 0, superUser);

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
        .mockResolvedValueOnce({ ...order, shipping: '3.00' });
      subscriptionService.isActiveSubscriber.mockResolvedValue(false);
      ordersRepo.update.mockResolvedValue({ affected: 1 } as never);
      const autoSpy = spyAutoConfirmFree();

      await service.setQuote('order-1', 300, superUser);

      expect(autoSpy).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // setQuote — recargo por distancia y día de entrega asignado
  //
  // El dueño quiere dos cosas para el cliente lejano: asignarle el día que le
  // toca el reparto, y cobrarle un delivery APARTE del envío ("un pago
  // ajustado"). El recargo es una tercera fuente de plata en la orden, y estos
  // tests fijan las tres reglas que la hacen no perder dinero.
  // -------------------------------------------------------------------------

  describe('setQuote — recargo por distancia', () => {
    const superUser = fakeUser(UserRole.SUPER_ADMIN_DELIVERY);

    const quotableOrder = () =>
      fakeOrder({
        status: OrderStatus.PENDING_QUOTE,
        customerId: 'user-1',
        customer: fakeUser() as never,
        subtotal: '10.00',
        pointsRedeemed: '0.00',
      });

    it('el suscriptor paga el envío Y el recargo — la suscripción no cubre el viaje', async () => {
      // Antes la suscripción perdonaba el envío y este test fijaba que el
      // recargo igual sobrevivía. Desde 2026-09-14 no perdona nada: el
      // suscriptor lejano paga las dos cosas, cada una en su columna.
      const order = quotableOrder();
      ordersRepo.findOne
        .mockResolvedValueOnce(order)
        .mockResolvedValueOnce({ ...order, shipping: '3.00' });
      subscriptionService.isActiveSubscriber.mockResolvedValue(true);
      ordersRepo.update.mockResolvedValue({ affected: 1 } as never);
      spyAutoConfirmFree();

      await service.setQuote('order-1', 300, superUser, {
        surchargeCents: 1000,
      });

      const call = ordersRepo.update.mock.calls[0][1] as Record<
        string,
        unknown
      >;
      expect(call.shipping).toBe('3.00');
      expect(call.deliverySurcharge).toBe('10.00');
      // subtotal 1000 + envío 300 + recargo 1000 = base gravable 2300
      // impuesto = round(2300 * 0.08887) = 204
      expect(call.tax).toBe('2.04');
      expect(call.totalAmount).toBe('25.04');
    });

    it('el recargo se prorratea en el impuesto igual que el envío', async () => {
      const order = quotableOrder();
      ordersRepo.findOne
        .mockResolvedValueOnce(order)
        .mockResolvedValueOnce({ ...order });
      subscriptionService.isActiveSubscriber.mockResolvedValue(false);
      ordersRepo.update.mockResolvedValue({ affected: 1 } as never);

      await service.setQuote('order-1', 300, superUser, {
        surchargeCents: 1000,
      });

      const call = ordersRepo.update.mock.calls[0][1] as Record<
        string,
        unknown
      >;
      expect(call.shipping).toBe('3.00');
      expect(call.deliverySurcharge).toBe('10.00');
      // 1000 + 300 + 1000 = 2300 gravable → round(2300 * 0.08887) = 204
      expect(call.taxableSubtotal).toBe('23.00');
      expect(call.tax).toBe('2.04');
      expect(call.totalAmount).toBe('25.04');
    });

    it('NO auto-confirma cuando el envío es 0 pero hay recargo pendiente', async () => {
      // La trampa: el admin perdona el envío pero le cobra la distancia. Si el
      // guard sigue mirando sólo el envío, la orden auto-confirma como
      // "gratis" y el recargo NUNCA se cobra por tarjeta.
      const order = quotableOrder();
      ordersRepo.findOne
        .mockResolvedValueOnce(order)
        .mockResolvedValueOnce({ ...order });
      subscriptionService.isActiveSubscriber.mockResolvedValue(false);
      ordersRepo.update.mockResolvedValue({ affected: 1 } as never);
      const autoSpy = spyAutoConfirmFree();

      await service.setQuote('order-1', 0, superUser, {
        surchargeCents: 1000,
      });

      expect(autoSpy).not.toHaveBeenCalled();
    });

    it('sigue auto-confirmando cuando no hay ni envío ni recargo', async () => {
      const order = quotableOrder();
      ordersRepo.findOne
        .mockResolvedValueOnce(order)
        .mockResolvedValueOnce({ ...order });
      subscriptionService.isActiveSubscriber.mockResolvedValue(false);
      ordersRepo.update.mockResolvedValue({ affected: 1 } as never);
      const autoSpy = spyAutoConfirmFree();

      await service.setQuote('order-1', 0, superUser, { surchargeCents: 0 });

      expect(autoSpy).toHaveBeenCalled();
    });

    it('guarda el día de entrega que le asigna el admin', async () => {
      const order = quotableOrder();
      ordersRepo.findOne
        .mockResolvedValueOnce(order)
        .mockResolvedValueOnce({ ...order });
      subscriptionService.isActiveSubscriber.mockResolvedValue(false);
      ordersRepo.update.mockResolvedValue({ affected: 1 } as never);

      await service.setQuote('order-1', 300, superUser, {
        scheduledDeliveryDate: '2026-09-15',
      });

      expect(ordersRepo.update).toHaveBeenCalledWith(
        'order-1',
        expect.objectContaining({ scheduledDeliveryDate: '2026-09-15' }),
      );
    });

    it('rechaza un recargo negativo o no entero', async () => {
      await expect(
        service.setQuote('order-1', 300, superUser, { surchargeCents: -1 }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.setQuote('order-1', 300, superUser, { surchargeCents: 12.5 }),
      ).rejects.toThrow(BadRequestException);
      expect(ordersRepo.update).not.toHaveBeenCalled();
    });

    it('sin recargo se comporta exactamente como antes (recargo 0)', async () => {
      const order = quotableOrder();
      ordersRepo.findOne
        .mockResolvedValueOnce(order)
        .mockResolvedValueOnce({ ...order });
      subscriptionService.isActiveSubscriber.mockResolvedValue(false);
      ordersRepo.update.mockResolvedValue({ affected: 1 } as never);

      await service.setQuote('order-1', 300, superUser);

      const call = ordersRepo.update.mock.calls[0][1] as Record<
        string,
        unknown
      >;
      expect(call.deliverySurcharge).toBe('0.00');
      // 1000 + 300 = 1300 gravable → round(1300 * 0.08887) = 116
      expect(call.tax).toBe('1.16');
      expect(call.totalAmount).toBe('14.16');
    });
  });

  // -------------------------------------------------------------------------
  // setScheduledDeliveryDate — el admin le pone el día al reparto
  //
  // Pedido del dueño (2026-09-14): "que me deje ponerles el día que les toca el
  // delivery" y que el cliente se entere. El día se asigna solo, sin re-cotizar
  // (re-cotizar toca plata y manda la orden a QUOTED).
  // -------------------------------------------------------------------------

  describe('setScheduledDeliveryDate', () => {
    const superUser = fakeUser(UserRole.SUPER_ADMIN_DELIVERY);

    const schedulableOrder = (overrides: Partial<Order> = {}) =>
      fakeOrder({
        status: OrderStatus.QUOTED,
        customerId: 'user-1',
        customer: fakeUser() as never,
        ...overrides,
      });

    it('guarda el día y devuelve el pedido fresco', async () => {
      const order = schedulableOrder();
      const fresh = { ...order, scheduledDeliveryDate: '2026-09-16' };
      ordersRepo.findOne
        .mockResolvedValueOnce(order)
        .mockResolvedValueOnce(fresh);
      ordersRepo.update.mockResolvedValue({ affected: 1 } as never);

      const result = await service.setScheduledDeliveryDate(
        'order-1',
        '2026-09-16',
        superUser,
      );

      expect(ordersRepo.update).toHaveBeenCalledWith('order-1', {
        scheduledDeliveryDate: '2026-09-16',
      });
      expect(result).toBe(fresh);
    });

    it('avisa al cliente cuando el día es nuevo', async () => {
      const order = schedulableOrder({ scheduledDeliveryDate: null });
      const fresh = { ...order, scheduledDeliveryDate: '2026-09-16' };
      ordersRepo.findOne
        .mockResolvedValueOnce(order)
        .mockResolvedValueOnce(fresh);
      ordersRepo.update.mockResolvedValue({ affected: 1 } as never);

      await service.setScheduledDeliveryDate('order-1', '2026-09-16', superUser);

      expect(orderNotifications.notifyScheduledDelivery).toHaveBeenCalledWith(
        fresh,
      );
    });

    it('NO avisa cuando el día es el mismo que ya tenía', async () => {
      // Guardar dos veces la misma fecha (el admin vuelve a tocar Guardar) no
      // puede spamear al cliente con el mismo aviso.
      const order = schedulableOrder({ scheduledDeliveryDate: '2026-09-16' });
      ordersRepo.findOne
        .mockResolvedValueOnce(order)
        .mockResolvedValueOnce(order);
      ordersRepo.update.mockResolvedValue({ affected: 1 } as never);

      await service.setScheduledDeliveryDate('order-1', '2026-09-16', superUser);

      expect(orderNotifications.notifyScheduledDelivery).not.toHaveBeenCalled();
    });

    it('desasignar (null) guarda pero no avisa', async () => {
      const order = schedulableOrder({ scheduledDeliveryDate: '2026-09-16' });
      const fresh = { ...order, scheduledDeliveryDate: null };
      ordersRepo.findOne
        .mockResolvedValueOnce(order)
        .mockResolvedValueOnce(fresh);
      ordersRepo.update.mockResolvedValue({ affected: 1 } as never);

      await service.setScheduledDeliveryDate('order-1', null, superUser);

      expect(ordersRepo.update).toHaveBeenCalledWith('order-1', {
        scheduledDeliveryDate: null,
      });
      expect(orderNotifications.notifyScheduledDelivery).not.toHaveBeenCalled();
    });

    it('no cambia el estado del pedido', async () => {
      // Asignar el día no es cotizar: un pedido CONFIRMED sigue CONFIRMED.
      const order = schedulableOrder({
        status: OrderStatus.CONFIRMED_BY_COLMADO,
      });
      ordersRepo.findOne
        .mockResolvedValueOnce(order)
        .mockResolvedValueOnce(order);
      ordersRepo.update.mockResolvedValue({ affected: 1 } as never);

      await service.setScheduledDeliveryDate('order-1', '2026-09-16', superUser);

      const call = ordersRepo.update.mock.calls[0][1] as Record<
        string,
        unknown
      >;
      expect(call.status).toBeUndefined();
    });

    it.each([OrderStatus.DELIVERED, OrderStatus.CANCELLED])(
      'rechaza un pedido en estado %s',
      async (status) => {
        // Ya se entregó o se canceló: programar el reparto no significa nada y
        // el aviso al cliente sería absurdo.
        ordersRepo.findOne.mockResolvedValue(schedulableOrder({ status }));

        await expect(
          service.setScheduledDeliveryDate('order-1', '2026-09-16', superUser),
        ).rejects.toThrow(BadRequestException);
        expect(ordersRepo.update).not.toHaveBeenCalled();
      },
    );

    it('rechaza a un CLIENT y a un PROMOTER', async () => {
      await expect(
        service.setScheduledDeliveryDate(
          'order-1',
          '2026-09-16',
          fakeUser(UserRole.CLIENT),
        ),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.setScheduledDeliveryDate(
          'order-1',
          '2026-09-16',
          fakeUser(UserRole.PROMOTER),
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(ordersRepo.update).not.toHaveBeenCalled();
    });

    it('un SELLER pasa el guard de rol — lo limita el scope de findOne', async () => {
      ordersRepo.findOne.mockResolvedValue(null);

      await expect(
        service.setScheduledDeliveryDate(
          'order-1',
          '2026-09-16',
          fakeUser(UserRole.SELLER),
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // -------------------------------------------------------------------------
  // setQuote — el día asignado al cotizar también avisa
  // -------------------------------------------------------------------------

  describe('setQuote — aviso del día de entrega', () => {
    const superUser = fakeUser(UserRole.SUPER_ADMIN_DELIVERY);

    const quotable = (overrides: Partial<Order> = {}) =>
      fakeOrder({
        status: OrderStatus.PENDING_QUOTE,
        customerId: 'user-1',
        customer: fakeUser() as never,
        ...overrides,
      });

    it('avisa cuando la cotización estrena día de entrega', async () => {
      const order = quotable({ scheduledDeliveryDate: null });
      const fresh = { ...order, scheduledDeliveryDate: '2026-09-16' };
      ordersRepo.findOne
        .mockResolvedValueOnce(order)
        .mockResolvedValueOnce(fresh);
      subscriptionService.isActiveSubscriber.mockResolvedValue(false);
      ordersRepo.update.mockResolvedValue({ affected: 1 } as never);

      await service.setQuote('order-1', 300, superUser, {
        scheduledDeliveryDate: '2026-09-16',
      });

      expect(orderNotifications.notifyScheduledDelivery).toHaveBeenCalledWith(
        fresh,
      );
    });

    it('NO avisa cuando re-cotiza con el mismo día', async () => {
      const order = quotable({ scheduledDeliveryDate: '2026-09-16' });
      ordersRepo.findOne
        .mockResolvedValueOnce(order)
        .mockResolvedValueOnce(order);
      subscriptionService.isActiveSubscriber.mockResolvedValue(false);
      ordersRepo.update.mockResolvedValue({ affected: 1 } as never);

      await service.setQuote('order-1', 300, superUser, {
        scheduledDeliveryDate: '2026-09-16',
      });

      expect(orderNotifications.notifyScheduledDelivery).not.toHaveBeenCalled();
    });

    it('NO avisa cuando la cotización no toca el día', async () => {
      const order = quotable({ scheduledDeliveryDate: '2026-09-16' });
      ordersRepo.findOne
        .mockResolvedValueOnce(order)
        .mockResolvedValueOnce(order);
      subscriptionService.isActiveSubscriber.mockResolvedValue(false);
      ordersRepo.update.mockResolvedValue({ affected: 1 } as never);

      await service.setQuote('order-1', 300, superUser);

      expect(orderNotifications.notifyScheduledDelivery).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // deleteOrder — admin hard-delete, restricted to CANCELLED orders
  // -------------------------------------------------------------------------

  describe('deleteOrder', () => {
    const superUser = fakeUser(UserRole.SUPER_ADMIN_DELIVERY);

    it('rejects non-admin callers', async () => {
      await expect(
        service.deleteOrder('order-1', fakeUser(UserRole.CLIENT)),
      ).rejects.toThrow(ForbiddenException);
      expect(ordersRepo.delete).not.toHaveBeenCalled();
    });

    it('404 when the order does not exist', async () => {
      ordersRepo.findOne.mockResolvedValue(null);
      await expect(service.deleteOrder('nope', superUser)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('refuses to delete a non-cancelled order (cancellation reverses credit/points/stock first)', async () => {
      ordersRepo.findOne.mockResolvedValue(
        fakeOrder({ status: OrderStatus.QUOTED }),
      );
      await expect(
        service.deleteOrder('order-1', superUser),
      ).rejects.toMatchObject({ response: { code: 'ORDER_NOT_CANCELLED' } });
      expect(ordersRepo.delete).not.toHaveBeenCalled();
    });

    it('deletes a CANCELLED order', async () => {
      ordersRepo.findOne.mockResolvedValue(
        fakeOrder({ status: OrderStatus.CANCELLED }),
      );
      ordersRepo.delete.mockResolvedValue({ affected: 1 } as never);

      await expect(service.deleteOrder('order-1', superUser)).resolves.toEqual({
        deleted: true,
      });
      expect(ordersRepo.delete).toHaveBeenCalledWith('order-1');
    });
  });

  // -------------------------------------------------------------------------
  // getCustomerActivity — admin dashboard: ordered today / inactive 7d / 30d
  // -------------------------------------------------------------------------

  describe('getCustomerActivity', () => {
    const superUser = fakeUser(UserRole.SUPER_ADMIN_DELIVERY);

    it('rejects non-admin callers', async () => {
      await expect(
        service.getCustomerActivity(fakeUser(UserRole.CLIENT)),
      ).rejects.toThrow(ForbiddenException);
      expect(ordersRepo.query).not.toHaveBeenCalled();
    });

    it('returns today / 7d-inactive / 30d-inactive buckets with counts', async () => {
      const today = [
        {
          id: 'u1',
          fullName: 'Ana',
          phone: '+15550001',
          lastOrderAt: new Date(),
        },
      ];
      const inactive7 = [
        {
          id: 'u2',
          fullName: 'Beto',
          phone: '+15550002',
          lastOrderAt: new Date('2026-07-10'),
        },
        { id: 'u3', fullName: 'Caro', phone: null, lastOrderAt: null },
      ];
      const inactive30 = [
        { id: 'u3', fullName: 'Caro', phone: null, lastOrderAt: null },
      ];
      (ordersRepo.query as jest.Mock)
        .mockResolvedValueOnce(today)
        .mockResolvedValueOnce(inactive7)
        .mockResolvedValueOnce(inactive30);

      const result = await service.getCustomerActivity(superUser);

      expect(result.orderedToday.count).toBe(1);
      expect(result.orderedToday.customers).toEqual(today);
      expect(result.inactive7d.count).toBe(2);
      expect(result.inactive30d.count).toBe(1);
      // Inactivity windows parametrized: 7 then 30 days.
      const calls = (ordersRepo.query as jest.Mock).mock.calls;
      expect(calls[1][1]).toEqual([7]);
      expect(calls[2][1]).toEqual([30]);
    });
  });

  // -------------------------------------------------------------------------
  // Propina (tip) — digital-only, % of product subtotal, untaxed, after tax
  // -------------------------------------------------------------------------

  describe('propina (tip)', () => {
    const baseDto = {
      items: [{ productId: 'prod-1', quantity: 1 }],
      deliveryAddress: { text: '123 Test', lat: 18.4861, lng: -69.9312 },
      usePoints: false,
      useCredit: false,
    };

    // Runs create() with the TX mocked, capturing what orderRepo.create gets.
    const runCreate = async (
      dto: import('./dto/create-order.dto').CreateOrderDto,
    ): Promise<Partial<Order>> => {
      let captured: Partial<Order> | undefined;
      (dataSource.transaction as jest.Mock).mockImplementation(
        async (cb: (mgr: EntityManager) => Promise<unknown>) => {
          const orderRepo = makeRepoMock<Order>();
          const itemRepo = makeRepoMock<OrderItem>();
          orderRepo.create.mockImplementation((d) => {
            captured = d as Partial<Order>;
            return { ...d, id: 'order-1' } as Order;
          });
          orderRepo.save.mockImplementation(async (o) => o as Order);
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
      await service.create(fakeUser(UserRole.CLIENT), dto);
      return captured;
    };

    it('digital skip-quote: tip = % of subtotal, added AFTER tax (untaxed)', async () => {
      // subtotal 500 → tip 18% = 90 (la propina NO mira el envío);
      // gravable 500 + 500 de envío fijo = 1000, tax = round(1000*0.08887) = 89
      productsRepo.find.mockResolvedValue([
        fakeProduct({ requiresQuote: false }),
      ]);

      const captured = await runCreate({
        ...baseDto,
        paymentMethod: PaymentMethod.DIGITAL,
        tipPercent: 18,
      });

      expect(captured.tip).toBe('0.90');
      expect(captured.tax).toBe('0.89');
      expect(captured.totalAmount).toBe('11.79'); // 500 + 500 envío + 89 + 90
    });

    it('digital quote-required: tip stored at creation, total = subtotal + tip (tax pending)', async () => {
      // Normal flow: tax=0 until setQuote; tip 15% of 500 = 75
      productsRepo.find.mockResolvedValue([
        fakeProduct({ requiresQuote: true }),
      ]);

      const captured = await runCreate({
        ...baseDto,
        paymentMethod: PaymentMethod.DIGITAL,
        tipPercent: 15,
      });

      expect(captured.tip).toBe('0.75');
      expect(captured.totalAmount).toBe('10.75'); // 500 + 500 envío + 75
      expect(captured.status).toBe(OrderStatus.PENDING_QUOTE);
    });

    it('rejects tipPercent on a CASH order (digital-only) before touching the DB', async () => {
      await expect(
        service.create(fakeUser(UserRole.CLIENT), {
          ...baseDto,
          paymentMethod: PaymentMethod.CASH,
          tipPercent: 15,
        }),
      ).rejects.toMatchObject({ response: { code: 'TIP_DIGITAL_ONLY' } });

      expect(productsRepo.find).not.toHaveBeenCalled();
    });

    it('no tipPercent → tip 0.00 and total unchanged', async () => {
      productsRepo.find.mockResolvedValue([
        fakeProduct({ requiresQuote: false }),
      ]);

      const captured = await runCreate({
        ...baseDto,
        paymentMethod: PaymentMethod.DIGITAL,
      });

      expect(captured.tip).toBe('0.00');
      expect(captured.totalAmount).toBe('10.89'); // 500 + 500 envío + 89 tax
    });

    it('setQuote preserves the stored tip in the recomputed total (untaxed)', async () => {
      const superUser = fakeUser(UserRole.SUPER_ADMIN_DELIVERY);
      const order = fakeOrder({
        status: OrderStatus.PENDING_QUOTE,
        customerId: 'user-1',
        customer: fakeUser() as never,
        subtotal: '10.00',
        pointsRedeemed: '0.00',
        tip: '0.90',
        paymentMethod: PaymentMethod.DIGITAL,
      });
      ordersRepo.findOne
        .mockResolvedValueOnce(order)
        .mockResolvedValueOnce({ ...order, shipping: '3.00' });
      subscriptionService.isActiveSubscriber.mockResolvedValue(false);
      ordersRepo.update.mockResolvedValue({ affected: 1 } as never);

      await service.setQuote('order-1', 300, superUser);

      // taxable = 1000 + 300 = 1300; tax = round(1300*0.08887) = 116
      // total = 1300 + 116 + 90 tip = 1506
      expect(ordersRepo.update).toHaveBeenCalledWith(
        'order-1',
        expect.objectContaining({ tax: '1.16', totalAmount: '15.06' }),
      );
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
  function setupMixedCartCreateTx(
    products: Product[],
    savedOrderOverride: Partial<Order> = {},
  ) {
    const savedOrder = fakeOrder({ ...savedOrderOverride });
    const orderWithRelations = fakeOrder({
      customer: fakeUser() as never,
      items: products.map((p) => ({
        productId: p.id,
        quantity: 1,
        priceAtOrder:
          p.pricingMode === 'rental'
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
        orderRepo.create.mockImplementation(
          (d) => ({ ...d, id: 'order-1' }) as Order,
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
      priceToPublic: '5.00', // 500 cents
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
      const txCallback = (dataSource.transaction as jest.Mock).mock
        .calls[0][0] as (mgr: EntityManager) => Promise<unknown>;
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

      const txCallback = (dataSource.transaction as jest.Mock).mock
        .calls[0][0] as (mgr: EntityManager) => Promise<unknown>;
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

    it('la primera dirección auto-guardada lleva el ZIP de la chincheta y su zona resuelta', async () => {
      // En la web el cliente NO carga direcciones: el admin fija la chincheta
      // en el primer pedido y esa se vuelve su dirección principal. Si acá no
      // viajara el ZIP, la libreta del cliente quedaría sin código postal ni
      // zona aunque el admin lo haya escrito.
      ordersRepo.findOne.mockResolvedValue(fakeOrder({ customerId: 'cust-9' }));
      ordersRepo.update.mockResolvedValue({ affected: 1 } as never);
      userAddressesRepo.count.mockResolvedValue(0);
      userAddressesRepo.save.mockResolvedValue({} as never);
      deliveryZonesRepo.find.mockResolvedValue([
        { id: 'zone-bronx', zipPrefixes: ['104'], isActive: true },
        { id: 'zone-bk', zipPrefixes: ['112'], isActive: true },
      ] as DeliveryZone[]);

      await service.setDeliveryAddress(
        'order-1',
        { ...address, postalCode: '10451' },
        admin,
      );

      expect(deliveryZonesRepo.find).toHaveBeenCalledWith({
        where: { isActive: true },
      });
      expect(userAddressesRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ postalCode: '10451', zoneId: 'zone-bronx' }),
      );
    });

    it('sin ZIP en la chincheta la dirección auto-guardada queda sin ZIP ni zona y no consulta zonas', async () => {
      ordersRepo.findOne.mockResolvedValue(fakeOrder({ customerId: 'cust-9' }));
      ordersRepo.update.mockResolvedValue({ affected: 1 } as never);
      userAddressesRepo.count.mockResolvedValue(0);
      userAddressesRepo.save.mockResolvedValue({} as never);

      await service.setDeliveryAddress('order-1', address, admin);

      expect(deliveryZonesRepo.find).not.toHaveBeenCalled();
      expect(userAddressesRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ postalCode: null, zoneId: null }),
      );
    });

    it('guarda el código postal de la chincheta en el snapshot de la orden', async () => {
      // La chincheta del admin es la otra puerta por la que entra una
      // dirección: si no copiara el ZIP, la orden quedaría sin él aunque el
      // admin lo haya escrito.
      ordersRepo.findOne.mockResolvedValue(fakeOrder({ customerId: 'cust-9' }));
      ordersRepo.update.mockResolvedValue({ affected: 1 } as never);
      userAddressesRepo.count.mockResolvedValue(3);

      await service.setDeliveryAddress(
        'order-1',
        { ...address, postalCode: '11201' },
        admin,
      );

      expect(ordersRepo.update).toHaveBeenCalledWith(
        'order-1',
        expect.objectContaining({
          deliveryAddress: expect.objectContaining({ postalCode: '11201' }),
        }),
      );
    });

    it('sin código postal en la chincheta el snapshot lo guarda en null', async () => {
      ordersRepo.findOne.mockResolvedValue(fakeOrder({ customerId: 'cust-9' }));
      ordersRepo.update.mockResolvedValue({ affected: 1 } as never);
      userAddressesRepo.count.mockResolvedValue(3);

      await service.setDeliveryAddress('order-1', address, admin);

      expect(ordersRepo.update).toHaveBeenCalledWith(
        'order-1',
        expect.objectContaining({
          deliveryAddress: expect.objectContaining({ postalCode: null }),
        }),
      );
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
        postalCode: '10451',
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

      // El ZIP viaja al snapshot de la orden: el admin lo ve en la ruta sin
      // tener que abrir la libreta de direcciones del cliente.
      expect(capturedAddress).toEqual({
        text: 'Calle Duarte 100, Apto 3B',
        lat: 18.47,
        lng: -69.9,
        building: 'Torre B',
        houseNumber: null,
        unit: null,
        reference: 'frente al colmado',
        postalCode: '10451',
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
        product: fakeRentalProduct({
          id: 'prod-dispenser',
          pricingMode: 'rental',
        }),
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
      subscriptionService.getOrCreateStripeCustomer.mockResolvedValue(
        'cus_test_123',
      );

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
        product: fakeProduct({
          id: 'prod-water',
          pricingMode: 'single_payment',
        }),
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
      expect(rentalsService.findActiveByUserAndProduct).toHaveBeenCalledWith(
        'user-1',
        'prod-dispenser',
      );
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
      });

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
      const orderWithRelations = fakeOrder({
        id: 'order-created-1',
        customer: fakeUser() as never,
        items: [],
      });

      let capturedTx: EntityManager | undefined;

      (dataSource.transaction as jest.Mock).mockImplementation(
        async (cb: (mgr: EntityManager) => Promise<unknown>) => {
          const orderRepo = makeRepoMock<Order>();
          const itemRepo = makeRepoMock<OrderItem>();
          orderRepo.create.mockImplementation(
            (d) => ({ ...d, id: 'order-created-1' }) as Order,
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
      });

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
        fakeOrder({
          id: 'order-bebedero-1',
          customer: fakeUser() as never,
          items: [],
        }),
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

      expect(rentalsService.ensureBebederoRatePrices).toHaveBeenCalledWith(
        1299,
      );
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
  // Precio de suscriptor por producto — gana sobre la oferta, nunca se acumula
  // ─────────────────────────────────────────────────────────────────────────

  describe('create — per-product subscriber price', () => {
    // $5.00 catalog, $3.50 for subscribers. A plain single_payment product:
    // no bebedero, no maintenance service.
    const water = fakeProduct({
      id: 'prod-water',
      priceToPublic: '5.00',
      subscriberPriceCents: 350,
    });

    const waterCart = {
      items: [{ productId: 'prod-water', quantity: 2 }],
      deliveryAddress: { text: '123 Test', lat: 18.4861, lng: -69.9312 },
      paymentMethod: PaymentMethod.CASH,
      usePoints: false,
      useCredit: false,
    } as import('./dto/create-order.dto').CreateOrderDto;

    let savedOrderArg: Partial<Order> | undefined;
    let savedItems: Partial<OrderItem>[] = [];

    function setupTx() {
      savedOrderArg = undefined;
      savedItems = [];
      (dataSource.transaction as jest.Mock).mockImplementation(
        async (cb: (mgr: EntityManager) => Promise<unknown>) => {
          const orderRepo = makeRepoMock<Order>();
          const itemRepo = makeRepoMock<OrderItem>();
          orderRepo.create.mockImplementation((d) => {
            savedOrderArg = d as Partial<Order>;
            return { ...d, id: 'order-water-1' } as Order;
          });
          orderRepo.save.mockResolvedValue(fakeOrder({ id: 'order-water-1' }));
          orderRepo.update.mockResolvedValue({ affected: 1 } as never);
          // create() is called once per line item, not with an array.
          itemRepo.create.mockImplementation((d) => {
            savedItems.push(d as Partial<OrderItem>);
            return d as OrderItem;
          });
          itemRepo.save.mockResolvedValue({} as never);
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
          id: 'order-water-1',
          customer: fakeUser() as never,
          items: [],
        }),
      );
    }

    it('active subscriber pays the subscriber price', async () => {
      productsRepo.find.mockResolvedValue([water]);
      subscriptionService.isActiveSubscriber.mockResolvedValue(true);
      setupTx();

      await service.create(fakeUser(UserRole.CLIENT), waterCart);

      // 350 × 2 = 700
      expect(savedOrderArg?.subtotal).toBe('7.00');
      expect(savedItems[0]?.priceAtOrder).toBe('3.50');
    });

    it('non-subscriber pays the catalog price', async () => {
      productsRepo.find.mockResolvedValue([water]);
      subscriptionService.isActiveSubscriber.mockResolvedValue(false);
      setupTx();

      await service.create(fakeUser(UserRole.CLIENT), waterCart);

      expect(savedOrderArg?.subtotal).toBe('10.00');
      expect(savedItems[0]?.priceAtOrder).toBe('5.00');
    });

    it('subscriber price beats a weaker offer — never stacked', async () => {
      productsRepo.find.mockResolvedValue([
        fakeProduct({
          id: 'prod-water',
          priceToPublic: '5.00',
          subscriberPriceCents: 350,
          offerDiscountPct: '20', // $4.00 — the $3.50 subscriber price is lower
        }),
      ]);
      subscriptionService.isActiveSubscriber.mockResolvedValue(true);
      setupTx();

      await service.create(fakeUser(UserRole.CLIENT), waterCart);

      // 350 × 2 = 700, not 400 × 2
      expect(savedOrderArg?.subtotal).toBe('7.00');
    });

    it('a CHEAPER offer wins — a subscriber never pays more than the public', async () => {
      productsRepo.find.mockResolvedValue([
        fakeProduct({
          id: 'prod-water',
          priceToPublic: '5.00',
          subscriberPriceCents: 350,
          offerDiscountPct: '50', // $2.50 — below the subscriber price
        }),
      ]);
      subscriptionService.isActiveSubscriber.mockResolvedValue(true);
      setupTx();

      await service.create(fakeUser(UserRole.CLIENT), waterCart);

      // 250 × 2 = 500. The subscriber price is a floor, not a fixed price.
      expect(savedOrderArg?.subtotal).toBe('5.00');
      expect(savedItems[0]?.priceAtOrder).toBe('2.50');
    });

    it('a subscriber-priced item ALONE still triggers the subscription check', async () => {
      // Regression guard: the subscription query used to run only for bebedero
      // or maintenance carts. A subscriber buying nothing but water would have
      // silently fallen back to the catalog price.
      productsRepo.find.mockResolvedValue([water]);
      subscriptionService.isActiveSubscriber.mockResolvedValue(true);
      setupTx();

      await service.create(fakeUser(UserRole.CLIENT), waterCart);

      expect(subscriptionService.isActiveSubscriber).toHaveBeenCalledWith(
        'user-1',
      );
    });

    it('consulta la suscripción aunque ningún ítem tenga precio de suscriptor', async () => {
      // La consulta ya no se puede diferir a los carritos "de suscriptor":
      // `wasSubscriberAtQuote` se guarda en toda orden, así que corre
      // siempre, una sola vez.
      productsRepo.find.mockResolvedValue([
        fakeProduct({ id: 'prod-water', subscriberPriceCents: null }),
      ]);
      setupTx();

      await service.create(fakeUser(UserRole.CLIENT), waterCart);

      expect(subscriptionService.isActiveSubscriber).toHaveBeenCalledWith(
        'user-1',
      );
    });

    // ───────────────────────────────────────────────────────────────────────
    // Categoría fiscal — el agua exenta no paga impuesto
    // ───────────────────────────────────────────────────────────────────────

    it('a skip-quote order of EXEMPT items owes no tax', async () => {
      productsRepo.find.mockResolvedValue([
        fakeProduct({
          id: 'prod-water',
          priceToPublic: '5.00',
          subscriberPriceCents: null,
          requiresQuote: false, // skipQuote → el impuesto se calcula ya
          taxCategory: 'exempt',
        }),
      ]);
      setupTx();

      await service.create(fakeUser(UserRole.CLIENT), waterCart);

      expect(savedOrderArg?.subtotal).toBe('10.00');
      expect(savedOrderArg?.tax).toBe('0.00');
      expect(savedOrderArg?.taxableSubtotal).toBe('0.00');
      // El envío fijo se cobra igual, pero no conjura base gravable.
      expect(savedOrderArg?.shipping).toBe('5.00');
      expect(savedOrderArg?.totalAmount).toBe('15.00');
    });

    it('a skip-quote order of STANDARD items is taxed on goods + shipping', async () => {
      productsRepo.find.mockResolvedValue([
        fakeProduct({
          id: 'prod-water',
          priceToPublic: '5.00',
          subscriberPriceCents: null,
          requiresQuote: false,
          taxCategory: 'standard',
        }),
      ]);
      setupTx();

      await service.create(fakeUser(UserRole.CLIENT), waterCart);

      // 1000 + 500 de envío = 1500 gravable → round(1500 * 0.08887) = 133
      expect(savedOrderArg?.tax).toBe('1.33');
      expect(savedOrderArg?.taxableSubtotal).toBe('15.00');
      expect(savedOrderArg?.totalAmount).toBe('16.33');
    });

    it('a MIXED skip-quote order taxes only the standard half', async () => {
      productsRepo.find.mockResolvedValue([
        fakeProduct({
          id: 'prod-water',
          priceToPublic: '5.00',
          subscriberPriceCents: null,
          requiresQuote: false,
          taxCategory: 'exempt',
        }),
        fakeProduct({
          id: 'prod-soda',
          priceToPublic: '3.00',
          subscriberPriceCents: null,
          requiresQuote: false,
          taxCategory: 'standard',
        }),
      ]);
      setupTx();

      await service.create(fakeUser(UserRole.CLIENT), {
        ...waterCart,
        items: [
          { productId: 'prod-water', quantity: 2 }, // $10 exento
          { productId: 'prod-soda', quantity: 1 }, // $3 gravado
        ],
      });

      expect(savedOrderArg?.subtotal).toBe('13.00');
      // Solo la mitad gravada paga, y el envío se prorratea por esa parte:
      // 300/1300 × 500 = 115 → base 415 → round(415 * 0.08887) = 37
      expect(savedOrderArg?.tax).toBe('0.37');
      expect(savedOrderArg?.taxableSubtotal).toBe('4.15');
      expect(savedOrderArg?.totalAmount).toBe('18.37');
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
        .mockResolvedValueOnce({
          ...deliveredOrder,
          status: OrderStatus.DELIVERED,
        });

      paymentsService.captureIntent.mockResolvedValue({} as never);

      rentalsService.activateRentalsForOrder.mockResolvedValue([]);

      (dataSource.transaction as jest.Mock).mockImplementation(
        async (cb: (mgr: EntityManager) => Promise<unknown>) => {
          const orderRepo = makeRepoMock<Order>();
          orderRepo.findOne.mockResolvedValue({
            ...deliveredOrder,
            id: 'order-1',
          });
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
      expect(rentalsService.activateRentalsForOrder).toHaveBeenCalledWith(
        'order-1',
      );
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
        .mockResolvedValueOnce({
          ...deliveredOrder,
          status: OrderStatus.DELIVERED,
        });

      paymentsService.captureIntent.mockResolvedValue({} as never);

      // activateRentalsForOrder throws — should NOT propagate
      rentalsService.activateRentalsForOrder.mockRejectedValue(
        new Error('Stripe failed'),
      );

      (dataSource.transaction as jest.Mock).mockImplementation(
        async (cb: (mgr: EntityManager) => Promise<unknown>) => {
          const orderRepo = makeRepoMock<Order>();
          orderRepo.findOne.mockResolvedValue({
            ...deliveredOrder,
            id: 'order-1',
          });
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
        .mockResolvedValueOnce({
          ...pendingOrder,
          status: OrderStatus.CONFIRMED_BY_COLMADO,
        });

      const stockUpdates: Record<string, number> = {};

      (dataSource.transaction as jest.Mock).mockImplementation(
        async (cb: (mgr: EntityManager) => Promise<unknown>) => {
          const orderRepo = makeRepoMock<Order>();
          const itemRepo = makeRepoMock<OrderItem>();
          const productRepo = makeRepoMock<Product>();

          orderRepo.findOne.mockResolvedValue({
            ...pendingOrder,
            id: 'order-1',
            status: OrderStatus.PENDING_VALIDATION,
          });
          orderRepo.update.mockResolvedValue({ affected: 1 } as never);
          itemRepo.find.mockResolvedValue([singleItem, rentalItem]);

          // Each product.findOne returns appropriate product
          productRepo.findOne
            .mockResolvedValueOnce(fakeProduct({ id: 'prod-water', stock: 10 }))
            .mockResolvedValueOnce(
              fakeRentalProduct({ id: 'prod-dispenser', stock: 5 }),
            );

          productRepo.update.mockImplementation(
            (id: string, data: Partial<Product>) => {
              if (data.stock !== undefined) {
                stockUpdates[id] = data.stock;
              }
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

      // Both items should have had stock decremented
      expect(stockUpdates['prod-water']).toBe(8); // 10 - 2
      expect(stockUpdates['prod-dispenser']).toBe(4); // 5 - 1
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
        .mockResolvedValueOnce({
          ...pendingOrder,
          status: OrderStatus.CONFIRMED_BY_COLMADO,
        });

      let stockUpdate: number | undefined;

      (dataSource.transaction as jest.Mock).mockImplementation(
        async (cb: (mgr: EntityManager) => Promise<unknown>) => {
          const orderRepo = makeRepoMock<Order>();
          const itemRepo = makeRepoMock<OrderItem>();
          const productRepo = makeRepoMock<Product>();

          orderRepo.findOne.mockResolvedValue({
            ...pendingOrder,
            id: 'order-1',
            status: OrderStatus.PENDING_VALIDATION,
          });
          orderRepo.update.mockResolvedValue({ affected: 1 } as never);
          itemRepo.find.mockResolvedValue([singleItem]);
          productRepo.findOne.mockResolvedValue(
            fakeProduct({ id: 'prod-water', stock: 10 }),
          );
          productRepo.update.mockImplementation(
            (_id: string, data: Partial<Product>) => {
              if (data.stock !== undefined) stockUpdate = data.stock;
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
      const responseBody = thrown.getResponse() as Record<string, unknown>;
      expect(responseBody.code).toBe('MIXED_CART_NOT_ALLOWED');
    });

    // T6.2 — all-rental cart MUST succeed (no error)
    it('T6.2: accepts all-rental cart (no BadRequestException thrown)', async () => {
      const rentalProduct2 = fakeRentalProduct({
        id: 'prod-dispenser-2',
        name: 'Dispenser B',
      });
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
  // creation: envío fijo de $5 (lo paga todo el mundo), tax computed now,
  // status = QUOTED, quotedAt set.
  // If ANY item requires a quote, the whole order stays PENDING_QUOTE.
  // ─────────────────────────────────────────────────────────────────────────

  // ─────────────────────────────────────────────────────────────────────────
  // Tasa de impuesto POR ZONA de reparto.
  //
  // New Jersey cobra 6.625% y NYC 8.875%: con una sola tasa global se le
  // cobraba de más a uno y de menos al otro. La tasa se resuelve al CREAR la
  // orden (es la dirección del cliente en ese momento) y se congela en
  // `orders.tax_rate`, que hasta ahora era una constante decorativa.
  // ─────────────────────────────────────────────────────────────────────────

  describe('create — tasa de impuesto por zona', () => {
    const NJ_RATE = 0.06625;
    const skipProduct = fakeProduct({ id: 'prod-water', requiresQuote: false });

    /** Corre create() y devuelve el objeto que recibió orderRepo.create(). */
    async function captureCreated(
      dto: import('./dto/create-order.dto').CreateOrderDto,
      products: Product[] = [skipProduct],
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
      await service.create(fakeUser(UserRole.CLIENT), dto);
      return captured;
    }

    const dtoWithZip = (postalCode?: string) =>
      ({
        items: [{ productId: 'prod-water', quantity: 1 }],
        deliveryAddress: {
          text: '123 Test',
          lat: 40.66,
          lng: -74.21,
          ...(postalCode ? { postalCode } : {}),
        },
        paymentMethod: PaymentMethod.CASH,
        usePoints: false,
        useCredit: false,
      }) as import('./dto/create-order.dto').CreateOrderDto;

    it('resuelve la tasa con el ZIP del snapshot de la orden', async () => {
      deliveryZonesService.resolveTaxRate.mockResolvedValue({
        zoneId: 'zone-nj',
        taxRate: NJ_RATE,
      });

      await captureCreated(dtoWithZip('07201'));

      expect(deliveryZonesService.resolveTaxRate).toHaveBeenCalledWith(
        expect.objectContaining({ postalCode: '07201' }),
      );
    });

    it('congela la tasa de la zona en la orden y cobra ESA tasa', async () => {
      deliveryZonesService.resolveTaxRate.mockResolvedValue({
        zoneId: 'zone-nj',
        taxRate: NJ_RATE,
      });

      const created = await captureCreated(dtoWithZip('07201'));

      // 5.00 de producto + 5.00 de envío fijo = 1000 gravable
      // → round(1000 * 0.06625) = 66 (con la tasa vieja habrían sido 89).
      expect(created.taxRate).toBe('0.06625');
      expect(created.tax).toBe('0.66');
      expect(created.totalAmount).toBe('10.66');
    });

    it('sin zona congela el fallback histórico — jamás 0', async () => {
      // Una dirección que no cae en ninguna zona sigue pagando lo que pagaba.
      const created = await captureCreated(dtoWithZip('90210'));

      expect(created.taxRate).toBe('0.08887');
      expect(created.tax).toBe('0.89');
      expect(created.totalAmount).toBe('10.89');
    });

    it('sin dirección en el DTO usa la ZONA ya resuelta de la dirección por defecto', async () => {
      // La libreta guarda la zona resuelta: preguntar por id es exacto y no
      // depende de volver a parsear el prefijo del ZIP.
      userAddressesRepo.findOne.mockResolvedValue({
        id: 'a1',
        userId: 'user-1',
        label: 'Casa',
        line1: 'Calle 1',
        line2: null,
        building: null,
        lat: 40.66,
        lng: -74.21,
        instructions: null,
        postalCode: '07201',
        zoneId: 'zone-nj',
        isDefault: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as UserAddress);
      deliveryZonesService.resolveTaxRate.mockResolvedValue({
        zoneId: 'zone-nj',
        taxRate: NJ_RATE,
      });

      const created = await captureCreated({
        items: [{ productId: 'prod-water', quantity: 1 }],
        paymentMethod: PaymentMethod.CASH,
        usePoints: false,
        useCredit: false,
      } as import('./dto/create-order.dto').CreateOrderDto);

      expect(deliveryZonesService.resolveTaxRate).toHaveBeenCalledWith(
        expect.objectContaining({ zoneId: 'zone-nj', postalCode: '07201' }),
      );
      expect(created.taxRate).toBe('0.06625');
    });

    /** Fila de la libreta del cliente, con su zona ya cacheada. */
    const savedAddress = (overrides: Record<string, unknown> = {}) =>
      ({
        id: 'addr-nj',
        userId: 'user-1',
        label: 'Casa',
        line1: 'Calle 1',
        line2: null,
        building: null,
        lat: 40.66,
        lng: -74.21,
        instructions: null,
        postalCode: '07201',
        zoneId: 'zone-nj',
        isDefault: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
      }) as unknown as UserAddress;

    it('la dirección GUARDADA del cliente le gana al ZIP que posteó el cliente', async () => {
      // El ZIP del snapshot lo elige el cliente: no puede ser la única fuente
      // de la plata. Con `deliveryAddressId` la tasa sale de la fila real.
      userAddressesRepo.findOne.mockResolvedValue(savedAddress());
      deliveryZonesService.resolveTaxRate.mockResolvedValue({
        zoneId: 'zone-nj',
        taxRate: NJ_RATE,
      });

      const created = await captureCreated({
        ...dtoWithZip('10451'),
        deliveryAddressId: 'addr-nj',
      } as import('./dto/create-order.dto').CreateOrderDto);

      expect(userAddressesRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'addr-nj', userId: 'user-1' },
      });
      expect(deliveryZonesService.resolveTaxRate).toHaveBeenCalledWith({
        zoneId: 'zone-nj',
        postalCode: '07201',
      });
      expect(created.taxRate).toBe('0.06625');
    });

    it('un id que no es del cliente (o ya no existe) cae al ZIP posteado', async () => {
      // Ownership: `findOne` filtra por userId, así que el id de otro no
      // aparece. No se rompe el pedido — se cobra como antes de que el campo
      // existiera.
      userAddressesRepo.findOne.mockResolvedValue(null);

      await captureCreated({
        ...dtoWithZip('10451'),
        deliveryAddressId: 'addr-de-otro',
      } as import('./dto/create-order.dto').CreateOrderDto);

      expect(deliveryZonesService.resolveTaxRate).toHaveBeenCalledWith({
        zoneId: null,
        postalCode: '10451',
      });
    });

    it('sin id se usa el ZIP posteado — mobile <= 1.0.8 sigue en la calle', async () => {
      await captureCreated(dtoWithZip('10451'));

      expect(userAddressesRepo.findOne).not.toHaveBeenCalled();
      expect(deliveryZonesService.resolveTaxRate).toHaveBeenCalledWith({
        zoneId: null,
        postalCode: '10451',
      });
    });

    it('con id y sin snapshot, la dirección guardada también arma el snapshot', async () => {
      // La fila NO es la default: si el id no se mirara, la orden saldría sin
      // dirección y con el fallback.
      const row = savedAddress({ isDefault: false });
      userAddressesRepo.findOne.mockImplementation(
        (opts?: { where?: { id?: string } }) =>
          Promise.resolve(opts?.where?.id === 'addr-nj' ? row : null),
      );
      deliveryZonesService.resolveTaxRate.mockResolvedValue({
        zoneId: 'zone-nj',
        taxRate: NJ_RATE,
      });

      const created = await captureCreated({
        items: [{ productId: 'prod-water', quantity: 1 }],
        deliveryAddressId: 'addr-nj',
        paymentMethod: PaymentMethod.CASH,
        usePoints: false,
        useCredit: false,
      } as import('./dto/create-order.dto').CreateOrderDto);

      expect(created.deliveryAddress).toEqual(
        expect.objectContaining({ postalCode: '07201' }),
      );
      expect(created.taxRate).toBe('0.06625');
    });

    it('una orden sin cotizar congela la tasa igual (el impuesto llega en setQuote)', async () => {
      // El impuesto de una PENDING_QUOTE es 0 hasta que el admin cotice, pero
      // la TASA ya quedó fijada por la dirección a la que se pidió.
      deliveryZonesService.resolveTaxRate.mockResolvedValue({
        zoneId: 'zone-nj',
        taxRate: NJ_RATE,
      });

      const created = await captureCreated(dtoWithZip('07201'), [
        fakeProduct({ id: 'prod-water', requiresQuote: true }),
      ]);

      expect(created.status).toBe(OrderStatus.PENDING_QUOTE);
      expect(created.tax).toBe('0.00');
      expect(created.taxRate).toBe('0.06625');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Re-cotizar mientras el pedido TODAVÍA se puede re-cotizar.
  //
  // El flujo real del negocio es: el cliente pide (muchas veces sin dirección)
  // → el admin pincha la dirección → el admin cotiza → el cliente autoriza. Si
  // la tasa se congelara para siempre al crear el pedido, todo NJ pagaría el
  // fallback de 8.887%. Se re-resuelve hasta que el pedido deja de ser
  // repreciable: `stripePaymentIntentId` (ya hay una retención) o un estado
  // posterior a QUOTED (el efectivo nunca tiene intent, ahí decide el estado).
  // ─────────────────────────────────────────────────────────────────────────

  describe('setQuote — re-resuelve la zona hasta que el pedido se autoriza', () => {
    const superUser = fakeUser(UserRole.SUPER_ADMIN_DELIVERY);
    const NJ_RATE = 0.06625;

    beforeEach(() => {
      subscriptionService.isActiveSubscriber.mockResolvedValue(false);
      ordersRepo.update.mockResolvedValue({ affected: 1 } as never);
    });

    const quote = async (overrides: Partial<Order>) => {
      ordersRepo.findOne.mockResolvedValue(
        fakeOrder({
          status: OrderStatus.PENDING_QUOTE,
          subtotal: '10.00',
          items: [],
          deliveryAddress: { text: '123 Test St', postalCode: '07201' },
          ...overrides,
        }),
      );
      await service.setQuote('order-1', 300, superUser);
      return ordersRepo.update.mock.calls[0][1] as Record<string, unknown>;
    };

    it('re-resuelve por el ZIP del pedido y GUARDA la tasa nueva', async () => {
      // El pedido nació sin dirección (fallback congelado); el admin la pinchó
      // y recién ahora se sabe que es New Jersey.
      deliveryZonesService.resolveTaxRate.mockResolvedValue({
        zoneId: 'zone-nj',
        taxRate: NJ_RATE,
      });

      const updateCall = await quote({ taxRate: '0.08887' });

      expect(deliveryZonesService.resolveTaxRate).toHaveBeenCalledWith({
        zoneId: null,
        postalCode: '07201',
      });
      // 1000 + 300 = 1300 gravable → round(1300 * 0.06625) = 86
      // (con el fallback habrían sido 116: el cliente de NJ pagaría de más).
      expect(updateCall.taxRate).toBe('0.06625');
      expect(updateCall.tax).toBe('0.86');
      expect(updateCall.totalAmount).toBe('13.86');
    });

    it('NO vuelve a resolver la zona cuando el pedido YA fue autorizado', async () => {
      // Con retención de tarjeta ya tomada, re-resolver re-cotizaría una venta
      // que el cliente ya aceptó y pagó. Manda la tasa congelada.
      const updateCall = await quote({
        status: OrderStatus.QUOTED,
        taxRate: '0.06625',
        stripePaymentIntentId: 'pi_live_1',
      });

      expect(deliveryZonesService.resolveTaxRate).not.toHaveBeenCalled();
      expect(updateCall.taxRate).toBeUndefined();
      expect(updateCall.tax).toBe('0.86');
    });

    it('una tasa ilegible en un pedido autorizado cae en el fallback, nunca en 0', async () => {
      const updateCall = await quote({
        status: OrderStatus.QUOTED,
        taxRate: '',
        stripePaymentIntentId: 'pi_live_1',
      });

      // round(1300 * 0.08887) = 116
      expect(updateCall.tax).toBe('1.16');
    });
  });

  describe('setDeliveryAddress — re-precia la tasa mientras se pueda', () => {
    const admin = fakeUser(UserRole.SUPER_ADMIN_DELIVERY);
    const NJ_RATE = 0.06625;
    const njAddress = {
      text: '123 Elizabeth Ave',
      lat: 40.66,
      lng: -74.21,
      postalCode: '07201',
    } as import('./dto/create-order.dto').DeliveryAddressDto;

    beforeEach(() => {
      ordersRepo.update.mockResolvedValue({ affected: 1 } as never);
      userAddressesRepo.count.mockResolvedValue(1);
    });

    const pin = async (overrides: Partial<Order>) => {
      ordersRepo.findOne.mockResolvedValue(
        fakeOrder({ status: OrderStatus.PENDING_QUOTE, ...overrides }),
      );
      await service.setDeliveryAddress('order-1', njAddress, admin);
      return ordersRepo.update.mock.calls[0][1] as Record<string, unknown>;
    };

    it('un pedido sin cotizar toma la tasa de la dirección recién pinchada', async () => {
      // Sin esto el admin cotiza mirando un 8.887% que ya no corresponde.
      deliveryZonesService.resolveTaxRate.mockResolvedValue({
        zoneId: 'zone-nj',
        taxRate: NJ_RATE,
      });

      const updateCall = await pin({ taxRate: '0.08887' });

      expect(deliveryZonesService.resolveTaxRate).toHaveBeenCalledWith(
        expect.objectContaining({ postalCode: '07201' }),
      );
      expect(updateCall.taxRate).toBe('0.06625');
      // Sigue sin impuesto: el impuesto de un PENDING_QUOTE llega en setQuote.
      expect(updateCall.tax).toBeUndefined();
    });

    it('un pedido YA autorizado conserva su tasa congelada', async () => {
      const updateCall = await pin({
        status: OrderStatus.QUOTED,
        taxRate: '0.06625',
        stripePaymentIntentId: 'pi_live_1',
      });

      expect(deliveryZonesService.resolveTaxRate).not.toHaveBeenCalled();
      expect(updateCall.taxRate).toBeUndefined();
    });

    it('un pedido en efectivo ya confirmado conserva su tasa: manda el ESTADO', async () => {
      // El efectivo nunca tiene PaymentIntent, así que el único dato que dice
      // "esta venta ya está cerrada" es el estado.
      const updateCall = await pin({
        status: OrderStatus.CONFIRMED_BY_COLMADO,
        taxRate: '0.06625',
        stripePaymentIntentId: null,
      });

      expect(deliveryZonesService.resolveTaxRate).not.toHaveBeenCalled();
      expect(updateCall.taxRate).toBeUndefined();
    });

    it('un pedido ya cotizado re-precia el IMPUESTO junto con la tasa', async () => {
      // Cambiar `tax_rate` sin recalcular `tax` dejaría la orden diciendo que
      // cobró 6.625% sobre un monto calculado al 8.887%.
      deliveryZonesService.resolveTaxRate.mockResolvedValue({
        zoneId: 'zone-nj',
        taxRate: NJ_RATE,
      });

      const updateCall = await pin({
        status: OrderStatus.QUOTED,
        taxRate: '0.08887',
        subtotal: '10.00',
        shipping: '3.00',
        tax: '1.16',
        totalAmount: '14.16',
        items: [],
      });

      expect(updateCall.taxRate).toBe('0.06625');
      expect(updateCall.tax).toBe('0.86');
      expect(updateCall.totalAmount).toBe('13.86');
    });

    it('pinchar dirección y después cotizar cobra la tasa de la zona nueva', async () => {
      // El camino real completo: pedido sin dirección (fallback congelado) →
      // el admin pincha NJ → el admin cotiza.
      deliveryZonesService.resolveTaxRate.mockResolvedValue({
        zoneId: 'zone-nj',
        taxRate: NJ_RATE,
      });
      subscriptionService.isActiveSubscriber.mockResolvedValue(false);

      const pinned = await pin({ taxRate: '0.08887', deliveryAddress: null });
      expect(pinned.taxRate).toBe('0.06625');

      ordersRepo.update.mockClear();
      ordersRepo.findOne.mockResolvedValue(
        fakeOrder({
          status: OrderStatus.PENDING_QUOTE,
          subtotal: '10.00',
          items: [],
          taxRate: pinned.taxRate as string,
          deliveryAddress: { text: '123 Elizabeth Ave', postalCode: '07201' },
        }),
      );
      await service.setQuote('order-1', 300, admin);
      const quoted = ordersRepo.update.mock.calls[0][1] as Record<
        string,
        unknown
      >;

      expect(quoted.taxRate).toBe('0.06625');
      expect(quoted.tax).toBe('0.86');
    });
  });

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

    it('all-skip cart → order created in QUOTED with the flat $5 shipping and tax computed', async () => {
      const created = await captureCreatedOrder(
        [skipProduct],
        [{ productId: 'prod-water', quantity: 1 }],
      );

      expect(created.status).toBe(OrderStatus.QUOTED);
      expect(created.shipping).toBe('5.00');
      expect(created.subtotal).toBe('5.00');
      // tax = round((500 + 500) * 0.08887) = 89 cents
      expect(created.tax).toBe('0.89');
      expect(created.totalAmount).toBe('10.89');
      expect(created.quotedAt).toBeInstanceOf(Date);
    });

    it('all-skip cart with quantity → tax computed on the full subtotal', async () => {
      const created = await captureCreatedOrder(
        [skipProduct],
        [{ productId: 'prod-water', quantity: 3 }],
      );

      // 3 × 5.00 = 15.00 + 5.00 de envío → round(2000 * 0.08887) = 178 cents
      expect(created.status).toBe(OrderStatus.QUOTED);
      expect(created.subtotal).toBe('15.00');
      expect(created.tax).toBe('1.78');
      expect(created.totalAmount).toBe('21.78');
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
      // El envío fijo ya viaja en la orden: el formulario del admin lo
      // pre-carga y él sólo confirma o ajusta.
      expect(created.shipping).toBe('5.00');
      expect(created.tax).toBe('0.00');
      expect(created.totalAmount).toBe('15.00');
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
    // product's list price. OJO: es la LÍNEA la que sale gratis, no la orden —
    // el viaje se cobra igual desde que el envío dejó de ser un beneficio.
    const maintenanceProduct = fakeProduct({
      id: 'prod-maint',
      name: 'Mantenimiento de Bebedero',
      requiresQuote: false,
      isMaintenanceService: true,
      priceToPublic: '10.00',
    });

    it('active subscriber → maintenance line is free, pero la orden paga el envío ($5)', async () => {
      subscriptionService.isActiveSubscriber.mockResolvedValue(true);

      const created = await captureCreatedOrder(
        [maintenanceProduct],
        [{ productId: 'prod-maint', quantity: 1 }],
      );

      expect(created.status).toBe(OrderStatus.QUOTED);
      expect(created.subtotal).toBe('0.00');
      expect(created.shipping).toBe('5.00');
      // Con subtotal 0 la parte gravable es 0, así que el envío tampoco se
      // grava (computeTaxableBase prorratea por la parte gravable): impuesto 0
      // y el cliente paga sólo el viaje.
      expect(created.taxableSubtotal).toBe('0.00');
      expect(created.tax).toBe('0.00');
      expect(created.totalAmount).toBe('5.00');
      expect(created.wasSubscriberAtQuote).toBe(true);
    });

    it('non-subscriber → maintenance billed at the product list price', async () => {
      subscriptionService.isActiveSubscriber.mockResolvedValue(false);

      const created = await captureCreatedOrder(
        [maintenanceProduct],
        [{ productId: 'prod-maint', quantity: 1 }],
      );

      // 10.00 + 5.00 de envío → tax = round(1500 * 0.08887) = 133 cents
      expect(created.subtotal).toBe('10.00');
      expect(created.shipping).toBe('5.00');
      expect(created.tax).toBe('1.33');
      expect(created.totalAmount).toBe('16.33');
      expect(created.wasSubscriberAtQuote).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Envío fijo — toda orden de cliente paga el viaje al crearse
  //
  // Regla del dueño (2026-09-14): "todos los pedidos salen con un envío de 5
  // dólares" y "los suscriptores tampoco van a tener el envío gratis". La
  // suscripción paga el bebedero, no el viaje. La única orden sin envío es la
  // que provisiona el sistema (`provisioned`), que ningún cliente pidió.
  //
  // Los $5 son sólo el DEFAULT: el mismo día el dueño pidió poder "modificar la
  // tasa general del delivery", así que el monto sale de ShippingRateService
  // (app_settings.flat_shipping_cents). Acá el mock lo deja en 500 salvo donde
  // el test diga otra cosa.
  // ─────────────────────────────────────────────────────────────────────────

  describe('create — envío fijo (tarifa vigente)', () => {
    /** Corre create() y devuelve el objeto que recibió orderRepo.create(). */
    async function captureFlatShippingOrder(
      products: Product[],
      opts: { provisioned?: boolean } = {},
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

      await service.create(
        fakeUser(UserRole.CLIENT),
        {
          items: products.map((p) => ({ productId: p.id, quantity: 1 })),
          deliveryAddress: { text: '123 Test', lat: 18.4861, lng: -69.9312 },
          paymentMethod: PaymentMethod.CASH,
          usePoints: false,
          useCredit: false,
        },
        opts,
      );
      return captured;
    }

    const standardSkipProduct = fakeProduct({
      id: 'prod-std',
      requiresQuote: false,
      taxCategory: 'standard',
      priceToPublic: '10.00',
    });

    it('no suscriptor, skip-cotización → envío $5 gravado junto al producto', async () => {
      subscriptionService.isActiveSubscriber.mockResolvedValue(false);

      const created = await captureFlatShippingOrder([standardSkipProduct]);

      expect(created.shipping).toBe('5.00');
      // base = 1000 + 500 de envío = 1500 → round(1500 * 0.08887) = 133
      expect(created.tax).toBe('1.33');
      expect(created.taxableSubtotal).toBe('15.00');
      expect(created.totalAmount).toBe('16.33');
      expect(created.status).toBe(OrderStatus.QUOTED);
    });

    it('el suscriptor paga el envío fijo igual que cualquiera', async () => {
      // La suscripción le da el bebedero, el precio de suscriptor y el
      // mantenimiento — el viaje no. `wasSubscriberAtQuote` sigue guardándose
      // porque es el dato que explica los PRECIOS congelados en la orden.
      subscriptionService.isActiveSubscriber.mockResolvedValue(true);

      const created = await captureFlatShippingOrder([standardSkipProduct]);

      expect(created.shipping).toBe('5.00');
      // base = 1000 + 500 de envío = 1500 → round(1500 * 0.08887) = 133
      expect(created.tax).toBe('1.33');
      expect(created.totalAmount).toBe('16.33');
      expect(created.wasSubscriberAtQuote).toBe(true);
    });

    it('una orden provisionada por el sistema no paga envío (total $0)', async () => {
      // La excepción: el bebedero gratis y la instalación premium las crea el
      // sistema, no el cliente. Tienen que quedar en $0 porque
      // deliverProvisionedOrder rechaza cualquier otra cosa — con envío el
      // alquiler nunca se activaría.
      subscriptionService.isActiveSubscriber.mockResolvedValue(true);

      const created = await captureFlatShippingOrder(
        [
          fakeProduct({
            id: 'prod-free',
            requiresQuote: false,
            priceToPublic: '0.00',
          }),
        ],
        { provisioned: true },
      );

      expect(created.shipping).toBe('0.00');
      expect(created.tax).toBe('0.00');
      expect(created.totalAmount).toBe('0.00');
    });

    it('usa la tarifa vigente configurada por el admin', async () => {
      // El dueño subió el delivery a $7 desde el panel: la orden que se crea
      // después tiene que nacer con ESE envío, sin deploy de por medio, y con
      // el impuesto y el total recalculados sobre él.
      subscriptionService.isActiveSubscriber.mockResolvedValue(false);
      shippingRateService.getFlatShippingCents.mockResolvedValue(700);

      const created = await captureFlatShippingOrder([standardSkipProduct]);

      expect(created.shipping).toBe('7.00');
      // base = 1000 + 700 de envío = 1700 → round(1700 * 0.08887) = 151
      expect(created.tax).toBe('1.51');
      expect(created.taxableSubtotal).toBe('17.00');
      expect(created.totalAmount).toBe('18.51');
      // Una sola lectura por pedido: es un lookup por PK, no hace falta caché,
      // pero tampoco hay que pegarle una vez por ítem.
      expect(shippingRateService.getFlatShippingCents).toHaveBeenCalledTimes(1);
    });

    it('la orden provisionada ignora la tarifa vigente y sigue en $0', async () => {
      // Aunque el admin ponga el delivery en $7, el bebedero que provisiona el
      // sistema tiene que nacer en $0: deliverProvisionedOrder no acepta otra
      // cosa y con envío el alquiler nunca se activaría.
      subscriptionService.isActiveSubscriber.mockResolvedValue(true);
      shippingRateService.getFlatShippingCents.mockResolvedValue(700);

      const created = await captureFlatShippingOrder(
        [
          fakeProduct({
            id: 'prod-free',
            requiresQuote: false,
            priceToPublic: '0.00',
          }),
        ],
        { provisioned: true },
      );

      expect(created.shipping).toBe('0.00');
      expect(created.tax).toBe('0.00');
      expect(created.totalAmount).toBe('0.00');
    });

    it('no suscriptor, pendiente de cotización → envío $5 ya cargado, impuesto en setQuote', async () => {
      subscriptionService.isActiveSubscriber.mockResolvedValue(false);

      const created = await captureFlatShippingOrder([
        fakeProduct({
          id: 'prod-quote',
          requiresQuote: true,
          priceToPublic: '10.00',
        }),
      ]);

      expect(created.status).toBe(OrderStatus.PENDING_QUOTE);
      expect(created.shipping).toBe('5.00');
      // El impuesto y la base gravable se congelan recién en setQuote.
      expect(created.tax).toBe('0.00');
      expect(created.taxableSubtotal).toBe('0.00');
      // Total parcial: neto (producto + envío) + propina.
      expect(created.totalAmount).toBe('15.00');
    });

    it('agua exenta → el viaje se cobra pero no conjura impuesto', async () => {
      subscriptionService.isActiveSubscriber.mockResolvedValue(false);

      const created = await captureFlatShippingOrder([
        fakeProduct({
          id: 'prod-water',
          requiresQuote: false,
          taxCategory: 'exempt',
          priceToPublic: '5.00',
        }),
      ]);

      expect(created.shipping).toBe('5.00');
      expect(created.tax).toBe('0.00');
      expect(created.taxableSubtotal).toBe('0.00');
      expect(created.totalAmount).toBe('10.00');
    });

    it('consulta la suscripción aunque el carrito no tenga ítem de suscriptor', async () => {
      // Antes se resolvía perezosamente (solo con mantenimiento / bebedero /
      // precio de suscriptor / premium). Ahora corre siempre: aunque el envío
      // ya no dependa de ella, `wasSubscriberAtQuote` se guarda en TODA orden.
      subscriptionService.isActiveSubscriber.mockResolvedValue(false);

      await captureFlatShippingOrder([
        fakeProduct({ id: 'prod-plain', requiresQuote: true }),
      ]);

      expect(subscriptionService.isActiveSubscriber).toHaveBeenCalledWith(
        'user-1',
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // findAll / findOne — scope + not-found branches
  // ─────────────────────────────────────────────────────────────────────────

  describe('findAll — orden de despacho para el staff', () => {
    const ORIGIN = { lat: 40, lng: -74 };
    // 1 grado de latitud ≈ 69.09 millas.
    const nearOrder = fakeOrder({
      id: 'near',
      status: OrderStatus.QUOTED,
      deliveryAddress: { text: 'cerca', lat: 40.01, lng: -74 },
      createdAt: new Date('2026-09-10T10:00:00Z'),
    });
    const farOrder = fakeOrder({
      id: 'far',
      status: OrderStatus.QUOTED,
      deliveryAddress: { text: 'lejos', lat: 40.2, lng: -74 },
      createdAt: new Date('2026-09-14T10:00:00Z'),
    });

    it('super admin → pide el origen del repartidor y ordena por distancia', async () => {
      // El dueño reportaba la lista "por más reciente": el pedido nuevo y lejos
      // salía antes que el viejo de la otra cuadra.
      ordersRepo.find.mockResolvedValue([farOrder, nearOrder]);
      (shippingService.getOrigin as jest.Mock).mockResolvedValue(ORIGIN);

      const result = await service.findAll(
        fakeUser(UserRole.SUPER_ADMIN_DELIVERY),
      );

      expect(shippingService.getOrigin).toHaveBeenCalled();
      expect(result.map((o) => o.id)).toEqual(['near', 'far']);
      expect(result[0].distanceMiles).toBe(0.7);
      expect(result[1].distanceMiles).toBe(13.8);
    });

    it('vendedor → misma ruta ordenada, dentro de su cartera', async () => {
      ordersRepo.find.mockResolvedValue([farOrder, nearOrder]);
      (shippingService.getOrigin as jest.Mock).mockResolvedValue(ORIGIN);

      const result = await service.findAll(fakeUser(UserRole.SELLER));

      expect(shippingService.getOrigin).toHaveBeenCalled();
      expect(result.map((o) => o.id)).toEqual(['near', 'far']);
    });

    it('cliente → la lista queda como vino y no se consulta el origen', async () => {
      // El cliente ve SUS pedidos: la distancia al depósito no le dice nada y
      // pedir el origen sería una consulta de más en cada apertura de la app.
      ordersRepo.find.mockResolvedValue([farOrder, nearOrder]);

      const result = await service.findAll(fakeUser(UserRole.CLIENT));

      expect(shippingService.getOrigin).not.toHaveBeenCalled();
      expect(result.map((o) => o.id)).toEqual(['far', 'near']);
      expect(result[0].distanceMiles).toBeUndefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Bebedero Premium — 1 incluido, adicional al precio del plan, sino +$5
  // ─────────────────────────────────────────────────────────────────────────

  describe('create — premium bebedero pricing', () => {
    const premiumBebedero = fakeRentalProduct({
      id: 'prod-premium-beb',
      name: 'Bebedero Premium',
      requiresMaintenance: true,
      isPremiumSubscriberProduct: true,
      monthlyRentCents: 3499, // fallback de catálogo
      requiresQuote: false,
    });

    const premiumCart = {
      items: [{ productId: 'prod-premium-beb', quantity: 1 }],
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
            return { ...d, id: 'order-premium-1' } as Order;
          });
          orderRepo.save.mockResolvedValue(
            fakeOrder({ id: 'order-premium-1' }),
          );
          orderRepo.update.mockResolvedValue({ affected: 1 } as never);
          itemRepo.create.mockImplementation((d) => d as OrderItem);
          itemRepo.save.mockResolvedValue({} as never);
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
          id: 'order-premium-1',
          customer: fakeUser() as never,
          items: [],
        }),
      );
    }

    beforeEach(() => {
      productsRepo.find.mockResolvedValue([premiumBebedero]);
      subscriptionService.getPlanNetCents.mockResolvedValue(2999); // plan premium
      setupTx();
    });

    it('suscriptor premium, primera unidad → orden de $0 AUNQUE ya tenga el bebedero estándar', async () => {
      // El caso de la instalación automática. Antes del carve-out, el premium
      // caía en la regla estándar: con un bebedero previo el ordinal daba ≥1 y
      // la orden salía al precio del plan común — no $0 — y
      // deliverProvisionedOrder la rechazaba: instalación trabada para siempre.
      //
      // Va con `provisioned: true` porque es exactamente como la crea
      // premium-product.listener: sin envío, si no el total sería $5 y
      // deliverProvisionedOrder la rechazaría por el otro lado.
      subscriptionService.getActiveTier.mockResolvedValue(
        SubscriptionTier.PREMIUM,
      );
      rentalsService.countBebederoRentalsForUser.mockResolvedValue(1); // ya tiene el estándar
      rentalsService.countRentalsForUserAndProduct.mockResolvedValue(0); // primer premium

      await service.create(fakeUser(UserRole.CLIENT), premiumCart, {
        provisioned: true,
      });

      expect(savedOrderArg?.subtotal).toBe('0.00');
      expect(savedOrderArg?.shipping).toBe('0.00');
      expect(savedOrderArg?.totalAmount).toBe('0.00');
      expect(rentalsService.createForOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          productId: 'prod-premium-beb',
          monthlyRentCentsOverride: 0,
          stripePriceIdOverride: 'price_free_existing',
        }),
        expect.anything(),
      );
    });

    it('suscriptor premium, unidad ADICIONAL → al precio de la suscripción premium', async () => {
      subscriptionService.getActiveTier.mockResolvedValue(
        SubscriptionTier.PREMIUM,
      );
      rentalsService.countRentalsForUserAndProduct.mockResolvedValue(1);

      await service.create(fakeUser(UserRole.CLIENT), premiumCart);

      expect(savedOrderArg?.subtotal).toBe('29.99');
      expect(rentalsService.createForOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          monthlyRentCentsOverride: 2999,
          stripePriceIdOverride: 'price_premium_rate',
        }),
        expect.anything(),
      );
    });

    it('un suscriptor ESTÁNDAR no se lo lleva gratis: paga suscripción + $5', async () => {
      // El carve-out. Sin él, la regla "primer bebedero gratis" del plan común
      // regalaba el producto exclusivo del premium.
      subscriptionService.isActiveSubscriber.mockResolvedValue(true);
      subscriptionService.getActiveTier.mockResolvedValue(
        SubscriptionTier.STANDARD,
      );
      rentalsService.countBebederoRentalsForUser.mockResolvedValue(0);

      await service.create(fakeUser(UserRole.CLIENT), premiumCart);

      expect(savedOrderArg?.subtotal).toBe('34.99');
      expect(rentalsService.createForOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          monthlyRentCentsOverride: 3499,
          stripePriceIdOverride: 'price_premium_catalog',
        }),
        expect.anything(),
      );
    });

    it('sin ninguna suscripción → suscripción + $5', async () => {
      subscriptionService.getActiveTier.mockResolvedValue(null);

      await service.create(fakeUser(UserRole.CLIENT), premiumCart);

      expect(savedOrderArg?.subtotal).toBe('34.99');
    });

    it('sin plan premium configurado → catálogo del producto, sin overrides', async () => {
      subscriptionService.getActiveTier.mockResolvedValue(null);
      subscriptionService.getPlanNetCents.mockResolvedValue(null);

      await service.create(fakeUser(UserRole.CLIENT), premiumCart);

      // Nunca cobra de menos: cae al monthly_rent_cents del producto.
      expect(savedOrderArg?.subtotal).toBe('34.99');
      const call = rentalsService.createForOrder.mock.calls[0][0];
      expect(call.monthlyRentCentsOverride).toBeUndefined();
      expect(
        rentalsService.ensurePremiumBebederoRatePrices,
      ).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // deliverProvisionedOrder — instalaciones provisionadas por el sistema
  // ─────────────────────────────────────────────────────────────────────────

  describe('deliverProvisionedOrder', () => {
    it('RECHAZA una orden con saldo — no es una vía para entregar sin pagar', async () => {
      ordersRepo.findOne.mockResolvedValueOnce(
        fakeOrder({
          status: OrderStatus.CONFIRMED_BY_COLMADO,
          totalAmount: '25.00',
        }),
      );

      await expect(service.deliverProvisionedOrder('order-1')).resolves.toBe(
        false,
      );
      expect(ordersRepo.update).not.toHaveBeenCalled();
    });

    it('no toca una orden que todavía no está confirmada', async () => {
      ordersRepo.findOne.mockResolvedValueOnce(
        fakeOrder({ status: OrderStatus.QUOTED, totalAmount: '0.00' }),
      );

      await expect(service.deliverProvisionedOrder('order-1')).resolves.toBe(
        false,
      );
      expect(ordersRepo.update).not.toHaveBeenCalled();
    });

    it('es idempotente: una orden ya entregada devuelve true sin re-entregar', async () => {
      ordersRepo.findOne.mockResolvedValueOnce(
        fakeOrder({ status: OrderStatus.DELIVERED, totalAmount: '0.00' }),
      );

      await expect(service.deliverProvisionedOrder('order-1')).resolves.toBe(
        true,
      );
      expect(ordersRepo.update).not.toHaveBeenCalled();
    });

    it('una orden inexistente devuelve false sin tirar', async () => {
      ordersRepo.findOne.mockResolvedValueOnce(null);
      await expect(service.deliverProvisionedOrder('nope')).resolves.toBe(
        false,
      );
    });

    it('nunca tira: un error interno se reporta como false', async () => {
      // Es un efecto de fondo — no puede tumbar la activación de una suscripción.
      ordersRepo.findOne.mockRejectedValueOnce(new Error('db caída'));
      await expect(service.deliverProvisionedOrder('order-1')).resolves.toBe(
        false,
      );
    });
  });

  describe('findAll', () => {
    it('SUPER_ADMIN_DELIVERY scope returns all orders (empty where scope)', async () => {
      const list = [fakeOrder(), fakeOrder({ id: 'order-2' })];
      ordersRepo.find.mockResolvedValue(list);

      const result = await service.findAll(
        fakeUser(UserRole.SUPER_ADMIN_DELIVERY),
      );

      // El staff recibe la lista REORDENADA para despacho, así que ya no es el
      // mismo array que devolvió el repo — pero sí los mismos pedidos.
      expect(result.map((o) => o.id).sort()).toEqual(['order-1', 'order-2']);
      const callArg = ordersRepo.find.mock.calls[0][0] as Record<
        string,
        unknown
      >;
      // SUPER_ADMIN_DELIVERY → unrestricted scope ({})
      expect(callArg.where).toEqual({});
    });

    it('CLIENT scope restricts to customerId', async () => {
      ordersRepo.find.mockResolvedValue([]);

      await service.findAll(fakeUser(UserRole.CLIENT));

      const callArg = ordersRepo.find.mock.calls[0][0] as Record<
        string,
        unknown
      >;
      expect(callArg.where).toEqual({ customerId: 'user-1' });
    });

    it('SELLER scope restricts to the customers assigned to them', async () => {
      ordersRepo.find.mockResolvedValue([]);

      await service.findAll(fakeUser(UserRole.SELLER));

      const callArg = ordersRepo.find.mock.calls[0][0] as Record<
        string,
        unknown
      >;
      // Nunca `{}`: un vendedor jamás debe caer en el scope irrestricto.
      expect(callArg.where).toEqual({ customer: { sellerId: 'user-1' } });
      expect(callArg.where).not.toEqual({});
    });
  });

  describe('findOne', () => {
    it('returns the order when found', async () => {
      const order = fakeOrder();
      ordersRepo.findOne.mockResolvedValue(order);

      const result = await service.findOne(
        'order-1',
        fakeUser(UserRole.CLIENT),
      );

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
        }),
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
          orderRepo.create.mockImplementation(
            (d) => ({ ...d, id: 'order-1' }) as Order,
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
      pointsService.getBalance.mockResolvedValue({
        claimableCents: 300,
      } as never);
      pointsService.redeemAllClaimable.mockResolvedValue(undefined);
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
      pointsService.getBalance.mockResolvedValue({
        claimableCents: 0,
      } as never);
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
      });

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
      });

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

    it('throws Forbidden for a PROMOTER', async () => {
      await expect(
        service.setQuote('order-1', 300, fakeUser(UserRole.PROMOTER)),
      ).rejects.toThrow(ForbiddenException);
    });

    it('a SELLER passes the role guard — the scope is what limits them', async () => {
      // El vendedor no queda frenado por el rol; queda frenado por findOne, que
      // aplica buildScope. Acá el pedido no es de su cartera → NotFound.
      ordersRepo.findOne.mockResolvedValue(null);

      await expect(
        service.setQuote('order-1', 300, fakeUser(UserRole.SELLER)),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequest when shippingCents is not an integer', async () => {
      await expect(
        service.setQuote(
          'order-1',
          12.5,
          fakeUser(UserRole.SUPER_ADMIN_DELIVERY),
        ),
      ).rejects.toThrow('shippingCents inválido');
    });

    it('throws BadRequest when shippingCents is negative', async () => {
      await expect(
        service.setQuote(
          'order-1',
          -1,
          fakeUser(UserRole.SUPER_ADMIN_DELIVERY),
        ),
      ).rejects.toThrow('shippingCents inválido');
    });

    it('throws BadRequest when order is in a non-quotable status', async () => {
      const order = fakeOrder({
        status: OrderStatus.DELIVERED,
        customer: fakeUser() as never,
      });
      ordersRepo.findOne.mockResolvedValue(order);

      await expect(
        service.setQuote(
          'order-1',
          300,
          fakeUser(UserRole.SUPER_ADMIN_DELIVERY),
        ),
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

      await service.setQuote(
        'order-1',
        300,
        fakeUser(UserRole.SUPER_ADMIN_DELIVERY),
      );

      const updateCall = ordersRepo.update.mock.calls[0][1] as Record<
        string,
        unknown
      >;
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

      const result = await service.authorize(
        'order-1',
        fakeUser(UserRole.CLIENT),
      );

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

      const result = await service.authorize(
        'order-1',
        fakeUser(UserRole.CLIENT),
      );

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
      expect(paymentsService.createAuthorizationIntent).toHaveBeenCalledTimes(
        1,
      );
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
          creditApplied: null,
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

      const result = await service.authorize(
        'order-1',
        fakeUser(UserRole.CLIENT),
      );

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
    // The driver app has two "advance" buttons (route list + order detail) and
    // runs on mobile data, so the same PATCH lands twice: once for real, once
    // because the response was lost or the screen still showed the old status.
    // A no-op must be a no-op — not a "Transición inválida: X → X" alert, and
    // above all not a second run of the delivery side effects.
    it('is idempotent when the order is already in the requested status', async () => {
      const inRoute = fakeOrder({
        status: OrderStatus.IN_DELIVERY_ROUTE,
        customer: fakeUser() as never,
      });
      ordersRepo.findOne.mockResolvedValue(inRoute);

      const result = await service.updateStatus(
        'order-1',
        { status: OrderStatus.IN_DELIVERY_ROUTE },
        fakeUser(UserRole.SUPER_ADMIN_DELIVERY),
      );

      expect(result).toBe(inRoute);
      expect(ordersRepo.update).not.toHaveBeenCalled();
      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(orderNotifications.notifyStatus).not.toHaveBeenCalled();
    });

    it('does not re-run delivery side effects when DELIVERED is re-sent', async () => {
      const delivered = fakeOrder({
        status: OrderStatus.DELIVERED,
        paymentMethod: PaymentMethod.DIGITAL,
        stripePaymentIntentId: 'pi_test',
        customer: fakeUser() as never,
      });
      ordersRepo.findOne.mockResolvedValue(delivered);

      const result = await service.updateStatus(
        'order-1',
        { status: OrderStatus.DELIVERED },
        fakeUser(UserRole.SUPER_ADMIN_DELIVERY),
      );

      expect(result).toBe(delivered);
      expect(paymentsService.captureIntent).not.toHaveBeenCalled();
      expect(pointsService.creditForOrder).not.toHaveBeenCalled();
      expect(invoicesService.createForOrder).not.toHaveBeenCalled();
      expect(promotersService.creditCommissionsForOrder).not.toHaveBeenCalled();
    });

    it('throws BadRequest for a disallowed status transition', async () => {
      // DELIVERED has no allowed transitions
      ordersRepo.findOne.mockResolvedValue(
        fakeOrder({
          status: OrderStatus.DELIVERED,
          customer: fakeUser() as never,
        }),
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
      ordersRepo.findOne.mockResolvedValueOnce(order).mockResolvedValueOnce(
        fakeOrder({
          status: OrderStatus.CANCELLED,
          customer: fakeUser() as never,
        }),
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
            .mockImplementation(
              (where: { id: string }, _col: string, qty: number) => {
                incrementCalls.push({ id: where.id, qty });
                return Promise.resolve({ affected: 1 });
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
      ordersRepo.findOne.mockResolvedValueOnce(order).mockResolvedValueOnce(
        fakeOrder({
          status: OrderStatus.CANCELLED,
          customer: fakeUser() as never,
        }),
      );

      const incrementSpy = jest.fn();

      (dataSource.transaction as jest.Mock).mockImplementation(
        async (cb: (mgr: EntityManager) => Promise<unknown>) => {
          const orderRepo = makeRepoMock<Order>();
          const productRepo = makeRepoMock<Product>();
          orderRepo.update.mockResolvedValue({ affected: 1 } as never);
          (productRepo as unknown as { increment: jest.Mock }).increment =
            incrementSpy;

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
      ordersRepo.findOne.mockResolvedValueOnce(order).mockResolvedValueOnce({
        ...order,
        status: OrderStatus.DELIVERED,
      });

      (dataSource.transaction as jest.Mock).mockImplementation(
        async (cb: (mgr: EntityManager) => Promise<unknown>) => {
          const orderRepo = makeRepoMock<Order>();
          orderRepo.findOne.mockResolvedValue({
            ...order,
            id: 'order-1',
          });
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
          });
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
      ordersRepo.findOne.mockResolvedValueOnce(order).mockResolvedValueOnce({
        ...order,
        status: OrderStatus.CONFIRMED_BY_COLMADO,
      });

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
          });
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
          });
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
      ordersRepo.findOne.mockResolvedValueOnce(order).mockResolvedValueOnce({
        ...order,
        status: OrderStatus.CONFIRMED_BY_COLMADO,
      });

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
          });
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
      ordersRepo.findOne.mockResolvedValueOnce(order).mockResolvedValueOnce({
        ...order,
        status: OrderStatus.IN_DELIVERY_ROUTE,
      });
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

  // -------------------------------------------------------------------------
  // authorize — self-heal: the hold is already authorized at Stripe but the
  // webhook never reached us. Instead of bouncing the customer against a
  // PaymentSheet that cannot present, advance the order right here.
  // -------------------------------------------------------------------------

  describe('authorize — self-heals an already-authorized intent', () => {
    const digitalQuoted = () =>
      fakeOrder({
        status: OrderStatus.QUOTED,
        paymentMethod: PaymentMethod.DIGITAL,
        stripePaymentIntentId: 'pi_held',
        customerId: 'user-1',
        customer: fakeUser() as never,
      });

    it('marks the order authorized, auto-confirms and answers ALREADY_AUTHORIZED', async () => {
      ordersRepo.findOne.mockResolvedValue(digitalQuoted());
      paymentsService.retrieveIntent.mockResolvedValue({
        id: 'pi_held',
        status: 'requires_capture',
        client_secret: 'cs_held',
        amount: 3964,
        currency: 'usd',
      } as never);
      const autoSpy = jest
        .spyOn(service, 'autoConfirmSkipQuoteByIntentId')
        .mockResolvedValue(undefined);

      await expect(
        service.authorize('order-1', fakeUser(UserRole.CLIENT)),
      ).rejects.toMatchObject({ response: { code: 'ALREADY_AUTHORIZED' } });

      expect(paymentsService.markAuthorizedByIntentId).toHaveBeenCalledWith(
        'pi_held',
      );
      expect(autoSpy).toHaveBeenCalledWith('pi_held');
      expect(paymentsService.createAuthorizationIntent).not.toHaveBeenCalled();
    });

    it('still hands back the same client secret while the customer has not finished paying', async () => {
      ordersRepo.findOne.mockResolvedValue(digitalQuoted());
      paymentsService.retrieveIntent.mockResolvedValue({
        id: 'pi_held',
        status: 'requires_payment_method',
        client_secret: 'cs_held',
        amount: 3964,
        currency: 'usd',
      } as never);

      await expect(
        service.authorize('order-1', fakeUser(UserRole.CLIENT)),
      ).resolves.toMatchObject({
        paymentIntentId: 'pi_held',
        clientSecret: 'cs_held',
      });
      expect(paymentsService.markAuthorizedByIntentId).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // updateStatus → CANCELLED releases the Stripe hold (digital orders only)
  // -------------------------------------------------------------------------

  describe('updateStatus → CANCELLED releases the Stripe hold', () => {
    const superUser = fakeUser(UserRole.SUPER_ADMIN_DELIVERY);

    const mockCancelTx = () => {
      (dataSource.transaction as jest.Mock).mockImplementation(
        async (cb: (mgr: EntityManager) => Promise<unknown>) => {
          const orderRepo = makeRepoMock<Order>();
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
    };

    it('cancels the uncaptured intent of a digital order', async () => {
      const order = fakeOrder({
        status: OrderStatus.QUOTED,
        paymentMethod: PaymentMethod.DIGITAL,
        stripePaymentIntentId: 'pi_held',
        creditApplied: '0.00',
        customer: fakeUser() as never,
      });
      mockCancelTx();
      ordersRepo.findOne.mockResolvedValueOnce(order).mockResolvedValueOnce({
        ...order,
        status: OrderStatus.CANCELLED,
      });

      await service.updateStatus(
        'order-1',
        { status: OrderStatus.CANCELLED },
        superUser,
      );

      expect(paymentsService.cancelIntent).toHaveBeenCalledWith('pi_held');
    });

    it('does not touch Stripe for a cash order', async () => {
      const order = fakeOrder({
        status: OrderStatus.QUOTED,
        paymentMethod: PaymentMethod.CASH,
        stripePaymentIntentId: null,
        creditApplied: '0.00',
        customer: fakeUser() as never,
      });
      mockCancelTx();
      ordersRepo.findOne.mockResolvedValueOnce(order).mockResolvedValueOnce({
        ...order,
        status: OrderStatus.CANCELLED,
      });

      await service.updateStatus(
        'order-1',
        { status: OrderStatus.CANCELLED },
        superUser,
      );

      expect(paymentsService.cancelIntent).not.toHaveBeenCalled();
    });
  });
});
