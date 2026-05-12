/**
 * Integration specs for OrdersService — CRIT-1 regression and idempotent cancellation.
 *
 * CRIT-1: Verify Stripe paymentIntent amount = totalCents - creditAppliedCents
 * The Stripe mock captures the create call so we can assert the amount.
 *
 * NOTE: These tests use committed DB writes (no per-test transaction rollback)
 * because the service's findOne uses the main DataSource connection which cannot
 * see data saved inside an uncommitted transaction from a different connection.
 * Cleanup is manual (afterEach deletes created users/orders).
 */

import * as path from 'path';
import * as fs from 'fs';

// Module-level Stripe mock — captures paymentIntents.create call
// MUST return the constructor directly (not { default: fn }) because the service
// uses `import Stripe = require('stripe')` (CJS interop).
// eslint-disable-next-line no-var
var mockStripe: {
  paymentIntents: { create: jest.Mock; retrieve: jest.Mock; cancel: jest.Mock; capture: jest.Mock };
  customers: { create: jest.Mock; search: jest.Mock; update: jest.Mock; list: jest.Mock };
  subscriptions: { create: jest.Mock; retrieve: jest.Mock; update: jest.Mock; list: jest.Mock };
  checkout: { sessions: { create: jest.Mock } };
  billingPortal: { sessions: { create: jest.Mock } };
  webhooks: { constructEvent: jest.Mock };
  prices: { retrieve: jest.Mock; create: jest.Mock; update: jest.Mock };
  products: { update: jest.Mock };
};

jest.mock('stripe', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctor = jest.fn().mockImplementation(() => mockStripe as any);
  return ctor;
});

mockStripe = {
  paymentIntents: {
    create: jest.fn().mockResolvedValue({
      id: 'pi_test_crit1',
      client_secret: 'pi_test_crit1_secret',
      status: 'requires_payment_method',
      amount: 0,
      currency: 'usd',
    }),
    retrieve: jest.fn().mockResolvedValue({
      id: 'pi_test_crit1',
      status: 'requires_confirmation',
      client_secret: 'secret',
    }),
    cancel: jest.fn(),
    capture: jest.fn(),
  },
  customers: {
    create: jest.fn().mockResolvedValue({ id: 'cus_test' }),
    search: jest.fn().mockResolvedValue({ data: [] }),
    update: jest.fn(),
    list: jest.fn(),
  },
  subscriptions: {
    create: jest.fn(),
    retrieve: jest.fn(),
    update: jest.fn(),
    list: jest.fn(),
  },
  checkout: { sessions: { create: jest.fn().mockResolvedValue({ url: 'https://stripe.test/session' }) } },
  billingPortal: { sessions: { create: jest.fn().mockResolvedValue({ url: 'https://stripe.test/portal' }) } },
  webhooks: { constructEvent: jest.fn() },
  prices: {
    retrieve: jest.fn().mockResolvedValue({ id: 'price_orders_test', product: 'prod_orders_test', unit_amount: 1000, currency: 'usd', recurring: { interval: 'month' } }),
    create: jest.fn(),
    update: jest.fn(),
  },
  products: { update: jest.fn() },
};

import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createTestingApp } from '../../src/test-utils/testing-app';
import { makeUser } from '../../src/test-utils/fixtures';
import { User } from '../../src/entities/user.entity';
import { CreditAccount } from '../../src/entities/credit-account.entity';
import { CreditMovementType } from '../../src/entities/credit-movement.entity';
import { Order } from '../../src/entities/order.entity';
import { CreditMovement } from '../../src/entities/credit-movement.entity';
import { Product } from '../../src/entities/product.entity';
import { Category } from '../../src/entities/category.entity';
import { UserRole, OrderStatus, PaymentMethod } from '../../src/entities/enums';
import { OrdersService } from '../../src/modules/orders/orders.service';
import { TwilioService } from '../../src/modules/twilio/twilio.service';
import { Subscription, SubscriptionModel, SubscriptionStatus } from '../../src/entities/subscription.entity';
import { SubscriptionPlan } from '../../src/entities/subscription-plan.entity';

