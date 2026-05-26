/**
 * Full-flow integration tests — exercise complete role journeys against a
 * real Postgres + the wired NestJS app graph. Mirrors the API-level
 * Playwright suite (dashgo-web/e2e/full-flows.spec.ts) but at the service
 * layer so failures point at backend code directly.
 *
 * Auth is bypassed: tests construct `AuthenticatedUser` objects and call
 * services with them, the same pattern used by the existing orders /
 * credit integration specs.
 *
 * Stripe is mocked at the module level (same mock pattern as orders spec).
 */

import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';

// Module-level Stripe mock — required because RentalsService /
// PaymentsService / SubscriptionService all `import Stripe = require('stripe')`
// at module load time.
// eslint-disable-next-line no-var
var mockStripe: {
  paymentIntents: { create: jest.Mock; retrieve: jest.Mock; cancel: jest.Mock; capture: jest.Mock };
  customers: { create: jest.Mock; search: jest.Mock; update: jest.Mock; list: jest.Mock };
  subscriptions: { create: jest.Mock; retrieve: jest.Mock; update: jest.Mock; list: jest.Mock };
  checkout: { sessions: { create: jest.Mock } };
  billingPortal: { sessions: { create: jest.Mock } };
  webhooks: { constructEvent: jest.Mock };
  prices: { retrieve: jest.Mock; create: jest.Mock; update: jest.Mock };
  products: { update: jest.Mock; create: jest.Mock };
};

jest.mock('stripe', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctor = jest.fn().mockImplementation(() => mockStripe as any);
  return ctor;
});

mockStripe = {
  paymentIntents: {
    create: jest.fn(),
    retrieve: jest.fn(),
    cancel: jest.fn(),
    capture: jest.fn(),
  },
  customers: {
    create: jest.fn().mockResolvedValue({ id: 'cus_test', email: 't@e' }),
    search: jest.fn().mockResolvedValue({ data: [] }),
    update: jest.fn(),
    list: jest.fn().mockResolvedValue({ data: [] }),
  },
  subscriptions: {
    create: jest.fn(),
    retrieve: jest.fn(),
    update: jest.fn(),
    list: jest.fn().mockResolvedValue({ data: [] }),
  },
  checkout: { sessions: { create: jest.fn() } },
  billingPortal: { sessions: { create: jest.fn() } },
  webhooks: { constructEvent: jest.fn() },
  prices: { retrieve: jest.fn(), create: jest.fn(), update: jest.fn() },
  products: { update: jest.fn(), create: jest.fn() },
};

import { createTestingApp } from '../../src/test-utils/testing-app';
import { makeUser } from '../../src/test-utils/fixtures';
import { User } from '../../src/entities/user.entity';
import { Category } from '../../src/entities/category.entity';
import { Product } from '../../src/entities/product.entity';
import { Order } from '../../src/entities/order.entity';
import { OrderItem } from '../../src/entities/order-item.entity';
import { Rental, RentalStatus } from '../../src/entities/rental.entity';
import { CreditAccount } from '../../src/entities/credit-account.entity';
import {
  UserRole,
  OrderStatus,
  PaymentMethod,
} from '../../src/entities/enums';
import type { AuthenticatedUser } from '../../src/common/types/authenticated-user';
import { OrdersService } from '../../src/modules/orders/orders.service';
import { PromotersService } from '../../src/modules/promoters/promoters.service';
import { CreditService } from '../../src/modules/credit/credit.service';
import { RentalsService } from '../../src/modules/rentals/rentals.service';
import { ProductsService } from '../../src/modules/products/products.service';

