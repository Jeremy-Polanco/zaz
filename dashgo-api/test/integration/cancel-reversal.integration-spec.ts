/**
 * Cancel-reversal integration spec.
 *
 * Verifies the OrdersService.updateStatus(CANCELLED) TX reverses every
 * side effect that earlier transitions caused:
 *  - Credit: refund applied credit (covered partially by orders spec)
 *  - Points: restore claimable status of redeemed entries (FIX-5)
 *  - Stock: re-increment items when the order had been confirmed (FIX-5)
 *  - Rentals: cancel any pending_setup rentals tied to the order (FIX-5)
 *
 * These tests use committed DB writes; cleanup is manual in afterAll.
 */

// eslint-disable-next-line no-var
var mockStripe: {
  paymentIntents: { create: jest.Mock; retrieve: jest.Mock; cancel: jest.Mock; capture: jest.Mock };
  customers: { create: jest.Mock; search: jest.Mock; update: jest.Mock; list: jest.Mock };
  subscriptions: { create: jest.Mock; retrieve: jest.Mock; update: jest.Mock; list: jest.Mock };
  checkout: { sessions: { create: jest.Mock } };
  billingPortal: { sessions: { create: jest.Mock } };
  webhooks: { constructEvent: jest.Mock };
  prices: { retrieve: jest.Mock; create: jest.Mock; update: jest.Mock };
  products: { create: jest.Mock; update: jest.Mock };
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
  customers: { create: jest.fn(), search: jest.fn(), update: jest.fn(), list: jest.fn() },
  subscriptions: { create: jest.fn(), retrieve: jest.fn(), update: jest.fn(), list: jest.fn() },
  checkout: { sessions: { create: jest.fn() } },
  billingPortal: { sessions: { create: jest.fn() } },
  webhooks: { constructEvent: jest.fn() },
  prices: { retrieve: jest.fn(), create: jest.fn(), update: jest.fn() },
  products: { create: jest.fn(), update: jest.fn() },
};

import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createTestingApp } from '../../src/test-utils/testing-app';
import { makeUser } from '../../src/test-utils/fixtures';
import { OrdersService } from '../../src/modules/orders/orders.service';
import type { AuthenticatedUser } from '../../src/common/types/authenticated-user';
import { User } from '../../src/entities/user.entity';
import { Order } from '../../src/entities/order.entity';
import { Product } from '../../src/entities/product.entity';
import { Category } from '../../src/entities/category.entity';
import { CreditAccount } from '../../src/entities/credit-account.entity';
import {
  PointsLedgerEntry,
  PointsEntryType,
  PointsEntryStatus,
} from '../../src/entities/points-ledger-entry.entity';
import { Rental, RentalStatus } from '../../src/entities/rental.entity';
import {
  UserRole,
  OrderStatus,
  PaymentMethod,
} from '../../src/entities/enums';

const adminAs = (id = 'admin-cancelrev'): AuthenticatedUser => ({
  id,
  email: null,
  role: UserRole.SUPER_ADMIN_DELIVERY,
});

const clientAs = (id: string): AuthenticatedUser => ({
  id,
  email: null,
  role: UserRole.CLIENT,
});

