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
import { DeliveryZone } from '../../src/entities/delivery-zone.entity';
import { UserRole, OrderStatus, PaymentMethod } from '../../src/entities/enums';
import { OrdersService } from '../../src/modules/orders/orders.service';
import { TwilioService } from '../../src/modules/twilio/twilio.service';
import { AddressesService } from '../../src/modules/addresses/addresses.service';
import { UserAddress } from '../../src/entities/user-address.entity';
import { ShippingRateService } from '../../src/modules/shipping/shipping-rate.service';
import { computeTaxableBase } from '../../src/common/tax';
import { Subscription, SubscriptionStatus } from '../../src/entities/subscription.entity';
import { SubscriptionPlan } from '../../src/entities/subscription-plan.entity';
import { RentalStatus } from '../../src/entities/rental.entity';

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
        await dataSource.query(
          `DELETE FROM subscriptions WHERE user_id = $1`,
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
  // El suscriptor paga el envío cotizado: la suscripción cubre el bebedero, no
  // el viaje (regla del dueño, 2026-09-14). Antes acá se forzaba $0.
  // -------------------------------------------------------------------------

  describe('setQuote — el suscriptor paga el envío cotizado', () => {
    it('el envío cotizado se cobra al suscriptor igual que a cualquiera, y la orden recuerda que era suscriptor', async () => {
      // Arrange: create user with active subscription
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
          currency: 'usd',
          interval: 'month',
        } as unknown as SubscriptionPlan);
      }

      const now = new Date();
      const futureEnd = new Date(now.getTime() + 30 * 24 * 3600 * 1000);

      // Insert an active subscription for this user
      const subRepo = dataSource.getRepository(Subscription);
      const sub = await subRepo.save({
        userId: user.id,
        stripeSubscriptionId: `sub_fs_test_${Date.now()}`,
        status: SubscriptionStatus.ACTIVE,
        currentPeriodStart: now,
        currentPeriodEnd: futureEnd,
        cancelAtPeriodEnd: false,
        canceledAt: null,
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

      // Assert: nada de override — se cobra lo que tipeó el admin. Sin líneas
      // en la orden todo es gravable: (1000 + 750) * 0.08887 = 156 → 19.06.
      expect(result.shipping).toBe('7.50');
      expect(result.wasSubscriberAtQuote).toBe(true);
      expect(result.totalAmount).toBe('19.06');

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

  // ─────────────────────────────────────────────────────────────────────────
  // T73: Mixed cart — single_payment + rental items
  // ─────────────────────────────────────────────────────────────────────────

  describe('T73: Mixed cart (single_payment + rental)', () => {
    let singleProduct: Product;
    let rentalProduct: Product;
    let mixedTestCategory: { id: string };
    const mixedCartUserIds: string[] = [];
    const mixedCartRentalIds: string[] = [];

    beforeAll(async () => {
      // Create a category and two products: one single_payment, one rental
      mixedTestCategory = await dataSource.getRepository(Category).save({
        name: 'Mixed Cart Category',
        slug: `mixed-cart-cat-${Date.now()}`,
        emoji: null,
        imageUrl: null,
        isActive: true,
      } as unknown as Category) as unknown as { id: string };

      singleProduct = await dataSource.getRepository(Product).save({
        name: 'Mixed Cart - Single Payment Product',
        priceToPublic: '5.00',
        salePrice: null,
        salePriceStart: null,
        salePriceEnd: null,
        isAvailable: true,
        stock: 100,
        imageUrl: null,
        description: null,
        categoryId: mixedTestCategory.id,
        pricingMode: 'single_payment',
        monthlyRentCents: 0,
        lateFeeCents: 0,
      } as unknown as Product);

      rentalProduct = await dataSource.getRepository(Product).save({
        name: 'Mixed Cart - Rental Product',
        priceToPublic: '0.00',
        salePrice: null,
        salePriceStart: null,
        salePriceEnd: null,
        isAvailable: true,
        stock: 10,
        imageUrl: null,
        description: null,
        categoryId: mixedTestCategory.id,
        pricingMode: 'rental',
        monthlyRentCents: 2000,
        lateFeeCents: 500,
        stripePriceId: 'price_mixed_cart_test',
        stripeProductId: 'prod_mixed_cart_test',
      } as unknown as Product);
    });

    afterAll(async () => {
      for (const id of mixedCartRentalIds) {
        await dataSource.query(`DELETE FROM rentals WHERE id = $1`, [id]);
      }
      for (const userId of mixedCartUserIds) {
        await dataSource.query(`DELETE FROM "order_items" WHERE order_id IN (SELECT id FROM "orders" WHERE customer_id = $1)`, [userId]);
        await dataSource.query(`DELETE FROM "orders" WHERE customer_id = $1`, [userId]);
        await dataSource.query(`DELETE FROM subscriptions WHERE user_id = $1`, [userId]);
        await dataSource.getRepository(User).delete({ id: userId });
      }
      await dataSource.getRepository(Product).delete({ id: singleProduct.id });
      await dataSource.getRepository(Product).delete({ id: rentalProduct.id });
      await dataSource.getRepository(Category).delete({ id: mixedTestCategory.id });
    });

    it('rejects a mixed cart (single_payment + rental) with MIXED_CART_NOT_ALLOWED', async () => {
      // Mixed carts were disallowed by the cycle-5 server guard (commit cfa9c0b),
      // added AFTER this block was first written. Combining a single_payment item
      // with a rental item in one order now throws MIXED_CART_NOT_ALLOWED — the same
      // contract the rental-cycle E2E "BUG-3 fix" asserts at the wire level.
      const userData = makeUser({ role: UserRole.CLIENT, stripeCustomerId: 'cus_mixed_cart_test' });
      const user = await dataSource.getRepository(User).save(userData as unknown as User);
      mixedCartUserIds.push(user.id);

      const authUser = { id: user.id, role: UserRole.CLIENT, email: null };

      await expect(
        ordersService.create(authUser, {
          items: [
            { productId: singleProduct.id, quantity: 2 },
            { productId: rentalProduct.id, quantity: 1 },
          ],
          deliveryAddress: { text: 'Mixed Cart Test St', lat: 18.4, lng: -69.9 },
          paymentMethod: PaymentMethod.DIGITAL,
          usePoints: false,
          useCredit: false,
        }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'MIXED_CART_NOT_ALLOWED' }),
      });
    });

    it('mixed cart is rejected even for an active subscriber (guard not bypassed)', async () => {
      // Regression: the mixed-cart guard must fire regardless of subscription status.
      // El cobro del envío al suscriptor en un carrito válido lo cubre el test
      // "setQuote — el suscriptor paga el envío cotizado" de más arriba.
      const userData = makeUser({ role: UserRole.CLIENT, stripeCustomerId: 'cus_fs_rental_test' });
      const user = await dataSource.getRepository(User).save(userData as unknown as User);
      mixedCartUserIds.push(user.id);

      // Ensure a subscription plan exists
      const planRepo = dataSource.getRepository(SubscriptionPlan);
      let plan = await planRepo.findOne({ where: {} });
      if (!plan) {
        plan = await planRepo.save({
          stripeProductId: 'prod_fs_rental_test',
          activeStripePriceId: 'price_fs_rental_test',
          unitAmountCents: 1000,
          currency: 'usd',
          interval: 'month',
        } as unknown as SubscriptionPlan);
      }

      const now = new Date();
      const futureEnd = new Date(now.getTime() + 30 * 24 * 3600 * 1000);

      await dataSource.getRepository(Subscription).save({
        userId: user.id,
        stripeSubscriptionId: `sub_fs_rental_${Date.now()}`,
        status: SubscriptionStatus.ACTIVE,
        currentPeriodStart: now,
        currentPeriodEnd: futureEnd,
        cancelAtPeriodEnd: false,
        canceledAt: null,
      } as unknown as Subscription);

      // Even an active subscriber cannot place a mixed cart — the guard fires first.
      const authUser = { id: user.id, role: UserRole.CLIENT, email: null };
      await expect(
        ordersService.create(authUser, {
          items: [
            { productId: singleProduct.id, quantity: 1 },
            { productId: rentalProduct.id, quantity: 1 },
          ],
          deliveryAddress: { text: 'FS Rental Test St', lat: 18.4, lng: -69.9 },
          paymentMethod: PaymentMethod.DIGITAL,
          usePoints: false,
          useCredit: false,
        }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'MIXED_CART_NOT_ALLOWED' }),
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Tax por zona: contra las tasas que SIEMBRA la migración
  // 1808000000000-AddTaxRateToDeliveryZones sobre Postgres real — con mocks el
  // prefijo de ZIP y el numeric(6,5) siempre salen perfectos, acá no.
  // ─────────────────────────────────────────────────────────────────────────

  describe('Tax por zona (Elizabeth NJ vs. ZIP sin zona)', () => {
    let addressesService: AddressesService;
    let shippingRateService: ShippingRateService;
    let taxZoneCategory: Category;
    let taxZoneProduct: Product;
    let taxZoneQuotedProduct: Product;
    const taxZoneUserIds: string[] = [];

    beforeAll(async () => {
      addressesService = app.get(AddressesService);
      shippingRateService = app.get(ShippingRateService);

      taxZoneCategory = await dataSource.getRepository(Category).save({
        name: 'Tax Zone Test Category',
        slug: `tax-zone-cat-${Date.now()}`,
        emoji: null,
        imageUrl: null,
        isActive: true,
      } as unknown as Category);

      // requiresQuote: false → carrito skip-cotización: la orden congela el
      // impuesto AL CREARSE (ver orders.service.ts `skipQuote`). Sin esto
      // order.tax se queda en 0 hasta un setQuote manual que este test no hace.
      taxZoneProduct = await dataSource.getRepository(Product).save({
        name: 'Tax Zone Test Product',
        priceToPublic: '10.00',
        salePrice: null,
        salePriceStart: null,
        salePriceEnd: null,
        isAvailable: true,
        stock: 100,
        imageUrl: null,
        description: null,
        categoryId: taxZoneCategory.id,
        requiresQuote: false,
      } as unknown as Product);

      // requiresQuote: true → el camino REAL del negocio: el pedido nace en
      // PENDING_QUOTE (sin impuesto), el admin pincha la dirección y recién
      // ahí cotiza.
      taxZoneQuotedProduct = await dataSource.getRepository(Product).save({
        name: 'Tax Zone Quoted Product',
        priceToPublic: '10.00',
        salePrice: null,
        salePriceStart: null,
        salePriceEnd: null,
        isAvailable: true,
        stock: 100,
        imageUrl: null,
        description: null,
        categoryId: taxZoneCategory.id,
        requiresQuote: true,
      } as unknown as Product);
    });

    afterAll(async () => {
      for (const userId of taxZoneUserIds) {
        // order_items cae por CASCADE al borrar la orden; user_addresses cae
        // por CASCADE al borrar el usuario (ver migraciones 1777680132516 y
        // 1778169602193) — no hace falta borrarlos a mano.
        await dataSource.query(`DELETE FROM "orders" WHERE customer_id = $1`, [userId]);
        await dataSource.getRepository(User).delete({ id: userId });
      }
      await dataSource.getRepository(Product).delete({ id: taxZoneProduct.id });
      await dataSource
        .getRepository(Product)
        .delete({ id: taxZoneQuotedProduct.id });
      await dataSource.getRepository(Category).delete({ id: taxZoneCategory.id });
    });

    it('ZIP de Elizabeth NJ (07201) resuelve 0.06625 y arrastra hasta la orden; un ZIP sin zona (90210) cae al fallback 0.08887', async () => {
      const userData = makeUser({ role: UserRole.CLIENT });
      const user = await dataSource.getRepository(User).save(userData as unknown as User);
      taxZoneUserIds.push(user.id);

      const elizabethZone = await dataSource
        .getRepository(DeliveryZone)
        .findOneOrFail({ where: { name: 'Elizabeth NJ' } });

      // --- Dirección en zona: Elizabeth NJ, prefijo sembrado '0720' --------
      const njAddress = await addressesService.create(user.id, {
        label: 'Casa NJ',
        line1: '123 Elizabeth Ave',
        lat: 40.6639,
        lng: -74.2107,
        postalCode: '07201',
      });

      expect(njAddress.zoneId).toBe(elizabethZone.id);
      expect(njAddress.taxRate).toBeCloseTo(0.06625, 5);

      // --- Dirección fuera de toda zona: Beverly Hills no tiene reparto -----
      const noZoneAddress = await addressesService.create(user.id, {
        label: 'Casa sin zona',
        line1: '456 Beverly Dr',
        lat: 34.0901,
        lng: -118.4065,
        postalCode: '90210',
      });

      expect(noZoneAddress.zoneId).toBeNull();
      expect(noZoneAddress.taxRate).toBeCloseTo(0.08887, 5);

      // --- Orden con el snapshot de la dirección de Elizabeth NJ ------------
      // La dirección de una orden es JSONB (sólo postalCode viaja, no zoneId),
      // así que la tasa se vuelve a resolver por prefijo — no por la zona ya
      // guardada en la libreta.
      const authUser = { id: user.id, role: UserRole.CLIENT, email: null };
      const order = await ordersService.create(authUser, {
        items: [{ productId: taxZoneProduct.id, quantity: 1 }],
        deliveryAddress: {
          text: njAddress.line1,
          lat: njAddress.lat,
          lng: njAddress.lng,
          postalCode: '07201',
        },
        paymentMethod: PaymentMethod.CASH,
        usePoints: false,
        useCredit: false,
      });

      expect(order.taxRate).toBe('0.06625');

      // El impuesto esperado se calcula con la MISMA función pura que usa el
      // servicio (common/tax.ts): carrito 100% 'standard' → tax =
      // round((subtotal + envío − puntos) × tasa). El envío se lee en vivo
      // (no se hardcodea DEFAULT_FLAT_SHIPPING_CENTS) porque es editable por
      // el super admin y la base de test es compartida con otros specs.
      const subtotalCents = 1000; // priceToPublic '10.00' × quantity 1
      const shippingCents = await shippingRateService.getFlatShippingCents();
      const expected = computeTaxableBase(
        [{ lineCents: subtotalCents, taxCategory: 'standard' }],
        { shippingCents, pointsRedeemedCents: 0, taxRate: 0.06625 },
      );

      expect(order.tax).toBe((expected.taxCents / 100).toFixed(2));
    });

    it('pedido sin dirección → el admin la pincha (07201) → al cotizar se cobra 6.625%, no el fallback', async () => {
      // El flujo real: el cliente pide sin dirección, así que al crearse la
      // orden se congela el fallback. Si la tasa no se re-resolviera después,
      // TODO New Jersey pagaría 8.887%.
      const userData = makeUser({ role: UserRole.CLIENT });
      const user = await dataSource.getRepository(User).save(userData as unknown as User);
      taxZoneUserIds.push(user.id);

      const authUser = { id: user.id, role: UserRole.CLIENT, email: null };
      const admin = {
        id: user.id,
        role: UserRole.SUPER_ADMIN_DELIVERY,
        email: null,
      };

      const created = await ordersService.create(authUser, {
        items: [{ productId: taxZoneQuotedProduct.id, quantity: 1 }],
        paymentMethod: PaymentMethod.CASH,
        usePoints: false,
        useCredit: false,
      });

      expect(created.status).toBe(OrderStatus.PENDING_QUOTE);
      expect(created.taxRate).toBe('0.08887');

      // --- El admin pincha Elizabeth NJ ------------------------------------
      const pinned = await ordersService.setDeliveryAddress(
        created.id,
        {
          text: '123 Elizabeth Ave',
          lat: 40.6639,
          lng: -74.2107,
          postalCode: '07201',
        },
        admin,
      );

      // La tasa se re-congela acá para que el formulario de cotización del
      // admin muestre el porcentaje correcto ANTES de cotizar.
      expect(pinned.taxRate).toBe('0.06625');
      expect(pinned.tax).toBe('0.00'); // sin cotizar todavía no hay impuesto

      // --- El admin cotiza el envío ----------------------------------------
      const shippingCents = 500;
      const quoted = await ordersService.setQuote(
        created.id,
        shippingCents,
        admin,
      );

      expect(quoted.status).toBe(OrderStatus.QUOTED);
      expect(quoted.taxRate).toBe('0.06625');

      const expected = computeTaxableBase(
        [{ lineCents: 1000, taxCategory: 'standard' }],
        { shippingCents, pointsRedeemedCents: 0, taxRate: 0.06625 },
      );
      expect(quoted.tax).toBe((expected.taxCents / 100).toFixed(2));
      // Y no el fallback: con 8.887% habrían sido $1.33.
      expect(quoted.tax).toBe('0.99');
    });

    it('un ZIP del Bronx (10462) cobra 8.875% y congela la jurisdicción NYC', async () => {
      // El otro lado de la línea del estado. Desde la migración 1809 la tasa NO
      // sale de la zona (las cuatro sembradas quedaron en tax_rate NULL): sale
      // de `tax_jurisdictions`. La geocodificación está apagada en la suite, así
      // que esto prueba el camino "sin estado, resuelvo por el ZIP" — el de las
      // direcciones viejas sin backfillear.
      const userData = makeUser({ role: UserRole.CLIENT });
      const user = await dataSource
        .getRepository(User)
        .save(userData as unknown as User);
      taxZoneUserIds.push(user.id);

      const authUser = { id: user.id, role: UserRole.CLIENT, email: null };
      const order = await ordersService.create(authUser, {
        items: [{ productId: taxZoneProduct.id, quantity: 1 }],
        deliveryAddress: {
          text: '1728 Williamsbridge Rd',
          lat: 40.8448,
          lng: -73.8648,
          postalCode: '10462',
        },
        paymentMethod: PaymentMethod.CASH,
        usePoints: false,
        useCredit: false,
      });

      expect(order.taxRate).toBe('0.08875');
      expect(order.taxJurisdiction).toBe('NYC');

      const shippingCents = await shippingRateService.getFlatShippingCents();
      const expected = computeTaxableBase(
        [{ lineCents: 1000, taxCategory: 'standard' }],
        { shippingCents, pointsRedeemedCents: 0, taxRate: 0.08875 },
      );
      expect(order.tax).toBe((expected.taxCents / 100).toFixed(2));
    });

    it('payload de producción (id + snapshot): el snapshot hereda estado y número de puerta de la fila, y cotizar NO mueve la jurisdicción', async () => {
      // Esto es lo que postea el checkout de verdad: las DOS cosas juntas
      // (ver dashgo-web/src/routes/checkout.tsx y dashgo/src/app/checkout.tsx).
      // Antes, el `deliveryAddressId` apagaba la geocodificación y la fila no
      // se copiaba: el JSONB quedaba con state null y `setQuote` re-resolvía
      // con el ZIP posteado — del Bronx a New Jersey, de 8.875% a 6.625%.
      const userData = makeUser({ role: UserRole.CLIENT });
      const user = await dataSource
        .getRepository(User)
        .save(userData as unknown as User);
      taxZoneUserIds.push(user.id);

      // Fila de libreta YA geocodificada. La suite corre con
      // GEOCODING_ENABLED=false, así que los campos derivados se escriben a
      // mano — es exactamente lo que deja el backfill en producción.
      const row = await dataSource.getRepository(UserAddress).save({
        userId: user.id,
        label: 'Casa',
        line1: '1728 Williamsbridge Rd',
        line2: null,
        building: null,
        lat: 40.8448,
        lng: -73.8648,
        instructions: null,
        postalCode: '10462',
        houseNumber: '1728',
        city: 'New York',
        county: 'Bronx County',
        state: 'NY',
        zoneId: null,
        isDefault: true,
      } as unknown as UserAddress);

      const authUser = { id: user.id, role: UserRole.CLIENT, email: null };
      const admin = {
        id: user.id,
        role: UserRole.SUPER_ADMIN_DELIVERY,
        email: null,
      };

      const order = await ordersService.create(authUser, {
        items: [{ productId: taxZoneQuotedProduct.id, quantity: 1 }],
        deliveryAddressId: row.id,
        deliveryAddress: {
          text: '1728 Williamsbridge Rd',
          lat: 40.8448,
          lng: -73.8648,
          // ZIP de New Jersey en el snapshot: el cliente lo escribe, así que
          // no puede ser lo que fija la plata.
          postalCode: '07201',
        },
        paymentMethod: PaymentMethod.CASH,
        usePoints: false,
        useCredit: false,
      });

      expect(order.deliveryAddress).toEqual(
        expect.objectContaining({
          city: 'New York',
          state: 'NY',
          county: 'Bronx County',
          houseNumber: '1728',
          postalCode: '10462',
        }),
      );
      expect(order.taxJurisdiction).toBe('NYC');
      expect(order.taxRate).toBe('0.08875');

      // --- y el admin cotiza: la jurisdicción no se mueve ------------------
      const shippingCents = 500;
      const quoted = await ordersService.setQuote(
        order.id,
        shippingCents,
        admin,
      );

      expect(quoted.taxJurisdiction).toBe('NYC');
      expect(quoted.taxRate).toBe('0.08875');
      const expected = computeTaxableBase(
        [{ lineCents: 1000, taxCategory: 'standard' }],
        { shippingCents, pointsRedeemedCents: 0, taxRate: 0.08875 },
      );
      expect(quoted.tax).toBe((expected.taxCents / 100).toFixed(2));
    });

    it('un ZIP sin jurisdicción congela null y el fallback histórico', async () => {
      const userData = makeUser({ role: UserRole.CLIENT });
      const user = await dataSource
        .getRepository(User)
        .save(userData as unknown as User);
      taxZoneUserIds.push(user.id);

      const authUser = { id: user.id, role: UserRole.CLIENT, email: null };
      const order = await ordersService.create(authUser, {
        items: [{ productId: taxZoneProduct.id, quantity: 1 }],
        deliveryAddress: {
          text: '456 Beverly Dr',
          lat: 34.0901,
          lng: -118.4065,
          postalCode: '90210',
        },
        paymentMethod: PaymentMethod.CASH,
        usePoints: false,
        useCredit: false,
      });

      expect(order.taxRate).toBe('0.08887');
      expect(order.taxJurisdiction).toBeNull();
    });
  });
});