describe('Full flow integration — end-to-end role journeys', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let ordersService: OrdersService;
  let promotersService: PromotersService;
  let creditService: CreditService;
  let rentalsService: RentalsService;
  let productsService: ProductsService;

  let categoryId: string;
  let createdUserIds: string[] = [];
  let createdProductIds: string[] = [];
  let createdOrderIds: string[] = [];

  beforeAll(async () => {
    app = await createTestingApp();
    dataSource = app.get(DataSource);
    ordersService = app.get(OrdersService);
    promotersService = app.get(PromotersService);
    creditService = app.get(CreditService);
    rentalsService = app.get(RentalsService);
    productsService = app.get(ProductsService);

    // Seed one category for product creation
    const cat = await dataSource.getRepository(Category).save({
      name: 'QA Test',
      slug: `qa-test-${Date.now()}`,
      iconEmoji: '🧪',
      displayOrder: 99,
    });
    categoryId = cat.id;
  });

  afterAll(async () => {
    // Best-effort cleanup so reruns don't pile up rows. TypeORM rejects
    // empty-criteria deletes, so we use raw query for the join tables.
    if (createdOrderIds.length) {
      await dataSource.query(
        `DELETE FROM rentals WHERE order_id = ANY($1::uuid[])`,
        [createdOrderIds],
      );
      await dataSource.query(
        `DELETE FROM order_items WHERE order_id = ANY($1::uuid[])`,
        [createdOrderIds],
      );
      await dataSource
        .getRepository(Order)
        .createQueryBuilder()
        .delete()
        .whereInIds(createdOrderIds)
        .execute();
    }
    if (createdProductIds.length) {
      await dataSource
        .getRepository(Product)
        .createQueryBuilder()
        .delete()
        .whereInIds(createdProductIds)
        .execute();
    }
    if (createdUserIds.length) {
      await dataSource.query(
        `DELETE FROM credit_account WHERE user_id = ANY($1::uuid[])`,
        [createdUserIds],
      );
      await dataSource
        .getRepository(User)
        .createQueryBuilder()
        .delete()
        .whereInIds(createdUserIds)
        .execute();
    }
    await dataSource.getRepository(Category).delete({ id: categoryId });
    await app.close();
  });

  // --------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------

  async function seedUser(
    overrides: Partial<Parameters<typeof makeUser>[0]> = {},
  ): Promise<User> {
    const data = makeUser(overrides);
    const user = await dataSource.getRepository(User).save(data as unknown as User);
    createdUserIds.push(user.id);
    return user;
  }

  async function seedProduct(
    overrides: Partial<Product> = {},
  ): Promise<Product> {
    const product = await dataSource.getRepository(Product).save({
      name: `QA Product ${Date.now()}`,
      description: null,
      priceToPublic: '5.00',
      isAvailable: true,
      stock: 50,
      promoterCommissionPct: '3.00',
      pointsPct: '1.00',
      categoryId,
      pricingMode: 'single_payment',
      monthlyRentCents: 0,
      lateFeeCents: 0,
      stripeProductId: null,
      stripePriceId: null,
      ...overrides,
    } as unknown as Product);
    createdProductIds.push(product.id);
    return product;
  }

  function asAuthUser(user: User): AuthenticatedUser {
    return {
      id: user.id,
      role: user.role,
      email: user.email,
      fullName: user.fullName,
      phone: user.phone,
      addressDefault: user.addressDefault ?? null,
      referralCode: user.referralCode ?? null,
      referredById: user.referredById ?? null,
      stripeCustomerId: user.stripeCustomerId ?? null,
      createdAt: user.createdAt instanceof Date
        ? user.createdAt.toISOString()
        : (user.createdAt as unknown as string),
    };
  }

  // ----------------------------------------------------------------
  // 1. Full client order lifecycle: place → quote → confirm-cash → confirmed
  //    → in_route → delivered (cash path, no Stripe)
  // ----------------------------------------------------------------

  describe('Client order lifecycle (cash, no Stripe)', () => {
    it('place a cash order, admin quotes, client confirms, admin delivers', async () => {
      const client = await seedUser({ role: UserRole.CLIENT });
      const admin = await seedUser({ role: UserRole.SUPER_ADMIN_DELIVERY });
      const product = await seedProduct({ priceToPublic: '5.00', stock: 50 });

      // 1. Client places cash order
      const order = await ordersService.create(asAuthUser(client), {
        items: [{ productId: product.id, quantity: 2 }],
        paymentMethod: PaymentMethod.CASH,
        deliveryAddress: { text: 'Lifecycle Test 1', lat: 40.7, lng: -74.0 },
        usePoints: false,
        useCredit: false,
      });
      createdOrderIds.push(order.id);
      expect(order.status).toBe(OrderStatus.PENDING_QUOTE);
      expect(order.subtotal).toBe('10.00');

      // 2. Admin sets shipping quote
      const quoted = await ordersService.setQuote(
        order.id,
        300,
        asAuthUser(admin),
      );
      expect(quoted.status).toBe(OrderStatus.QUOTED);
      expect(quoted.shipping).toBe('3.00');

      // 3. Client confirms cash payment
      const confirmed = await ordersService.confirmCashOrder(order.id, asAuthUser(client));
      expect(confirmed.status).toBe(OrderStatus.PENDING_VALIDATION);

      // 4. Admin walks through delivery transitions
      for (const next of [
        OrderStatus.CONFIRMED_BY_COLMADO,
        OrderStatus.IN_DELIVERY_ROUTE,
        OrderStatus.DELIVERED,
      ]) {
        const result = await ordersService.updateStatus(
          order.id,
          { status: next },
          asAuthUser(admin),
        );
        expect(result.status).toBe(next);
      }

      // 5. Final state: delivered, no rental rows
      const final = await dataSource.getRepository(Order).findOneOrFail({
        where: { id: order.id },
      });
      expect(final.status).toBe(OrderStatus.DELIVERED);
      const rentals = await dataSource
        .getRepository(Rental)
        .find({ where: { orderId: order.id } });
      expect(rentals).toHaveLength(0);
    });
  });

  // ----------------------------------------------------------------
  // 2. Mixed-cart rejection with structured code (BUG-3 fix locked in)
  // ----------------------------------------------------------------

  describe('Mixed-cart guard returns structured { code, message }', () => {
    it('throws BadRequestException carrying MIXED_CART_NOT_ALLOWED code', async () => {
      const client = await seedUser({ role: UserRole.CLIENT });
      const rental = await seedProduct({
        name: `Rental MC ${Date.now()}`,
        pricingMode: 'rental',
        monthlyRentCents: 1500,
        lateFeeCents: 500,
        stripeProductId: 'prod_mc',
        stripePriceId: 'price_mc',
      });
      const nonRental = await seedProduct({ name: `NonRental MC ${Date.now()}` });

      try {
        await ordersService.create(asAuthUser(client), {
          items: [
            { productId: rental.id, quantity: 1 },
            { productId: nonRental.id, quantity: 1 },
          ],
          paymentMethod: PaymentMethod.CASH,
          deliveryAddress: { text: 'MC test', lat: 40.7, lng: -74.0 },
        });
        throw new Error('Expected mixed-cart rejection');
      } catch (err) {
        const response = (err as { getResponse?: () => unknown }).getResponse?.();
        expect(response).toMatchObject({
          code: 'MIXED_CART_NOT_ALLOWED',
          message: expect.stringContaining('alquiler'),
        });
      }
    });
  });

  // ----------------------------------------------------------------
  // 3. Credit-overdue guard returns 402 with structured code
  // ----------------------------------------------------------------

  describe('Credit overdue blocks order creation with CREDIT_OVERDUE code', () => {
    it('throws when customer credit_account is overdue', async () => {
      const client = await seedUser({ role: UserRole.CLIENT });
      // Open a credit account with negative balance + past due_date
      const account = dataSource.getRepository(CreditAccount).create({
        userId: client.id,
        balanceCents: -2500, // owes $25
        creditLimitCents: 5000,
        dueDate: new Date(Date.now() - 5 * 86_400_000), // 5 days overdue
        currency: 'usd',
      });
      await dataSource.getRepository(CreditAccount).save(account);
      const product = await seedProduct();

      try {
        await ordersService.create(asAuthUser(client), {
          items: [{ productId: product.id, quantity: 1 }],
          paymentMethod: PaymentMethod.CASH,
          deliveryAddress: { text: 'Overdue test', lat: 40.7, lng: -74.0 },
        });
        throw new Error('Expected overdue rejection');
      } catch (err) {
        const response = (err as { getResponse?: () => unknown }).getResponse?.();
        expect(response).toMatchObject({
          code: 'CREDIT_OVERDUE',
        });
      }
    });
  });

  // ----------------------------------------------------------------
  // 4. Rental cycle ROOT FIX: order placement creates Rental in pending_setup
  // ----------------------------------------------------------------

  describe('Rental order creates Rental row in pending_setup (cycle 5 ROOT FIX)', () => {
    it('placing an all-rental cart creates the Rental row linked to the order', async () => {
      const client = await seedUser({ role: UserRole.CLIENT });
      const rentalProduct = await seedProduct({
        name: `Rental RF ${Date.now()}`,
        pricingMode: 'rental',
        monthlyRentCents: 2000,
        lateFeeCents: 750,
        stripeProductId: 'prod_rf',
        stripePriceId: 'price_rf',
      });

      const order = await ordersService.create(asAuthUser(client), {
        items: [{ productId: rentalProduct.id, quantity: 1 }],
        paymentMethod: PaymentMethod.CASH,
        deliveryAddress: { text: 'Rental RF', lat: 40.7, lng: -74.0 },
      });
      createdOrderIds.push(order.id);

      const rentals = await dataSource
        .getRepository(Rental)
        .find({ where: { orderId: order.id } });
      expect(rentals).toHaveLength(1);
      expect(rentals[0].status).toBe(RentalStatus.PENDING_SETUP);
      expect(rentals[0].userId).toBe(client.id);
      expect(rentals[0].productId).toBe(rentalProduct.id);
      // pastDueSince + lastLateFeeAt should default to null on a fresh row
      expect(rentals[0].pastDueSince).toBeNull();
      expect(rentals[0].lastLateFeeAt).toBeNull();
    });
  });

  // ----------------------------------------------------------------
  // 5. RENTAL_ALREADY_ACTIVE conflict — structured code (FIX-5)
  // ----------------------------------------------------------------

  describe('RENTAL_ALREADY_ACTIVE returns structured code on second rental attempt', () => {
    it('rejects a second rental for the same user+product with code field', async () => {
      const client = await seedUser({ role: UserRole.CLIENT });
      const rental = await seedProduct({
        name: `Rental Dup ${Date.now()}`,
        pricingMode: 'rental',
        monthlyRentCents: 1500,
        lateFeeCents: 500,
        stripeProductId: 'prod_dup',
        stripePriceId: 'price_dup',
      });

      // First order succeeds + creates pending_setup rental
      const first = await ordersService.create(asAuthUser(client), {
        items: [{ productId: rental.id, quantity: 1 }],
        paymentMethod: PaymentMethod.CASH,
        deliveryAddress: { text: 'Dup 1', lat: 40.7, lng: -74.0 },
      });
      createdOrderIds.push(first.id);

      // Second order for the same product should be blocked
      try {
        await ordersService.create(asAuthUser(client), {
          items: [{ productId: rental.id, quantity: 1 }],
          paymentMethod: PaymentMethod.CASH,
          deliveryAddress: { text: 'Dup 2', lat: 40.7, lng: -74.0 },
        });
        throw new Error('Expected RENTAL_ALREADY_ACTIVE conflict');
      } catch (err) {
        const response = (err as { getResponse?: () => unknown }).getResponse?.();
        expect(response).toMatchObject({
          code: 'RENTAL_ALREADY_ACTIVE',
        });
      }
    });
  });

  // ----------------------------------------------------------------
  // 6. ACTIVE_RENTALS_EXIST conflict on product PATCH when rentals exist
  // ----------------------------------------------------------------

  describe('Switching rental product to single_payment with active rentals returns ACTIVE_RENTALS_EXIST', () => {
    it('rejects pricingMode change when active rentals exist with code field', async () => {
      const admin = await seedUser({ role: UserRole.SUPER_ADMIN_DELIVERY });
      const client = await seedUser({ role: UserRole.CLIENT });
      const rentalProduct = await seedProduct({
        name: `Rental AE ${Date.now()}`,
        pricingMode: 'rental',
        monthlyRentCents: 1500,
        lateFeeCents: 500,
        stripeProductId: 'prod_ae',
        stripePriceId: 'price_ae',
      });

      // Place an order that creates an active rental row
      const order = await ordersService.create(asAuthUser(client), {
        items: [{ productId: rentalProduct.id, quantity: 1 }],
        paymentMethod: PaymentMethod.CASH,
        deliveryAddress: { text: 'AE 1', lat: 40.7, lng: -74.0 },
      });
      createdOrderIds.push(order.id);

      // Admin tries to switch rental product to single_payment → 409 with code
      try {
        await productsService.update(rentalProduct.id, asAuthUser(admin), {
          pricingMode: 'single_payment',
        });
        throw new Error('Expected ACTIVE_RENTALS_EXIST conflict');
      } catch (err) {
        const response = (err as { getResponse?: () => unknown }).getResponse?.();
        expect(response).toMatchObject({
          code: 'ACTIVE_RENTALS_EXIST',
        });
      }
    });
  });

  // ----------------------------------------------------------------
  // 7. Promoter commissions accrue when referred client orders
  // ----------------------------------------------------------------

  describe('Promoter commission accrues when their referred client places an order', () => {
    it('client referred by promoter generates a commission entry on order placement', async () => {
      // referralCode is varchar(10) — keep it under 10 chars.
      const promoter = await seedUser({
        role: UserRole.PROMOTER,
        referralCode: `Q${Date.now().toString().slice(-7)}`,
      });
      const referred = await seedUser({
        role: UserRole.CLIENT,
        referredById: promoter.id,
      });
      const product = await seedProduct({
        priceToPublic: '10.00',
        promoterCommissionPct: '5.00',
      });

      const order = await ordersService.create(asAuthUser(referred), {
        items: [{ productId: product.id, quantity: 1 }],
        paymentMethod: PaymentMethod.CASH,
        deliveryAddress: { text: 'Promo flow', lat: 40.7, lng: -74.0 },
      });
      createdOrderIds.push(order.id);

      // Commissions accrue when the order is delivered (creditCommissionsForOrder
      // is invoked inside the markDelivered TX). Drive the order through the full
      // status pipeline so the commission entry is written.
      const admin = await seedUser({ role: UserRole.SUPER_ADMIN_DELIVERY });
      await ordersService.setQuote(order.id, 0, asAuthUser(admin));
      await ordersService.confirmCashOrder(order.id, asAuthUser(referred));
      for (const next of [
        OrderStatus.CONFIRMED_BY_COLMADO,
        OrderStatus.IN_DELIVERY_ROUTE,
        OrderStatus.DELIVERED,
      ]) {
        await ordersService.updateStatus(
          order.id,
          { status: next },
          asAuthUser(admin),
        );
      }

      const dashboard = await promotersService.getDashboardAsAdmin(promoter.id);
      expect(dashboard.referredCount).toBeGreaterThanOrEqual(1);
      // Some commission must have accrued (either pending or claimable).
      const totalAccrued =
        dashboard.balances.pendingCents +
        dashboard.balances.claimableCents +
        dashboard.balances.paidCents;
      expect(totalAccrued).toBeGreaterThan(0);
    });
  });

  // ----------------------------------------------------------------
  // 8. /auth/me-equivalent: services return the full user shape (FIX-1)
  // ----------------------------------------------------------------

  describe('CreditService.getMyCredit returns account+recentMovements (controller flattens for /me/credit)', () => {
    it('returns null account for a fresh user with no credit history', async () => {
      const client = await seedUser({ role: UserRole.CLIENT });
      const view = await creditService.getMyCredit(client.id);
      expect(view).toEqual({ account: null, recentMovements: [] });
    });

    it('returns the account once one is created via grantCredit', async () => {
      const client = await seedUser({ role: UserRole.CLIENT });
      const admin = await seedUser({ role: UserRole.SUPER_ADMIN_DELIVERY });
      // Open a credit account by granting credit
      await dataSource.getRepository(CreditAccount).save({
        userId: client.id,
        balanceCents: 0,
        creditLimitCents: 5000,
        dueDate: null,
        currency: 'usd',
      });
      await creditService.grantCredit(client.id, 1000, admin.id, 'Test grant');

      const view = await creditService.getMyCredit(client.id);
      expect(view.account).toBeTruthy();
      expect(view.account?.balanceCents).toBe(1000);
      expect(view.recentMovements.length).toBeGreaterThan(0);
    });
  });
});