describe('OrdersService cancel — full reversal', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let ordersService: OrdersService;
  const createdUserIds: string[] = [];
  const createdProductIds: string[] = [];
  const createdCategoryIds: string[] = [];

  beforeAll(async () => {
    app = await createTestingApp();
    dataSource = app.get(DataSource);
    ordersService = app.get(OrdersService);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      for (const userId of createdUserIds) {
        await dataSource.query('DELETE FROM rentals WHERE user_id = $1', [userId]);
        await dataSource.query(
          'DELETE FROM points_ledger_entries WHERE user_id = $1',
          [userId],
        );
        await dataSource.query(
          'DELETE FROM credit_movement WHERE credit_account_id = $1',
          [userId],
        );
        await dataSource.getRepository(Order).delete({ customerId: userId });
        await dataSource.query(
          'DELETE FROM credit_account WHERE user_id = $1',
          [userId],
        );
        await dataSource.getRepository(User).delete({ id: userId });
      }
      for (const id of createdProductIds) {
        await dataSource.getRepository(Product).delete({ id });
      }
      for (const id of createdCategoryIds) {
        await dataSource.getRepository(Category).delete({ id });
      }
    }
    if (app) await app.close();
  });

  async function seedCategory(): Promise<Category> {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const cat = await dataSource.getRepository(Category).save({
      name: `cancel-rev-${stamp}`,
      slug: `cancel-rev-${stamp}`,
      iconEmoji: '🧪',
      displayOrder: 999,
    } as unknown as Category);
    createdCategoryIds.push(cat.id);
    return cat;
  }

  async function seedProduct(
    category: Category,
    overrides: Partial<Product> = {},
  ): Promise<Product> {
    const product = await dataSource.getRepository(Product).save({
      name: `cancel-rev-prod-${Date.now()}`,
      description: 'test',
      categoryId: category.id,
      stock: 100,
      priceToPublic: '5.00',
      isAvailable: true,
      promoterCommissionPct: '0',
      pointsPct: '1.00',
      pricingMode: 'single_payment',
      monthlyRentCents: 0,
      lateFeeCents: 0,
      ...overrides,
    } as unknown as Product);
    createdProductIds.push(product.id);
    return product;
  }

  async function seedUserWithCredit(opts: {
    creditLimit?: number;
    balance?: number;
  } = {}): Promise<User> {
    const userData = makeUser({ role: UserRole.CLIENT });
    const user = await dataSource
      .getRepository(User)
      .save(userData as unknown as User);
    createdUserIds.push(user.id);
    await dataSource.getRepository(CreditAccount).save({
      userId: user.id,
      balanceCents: opts.balance ?? 0,
      creditLimitCents: opts.creditLimit ?? 1000,
      dueDate: null,
      currency: 'usd',
    } as unknown as CreditAccount);
    return user;
  }

  async function seedClaimablePoints(
    userId: string,
    amountCents: number,
  ): Promise<void> {
    await dataSource.getRepository(PointsLedgerEntry).save({
      userId,
      type: PointsEntryType.EARNED,
      status: PointsEntryStatus.CLAIMABLE,
      amountCents,
      orderId: null,
      claimableAt: new Date(),
      expiresAt: null,
    } as unknown as PointsLedgerEntry);
  }

  it('cancel restores points to claimable when an order used usePoints=true', async () => {
    const cat = await seedCategory();
    const product = await seedProduct(cat);
    const user = await seedUserWithCredit();
    await seedClaimablePoints(user.id, 200);

    const order = await ordersService.create(clientAs(user.id), {
      items: [{ productId: product.id, quantity: 1 }],
      paymentMethod: PaymentMethod.CASH,
      deliveryAddress: { text: 'Cancel-Rev St', lat: 40.7, lng: -74.0 },
      usePoints: true,
    });
    expect(order.pointsRedeemed).toBe('2.00');

    const beforeCancel = await dataSource
      .getRepository(PointsLedgerEntry)
      .find({ where: { userId: user.id } });
    const redeemedBefore = beforeCancel.filter(
      (e) =>
        e.type === PointsEntryType.EARNED &&
        e.status === PointsEntryStatus.REDEEMED,
    );
    expect(redeemedBefore.length).toBeGreaterThan(0);

    await ordersService.updateStatus(
      order.id,
      { status: OrderStatus.CANCELLED },
      adminAs(),
    );

    const after = await dataSource
      .getRepository(PointsLedgerEntry)
      .find({ where: { userId: user.id } });
    const stillRedeemed = after.filter(
      (e) =>
        e.type === PointsEntryType.EARNED &&
        e.status === PointsEntryStatus.REDEEMED,
    );
    expect(stillRedeemed.length).toBe(0);
    const claimable = after
      .filter(
        (e) =>
          e.type === PointsEntryType.EARNED &&
          e.status === PointsEntryStatus.CLAIMABLE,
      )
      .reduce((sum, e) => sum + e.amountCents, 0);
    expect(claimable).toBe(200);
    const redemptionRows = after.filter(
      (e) => e.type === PointsEntryType.REDEEMED,
    );
    expect(redemptionRows.length).toBe(0);
  });

  it('cancel restores stock when the order was already confirmed (decremented)', async () => {
    const cat = await seedCategory();
    const product = await seedProduct(cat, { stock: 50 });
    const user = await seedUserWithCredit();

    const order = await ordersService.create(clientAs(user.id), {
      items: [{ productId: product.id, quantity: 3 }],
      paymentMethod: PaymentMethod.CASH,
      deliveryAddress: { text: 'Stock St', lat: 40.7, lng: -74.0 },
    });

    const admin = adminAs('admin-stock');
    await ordersService.setQuote(order.id, 0, admin);
    await ordersService.confirmCashOrder(order.id, clientAs(user.id));
    await ordersService.updateStatus(
      order.id,
      { status: OrderStatus.CONFIRMED_BY_COLMADO },
      admin,
    );

    const afterConfirm = await dataSource
      .getRepository(Product)
      .findOne({ where: { id: product.id } });
    expect(afterConfirm?.stock).toBe(47);

    await ordersService.updateStatus(
      order.id,
      { status: OrderStatus.CANCELLED },
      admin,
    );

    const afterCancel = await dataSource
      .getRepository(Product)
      .findOne({ where: { id: product.id } });
    expect(afterCancel?.stock).toBe(50);
  });

  it('cancel does NOT increment stock when the order was never confirmed', async () => {
    const cat = await seedCategory();
    const product = await seedProduct(cat, { stock: 50 });
    const user = await seedUserWithCredit();

    const order = await ordersService.create(clientAs(user.id), {
      items: [{ productId: product.id, quantity: 2 }],
      paymentMethod: PaymentMethod.CASH,
      deliveryAddress: { text: 'No-confirm St', lat: 40.7, lng: -74.0 },
    });

    await ordersService.updateStatus(
      order.id,
      { status: OrderStatus.CANCELLED },
      adminAs('admin-stk2'),
    );

    const final = await dataSource
      .getRepository(Product)
      .findOne({ where: { id: product.id } });
    expect(final?.stock).toBe(50);
  });

  it('cancel flips pending_setup rentals to canceled', async () => {
    const cat = await seedCategory();
    const rentalProduct = await seedProduct(cat, {
      stock: 10,
      pricingMode: 'rental',
      monthlyRentCents: 1500,
      lateFeeCents: 500,
      stripeProductId: 'prod_cancel_test',
      stripePriceId: 'price_cancel_test',
    });
    const user = await seedUserWithCredit();

    const order = await ordersService.create(clientAs(user.id), {
      items: [{ productId: rentalProduct.id, quantity: 1 }],
      paymentMethod: PaymentMethod.CASH,
      deliveryAddress: { text: 'Rental Cancel', lat: 40.7, lng: -74.0 },
    });

    const before = await dataSource
      .getRepository(Rental)
      .findOne({ where: { orderId: order.id } });
    expect(before?.status).toBe(RentalStatus.PENDING_SETUP);

    await ordersService.updateStatus(
      order.id,
      { status: OrderStatus.CANCELLED },
      adminAs('admin-rent'),
    );

    const after = await dataSource
      .getRepository(Rental)
      .findOne({ where: { orderId: order.id } });
    expect(after?.status).toBe(RentalStatus.CANCELED);
    expect(after?.canceledAt).toBeTruthy();
  });

  it('second cancel of an already-cancelled order is rejected (transition not allowed)', async () => {
    const cat = await seedCategory();
    const product = await seedProduct(cat);
    const user = await seedUserWithCredit();

    const order = await ordersService.create(clientAs(user.id), {
      items: [{ productId: product.id, quantity: 1 }],
      paymentMethod: PaymentMethod.CASH,
      deliveryAddress: { text: 'Idem St', lat: 40.7, lng: -74.0 },
    });
    const admin = adminAs('admin-idem');
    await ordersService.updateStatus(
      order.id,
      { status: OrderStatus.CANCELLED },
      admin,
    );
    await expect(
      ordersService.updateStatus(
        order.id,
        { status: OrderStatus.CANCELLED },
        admin,
      ),
    ).rejects.toThrow();
  });
});