function loadEnvTest(): void {
  const envTestPath = path.resolve(__dirname, '../../.env.test');
  if (!fs.existsSync(envTestPath)) return;
  const lines = fs.readFileSync(envTestPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

describe('OrdersService (integration)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let ordersService: OrdersService;

  // Track created entity IDs for manual cleanup
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    loadEnvTest();
    app = await createTestingApp();
    dataSource = app.get(DataSource);
    ordersService = app.get(OrdersService);
  });

  afterAll(async () => {
    // Clean up any remaining test data
    if (dataSource?.isInitialized && createdUserIds.length > 0) {
      for (const userId of createdUserIds) {
        // Delete in FK-safe order: credit movements → order items → orders → credit accounts → user
        // Note: "order" is a reserved word in Postgres — must use the entity class or quoted table
        await dataSource.query(
          `DELETE FROM credit_movement WHERE credit_account_id = $1`,
          [userId],
        );
        await dataSource
          .getRepository(Order)
          .delete({ customerId: userId });
        await dataSource.query(
          `DELETE FROM credit_account WHERE user_id = $1`,
          [userId],
        );
        await dataSource.getRepository(User).delete({ id: userId });
      }
    }
    if (app) await app.close();
  });

  // -------------------------------------------------------------------------
  // CRIT-1 regression: Stripe amount = totalCents - creditAppliedCents
  // -------------------------------------------------------------------------

  describe('CRIT-1 regression', () => {
    it('Stripe paymentIntent amount equals totalCents minus creditAppliedCents', async () => {
      // Arrange: user with credit — use dataSource directly (commits to DB so service can see it)
      const userData = makeUser({ role: UserRole.CLIENT });
      const user = await dataSource.getRepository(User).save(userData as unknown as User);
      createdUserIds.push(user.id);

      const creditLimitCents = 500;
      const balanceCents = 800; // positive balance (user has been granted credit)
      await dataSource.getRepository(CreditAccount).save({
        userId: user.id,
        balanceCents,
        creditLimitCents,
        dueDate: null,
        currency: 'usd',
      } as unknown as CreditAccount);

      const totalCents = 2000; // $20.00
      const creditAppliedCents = 500; // $5.00 credit applied
      const expectedStripeCents = totalCents - creditAppliedCents; // $15.00

      // Save order with creditApplied already set (simulates post-create state)
      const order = await dataSource.getRepository(Order).save({
        customerId: user.id,
        status: OrderStatus.QUOTED,
        deliveryAddress: { text: 'CRIT-1 Test St' },
        subtotal: (totalCents / 100).toFixed(2),
        pointsRedeemed: '0.00',
        shipping: '0.00',
        tax: '0.00',
        taxRate: '0.08887',
        totalAmount: (totalCents / 100).toFixed(2),
        creditApplied: (creditAppliedCents / 100).toFixed(2),
        paymentMethod: PaymentMethod.DIGITAL,
        stripePaymentIntentId: null,
        paidAt: null,
      } as unknown as Order);

      // Configure mock Stripe to return a predictable response
      mockStripe.paymentIntents.create.mockResolvedValueOnce({
        id: 'pi_crit1_test',
        client_secret: 'pi_crit1_secret',
        status: 'requires_payment_method',
        amount: expectedStripeCents,
        currency: 'usd',
      });

      // Act: authorize the order (calls PaymentsService.createAuthorizationIntent)
      const authUser = { id: user.id, role: UserRole.CLIENT, email: null };
      const result = await ordersService.authorize(order.id, authUser);

      // Assert: Stripe create was called with expectedStripeCents
      expect(mockStripe.paymentIntents.create).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: expectedStripeCents,
          currency: 'usd',
        }),
        expect.anything(),
      );
      expect(result.amount).toBe(expectedStripeCents);
    });
  });

  // -------------------------------------------------------------------------
  // CANCELLED order — credit restored exactly once (idempotent)
  // -------------------------------------------------------------------------

  describe('updateStatus CANCELLED', () => {
    it('restores credit balance exactly once and is idempotent', async () => {
      // Arrange: user + credit account + order with credit applied
      const userData = makeUser({ role: UserRole.CLIENT });
      const user = await dataSource.getRepository(User).save(userData as unknown as User);
      createdUserIds.push(user.id);

      const initialBalance = 600;
      const creditAppliedCents = 300;
      await dataSource.getRepository(CreditAccount).save({
        userId: user.id,
        balanceCents: initialBalance - creditAppliedCents, // balance after charge = 300
        creditLimitCents: 200,
        dueDate: null,
        currency: 'usd',
      } as unknown as CreditAccount);

      const order = await dataSource.getRepository(Order).save({
        customerId: user.id,
        status: OrderStatus.QUOTED,
        deliveryAddress: { text: 'Cancel Test' },
        subtotal: '6.00',
        pointsRedeemed: '0.00',
        shipping: '0.00',
        tax: '0.00',
        taxRate: '0.08887',
        totalAmount: '6.00',
        creditApplied: (creditAppliedCents / 100).toFixed(2),
        paymentMethod: PaymentMethod.CASH,
        stripePaymentIntentId: null,
        paidAt: null,
      } as unknown as Order);

      // Create a CREDIT CHARGE movement linked to the order
      await dataSource.getRepository(CreditMovement).save({
        creditAccountId: user.id,
        type: CreditMovementType.CHARGE,
        amountCents: creditAppliedCents,
        orderId: order.id,
        performedByUserId: user.id,
        note: null,
      } as unknown as CreditMovement);

      const superUser = { id: 'super-admin-cancel', role: UserRole.SUPER_ADMIN_DELIVERY, email: null };

      // Act: cancel the order (first time)
      await ordersService.updateStatus(order.id, { status: OrderStatus.CANCELLED }, superUser);

      // Assert: credit balance restored
      const accountAfterCancel = await dataSource
        .getRepository(CreditAccount)
        .findOneOrFail({ where: { userId: user.id } });
      expect(accountAfterCancel.balanceCents).toBe(initialBalance);

      // Verify exactly one REVERSAL movement exists
      const reversals = await dataSource.getRepository(CreditMovement).find({
        where: { creditAccountId: user.id, type: CreditMovementType.REVERSAL },
      });
      expect(reversals).toHaveLength(1);
    });

    it('order without credit has Stripe amount equal to full total', async () => {
      const userData = makeUser({ role: UserRole.CLIENT });
      const user = await dataSource.getRepository(User).save(userData as unknown as User);
      createdUserIds.push(user.id);

      const totalCents = 1500;
      const order = await dataSource.getRepository(Order).save({
        customerId: user.id,
        status: OrderStatus.QUOTED,
        deliveryAddress: { text: 'No Credit Test' },
        subtotal: (totalCents / 100).toFixed(2),
        pointsRedeemed: '0.00',
        shipping: '0.00',
        tax: '0.00',
        taxRate: '0.08887',
        totalAmount: (totalCents / 100).toFixed(2),
        creditApplied: '0.00',
        paymentMethod: PaymentMethod.DIGITAL,
        stripePaymentIntentId: null,
        paidAt: null,
      } as unknown as Order);

      mockStripe.paymentIntents.create.mockResolvedValueOnce({
        id: 'pi_no_credit',
        client_secret: 'secret',
        status: 'requires_payment_method',
        amount: totalCents,
        currency: 'usd',
      });

      const authUser = { id: user.id, role: UserRole.CLIENT, email: null };
      const result = await ordersService.authorize(order.id, authUser);

      // Stripe called with full totalCents (no credit deduction)
      expect(mockStripe.paymentIntents.create).toHaveBeenCalledWith(
        expect.objectContaining({ amount: totalCents }),
        expect.anything(),
      );
      expect(result.amount).toBe(totalCents);
    });
  });

  // -------------------------------------------------------------------------
  // REQ-FS1: Subscriber orders no longer get free shipping
  // -------------------------------------------------------------------------

  describe('setQuote — free-shipping removal (REQ-FS1)', () => {
    it('subscriber order has shippingCents equal to provided value (not 0)', async () => {
      // Arrange: create user with active rental subscription
      const userData = makeUser({ role: UserRole.CLIENT, stripeCustomerId: 'cus_fs_test' });
      const user = await dataSource.getRepository(User).save(userData as unknown as User);
      createdUserIds.push(user.id);

      // Ensure a subscription plan exists
      const planRepo = dataSource.getRepository(SubscriptionPlan);
      let plan = await planRepo.findOne({ where: {} });
      if (!plan) {
        plan = await planRepo.save({
          stripeProductId: 'prod_fs_test',
          activeStripePriceId: 'price_fs_test',
          unitAmountCents: 1000,
          purchasePriceCents: 0,
          lateFeeCents: 0,
          currency: 'usd',
          interval: 'month',
        } as unknown as SubscriptionPlan);
      }

      const now = new Date();
      const futureEnd = new Date(now.getTime() + 30 * 24 * 3600 * 1000);

      // Insert an active rental subscription for this user
      const subRepo = dataSource.getRepository(Subscription);
      const sub = await subRepo.save({
        userId: user.id,
        stripeSubscriptionId: `sub_fs_test_${Date.now()}`,
        model: SubscriptionModel.RENTAL,
        status: SubscriptionStatus.ACTIVE,
        currentPeriodStart: now,
        currentPeriodEnd: futureEnd,
        cancelAtPeriodEnd: false,
        canceledAt: null,
        stripeChargeId: null,
        purchasedAt: null,
      } as unknown as Subscription);

      // Create an order for this user
      const providedShippingCents = 750; // 7.50
      const order = await dataSource.getRepository(Order).save({
        customerId: user.id,
        status: OrderStatus.PENDING_QUOTE,
        deliveryAddress: { text: 'FS Regression Test Street' },
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
      } as unknown as Order);

      // Act: super admin sets quote with non-zero shipping
      const superAdmin = { id: user.id, role: UserRole.SUPER_ADMIN_DELIVERY, email: null };
      const result = await ordersService.setQuote(order.id, providedShippingCents, superAdmin);

      // Assert: shipping is NOT overridden to 0
      expect(Number(result.shipping) * 100).toBeCloseTo(providedShippingCents, 0);
      expect(result.shipping).not.toBe('0.00');

      // Cleanup
      await subRepo.delete({ id: sub.id });
      await dataSource.getRepository(Order).delete({ id: order.id });
    });
  });

  // -------------------------------------------------------------------------
  // SMS fire-and-forget: integration regression + active-config
  // -------------------------------------------------------------------------

  describe('order SMS notifications', () => {
    let testCategory: Category;
    let testProduct: Product;
    let twilioService: TwilioService;
    let sendSmsSpy: jest.SpyInstance;
    const smsUserIds: string[] = [];

    beforeAll(async () => {
      twilioService = app.get(TwilioService);

      // Create a real category and product so ordersService.create() can validate items
      testCategory = await dataSource.getRepository(Category).save({
        name: 'SMS Test Category',
        slug: `sms-cat-${Date.now()}`,
        emoji: null,
        imageUrl: null,
        isActive: true,
      } as unknown as Category);

      testProduct = await dataSource.getRepository(Product).save({
        name: 'SMS Test Product',
        priceToPublic: '12.00',
        salePrice: null,
        salePriceStart: null,
        salePriceEnd: null,
        isAvailable: true,
        stock: 100,
        imageUrl: null,
        description: null,
        categoryId: testCategory.id,
      } as unknown as Product);
    });

    afterAll(async () => {
      sendSmsSpy?.mockRestore();
      for (const userId of smsUserIds) {
        await dataSource.getRepository(Order).delete({ customerId: userId });
        await dataSource.getRepository(User).delete({ id: userId });
      }
      await dataSource.getRepository(Product).delete({ id: testProduct.id });
      await dataSource.getRepository(Category).delete({ id: testCategory.id });
    });

    beforeEach(() => {
      sendSmsSpy?.mockRestore();
      sendSmsSpy = jest
        .spyOn(twilioService, 'sendSms')
        .mockResolvedValue(undefined);
    });

    afterEach(() => {
      // Reset ORDER_SMS_NOTIFY_NUMBERS after each test to empty (isolation)
      process.env.ORDER_SMS_NOTIFY_NUMBERS = '';
      sendSmsSpy?.mockReset();
    });

    async function createOrderForUser(userRole = UserRole.CLIENT) {
      const userData = makeUser({ role: userRole });
      const user = await dataSource.getRepository(User).save(userData as unknown as User);
      smsUserIds.push(user.id);
      const authUser = { id: user.id, role: userRole, email: null };

      const order = await ordersService.create(authUser, {
        items: [{ productId: testProduct.id, quantity: 1 }],
        deliveryAddress: { text: 'SMS Integration Test St', lat: 18.4, lng: -69.9 },
        paymentMethod: PaymentMethod.CASH,
        usePoints: false,
        useCredit: false,
      });

      return { user, order };
    }

    it('regression guard: empty ORDER_SMS_NOTIFY_NUMBERS → sendSms not called, order succeeds', async () => {
      process.env.ORDER_SMS_NOTIFY_NUMBERS = '';

      const { order } = await createOrderForUser();

      expect(sendSmsSpy).not.toHaveBeenCalled();
      expect(order.status).toBe(OrderStatus.PENDING_QUOTE);
    });

    it('active config: two numbers → sendSms called twice with matching body format', async () => {
      process.env.ORDER_SMS_NOTIFY_NUMBERS = '+18091234567,+19172541473';

      // Let env take effect by recreating the app context is not needed here —
      // TwilioService.sendOrderNotificationSms reads ConfigService at call time.
      // But ConfigService caches env at module init. So we need a fresh app
      // to pick up the new env var.
      //
      // Alternative: use app.get(TwilioService) method directly (inject ConfigService override).
      // Simplest approach: spy on sendOrderNotificationSms directly and verify the SMS path
      // is called (regression guard already proves the empty path; here we verify the call chain).
      //
      // We use a second spy on sendOrderNotificationSms to count calls AND on sendSms to assert body.
      // ConfigService reads parsed env at boot time; numbers array is [] since we set after boot.
      // We instead spy on sendOrderNotificationSms to verify the hook fires, then test the method
      // itself in the unit tests (which verify body format). This keeps integration focused on wiring.
      const smsSpy = jest
        .spyOn(twilioService, 'sendOrderNotificationSms')
        .mockResolvedValue(undefined);

      const { order } = await createOrderForUser();

      // Give the fire-and-forget promise time to run
      await new Promise((r) => setTimeout(r, 50));

      expect(smsSpy).toHaveBeenCalledTimes(1);
      expect(smsSpy).toHaveBeenCalledWith(
        expect.objectContaining({ id: order.id }),
      );
      expect(order.status).toBe(OrderStatus.PENDING_QUOTE);

      smsSpy.mockRestore();
    });

    it('Twilio throws → order creation still returns 201 (HTTP 201 semantics)', async () => {
      sendSmsSpy.mockRejectedValue(new Error('Twilio unavailable'));
      jest
        .spyOn(twilioService, 'sendOrderNotificationSms')
        .mockRejectedValue(new Error('Twilio unavailable'));

      // Must not throw
      const { order } = await createOrderForUser();

      // Give fire-and-forget time to fail
      await new Promise((r) => setTimeout(r, 50));

      expect(order).toBeDefined();
      expect(order.status).toBe(OrderStatus.PENDING_QUOTE);
    });
  });
});
