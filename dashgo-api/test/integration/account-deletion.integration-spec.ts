/**
 * Integration spec: AuthService.deleteAccount — real Postgres (Docker, 5433).
 *
 * Reproduces the production report "no se puede eliminar usuarios (mobile/web)".
 * Both clients hit the same service:
 *   - mobile/web self-service → DELETE /auth/me  → AuthService.deleteAccount
 *   - super-admin panel       → DELETE /users/:id → UsersService.deleteByAdmin
 *                                                   → AuthService.deleteAccount
 *
 * The unit specs mock every repository, so a real FK / ordering violation is
 * invisible there. This spec seeds a REALISTIC user (the rows a live customer
 * actually accumulates) and runs the deletion against a migrated schema.
 */

// ---------------------------------------------------------------------------
// Stripe module mock — hoisted before any import that loads stripe.
// ---------------------------------------------------------------------------
// `mockStripeCustomerDel` is shared with the tests below so a spec can make
// Stripe reject. Jest only allows out-of-scope variables in a mock factory
// when the name starts with "mock".
const mockStripeCustomerDel = jest.fn().mockResolvedValue({ deleted: true });

jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    paymentIntents: {
      create: jest.fn(),
      retrieve: jest.fn(),
      cancel: jest.fn(),
      capture: jest.fn(),
    },
    webhooks: { constructEvent: jest.fn() },
    customers: {
      create: jest.fn(),
      search: jest.fn().mockResolvedValue({ data: [] }),
      update: jest.fn(),
      list: jest.fn(),
      del: mockStripeCustomerDel,
    },
    subscriptions: {
      create: jest.fn(),
      retrieve: jest.fn(),
      update: jest.fn(),
      list: jest.fn(),
    },
    checkout: { sessions: { create: jest.fn() } },
    billingPortal: { sessions: { create: jest.fn() } },
    prices: { retrieve: jest.fn(), create: jest.fn(), update: jest.fn() },
    products: { update: jest.fn() },
  }));
});

import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createTestingApp } from '../../src/test-utils/testing-app';
import { makeOrder, makeUser } from '../../src/test-utils/fixtures';
import { issueTestToken } from '../e2e/helpers/auth.helper';
import { AuthService } from '../../src/modules/auth/auth.service';
import {
  Category,
  CreditAccount,
  CreditMovement,
  Order,
  OrderItem,
  Payout,
  PointsLedgerEntry,
  Product,
  CommissionEntry,
  PushToken,
  Rental,
  Subscription,
  User,
  UserAddress,
} from '../../src/entities';
import { OrderStatus, UserRole } from '../../src/entities/enums';
import { RentalStatus } from '../../src/entities/rental.entity';
import { CreditMovementType } from '../../src/entities/credit-movement.entity';
import {
  PointsEntryStatus,
  PointsEntryType,
} from '../../src/entities/points-ledger-entry.entity';
import {
  CommissionEntryStatus,
  CommissionEntryType,
} from '../../src/entities/commission-entry.entity';
import { SubscriptionStatus } from '../../src/entities/subscription.entity';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');

describe('AuthService.deleteAccount (integration)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let auth: AuthService;
  let product: Product;
  let categoryId: string;

  // The integration project runs every spec against ONE shared database, so a
  // suite that leaves rows behind corrupts whatever runs after it. Deletion
  // makes this sharper than usual: anonymized orders survive on purpose with
  // customer_id = NULL, so they can no longer be found via their user. Track
  // the ids as we create them and clean up explicitly.
  const createdOrderIds: string[] = [];
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    process.env.DB_HOST = 'localhost';
    process.env.DB_PORT = '5433';
    process.env.DB_USER = 'dashgo_test';
    process.env.DB_PASSWORD = 'dashgo_test';
    process.env.DB_NAME = 'dashgo_test';
    process.env.STRIPE_SECRET_KEY =
      process.env.STRIPE_SECRET_KEY ?? 'sk_test_dummy_integration';

    app = await createTestingApp();
    ds = app.get(DataSource);
    auth = app.get(AuthService);

    // Unique names/slugs — `categories.name`, `categories.slug` and product
    // lookups are shared with every other suite on this database.
    const suffix = process.pid;
    const category = await ds.getRepository(Category).save(
      ds.getRepository(Category).create({
        name: `Agua (del-test ${suffix})`,
        slug: `agua-del-test-${suffix}`,
        displayOrder: 1,
      }),
    );
    categoryId = category.id;
    product = await ds.getRepository(Product).save(
      ds.getRepository(Product).create({
        name: `Botellón 5 galones (del-test ${suffix})`,
        priceToPublic: '50.00',
        stock: 100,
        categoryId: category.id,
      } as Partial<Product>),
    );
  });

  afterAll(async () => {
    if (ds?.isInitialized) {
      // FK-safe order: order_items cascade from orders; the users are already
      // gone in most tests, but the leftover promoters/admins are not.
      for (const orderId of createdOrderIds) {
        await ds.getRepository(Order).delete({ id: orderId });
      }
      for (const userId of createdUserIds) {
        await ds.getRepository(Payout).delete({ earnerId: userId });
        await ds.getRepository(User).delete({ id: userId });
      }
      await ds.getRepository(Product).delete({ id: product.id });
      await ds.getRepository(Category).delete({ id: categoryId });
    }
    if (app) await app.close();
  });

  /** Creates a user and registers it for afterAll cleanup. */
  async function createUser(role: UserRole, fullName?: string): Promise<User> {
    const userRepo = ds.getRepository(User);
    const user = await userRepo.save(
      userRepo.create(
        makeUser(fullName ? { role, fullName } : { role }) as Partial<User>,
      ),
    );
    createdUserIds.push(user.id);
    return user;
  }

  /**
   * Seeds the row set a real customer accumulates: saved address (selected as
   * active location), a delivered order with items, and a push token from the
   * mobile app.
   */
  async function seedCustomer(): Promise<User> {
    const userRepo = ds.getRepository(User);
    const user = await createUser(UserRole.CLIENT);

    const address = await ds.getRepository(UserAddress).save(
      ds.getRepository(UserAddress).create({
        userId: user.id,
        label: 'Casa',
        line1: 'Calle Principal 10',
        lat: 18.48,
        lng: -69.9,
        isDefault: true,
      }),
    );
    // The customer picked this address — users.active_location_id now points at it.
    await userRepo.update(user.id, { activeLocationId: address.id });

    const order = await ds.getRepository(Order).save(
      ds.getRepository(Order).create(
        makeOrder({
          customerId: user.id,
          status: OrderStatus.DELIVERED,
        }) as Partial<Order>,
      ),
    );
    // Anonymized orders outlive their user — remember the id or it leaks.
    createdOrderIds.push(order.id);
    await ds.getRepository(OrderItem).save(
      ds.getRepository(OrderItem).create({
        orderId: order.id,
        productId: product.id,
        quantity: 2,
        priceAtOrder: '50.00',
      } as Partial<OrderItem>),
    );

    await ds.getRepository(PushToken).save(
      ds.getRepository(PushToken).create({
        userId: user.id,
        token: `ExponentPushToken[${user.id.slice(0, 8)}]`,
        platform: 'ios',
      }),
    );

    return userRepo.findOneOrFail({ where: { id: user.id } });
  }

  it('deletes a customer that has orders, a saved address and a push token', async () => {
    const user = await seedCustomer();

    await expect(auth.deleteAccount(user.id)).resolves.toBeUndefined();

    const stillThere = await ds
      .getRepository(User)
      .findOne({ where: { id: user.id } });
    expect(stillThere).toBeNull();
  });

  it('anonymizes the retained order instead of deleting it', async () => {
    const user = await seedCustomer();
    const orderId = (
      await ds.getRepository(Order).findOneOrFail({
        where: { customerId: user.id },
      })
    ).id;

    await auth.deleteAccount(user.id);

    const order = await ds
      .getRepository(Order)
      .findOneOrFail({ where: { id: orderId } });
    expect(order.customerId).toBeNull();
    expect(order.customerNameSnapshot).toBe('Cuenta eliminada');
    expect(order.customerPhoneSnapshot).toBeNull();
  });

  it('deletes a customer with subscription, credit, points and referrals', async () => {
    const user = await seedCustomer();
    const promoter = await createUser(UserRole.PROMOTER);
    await ds.getRepository(User).update(user.id, { referredById: promoter.id });

    await ds.getRepository(Subscription).save(
      ds.getRepository(Subscription).create({
        userId: user.id,
        status: SubscriptionStatus.ACTIVE,
        stripeSubscriptionId: `sub_${user.id.slice(0, 8)}`,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
      } as Partial<Subscription>),
    );

    const creditRepo = ds.getRepository(CreditAccount);
    await creditRepo.save(
      creditRepo.create({
        userId: user.id,
        balanceCents: 2500,
        creditLimitCents: 10000,
      } as Partial<CreditAccount>),
    );
    await ds.getRepository(CreditMovement).save(
      ds.getRepository(CreditMovement).create({
        creditAccountId: user.id,
        type: CreditMovementType.CHARGE,
        amountCents: 2500,
        performedByUserId: promoter.id,
      } as Partial<CreditMovement>),
    );

    await ds.getRepository(PointsLedgerEntry).save(
      ds.getRepository(PointsLedgerEntry).create({
        userId: user.id,
        type: PointsEntryType.EARNED,
        status: PointsEntryStatus.CLAIMABLE,
        amountCents: 1000,
      } as Partial<PointsLedgerEntry>),
    );

    // The promoter earned a commission for referring this user.
    await ds.getRepository(CommissionEntry).save(
      ds.getRepository(CommissionEntry).create({
        earnerId: promoter.id,
        referredUserId: user.id,
        type: CommissionEntryType.EARNED,
        status: CommissionEntryStatus.CLAIMABLE,
        amountCents: 500,
      } as Partial<CommissionEntry>),
    );

    await expect(auth.deleteAccount(user.id)).resolves.toBeUndefined();
    expect(
      await ds.getRepository(User).findOne({ where: { id: user.id } }),
    ).toBeNull();
    // The promoter's commission row survives with the referral nulled.
    const entry = await ds
      .getRepository(CommissionEntry)
      .findOneOrFail({ where: { earnerId: promoter.id } });
    expect(entry.referredUserId).toBeNull();
  });

  it('DELETE /auth/me returns 204 for a logged-in customer', async () => {
    const user = await seedCustomer();
    const token = await issueTestToken(app, user.id, UserRole.CLIENT);

    await request(app.getHttpServer())
      .delete('/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(204);

    expect(
      await ds.getRepository(User).findOne({ where: { id: user.id } }),
    ).toBeNull();
  });

  /**
   * Stripe cleanup runs after the DB transaction commits. A Stripe outage,
   * a rate limit, or a restricted key without customer-write permission must
   * not turn a completed deletion into a 500 — the account is already gone,
   * and reporting failure sends the operator into a retry that 404s.
   */
  it('DELETE /auth/me returns 204 even when Stripe cleanup fails', async () => {
    const user = await seedCustomer();
    await ds
      .getRepository(User)
      .update(user.id, { stripeCustomerId: `cus_${user.id.slice(0, 8)}` });
    mockStripeCustomerDel.mockRejectedValueOnce(
      Object.assign(new Error('Insufficient permissions'), {
        code: 'api_key_expired',
      }),
    );
    const token = await issueTestToken(app, user.id, UserRole.CLIENT);

    await request(app.getHttpServer())
      .delete('/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(204);

    expect(mockStripeCustomerDel).toHaveBeenCalled();
    expect(
      await ds.getRepository(User).findOne({ where: { id: user.id } }),
    ).toBeNull();
  });

  it('DELETE /users/:id lets a super admin delete a customer', async () => {
    const user = await seedCustomer();
    const admin = await createUser(UserRole.SUPER_ADMIN_DELIVERY);
    const token = await issueTestToken(
      app,
      admin.id,
      UserRole.SUPER_ADMIN_DELIVERY,
    );

    await request(app.getHttpServer())
      .delete(`/users/${user.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);

    expect(
      await ds.getRepository(User).findOne({ where: { id: user.id } }),
    ).toBeNull();
  });

  it('deletes a promoter that has referrals, commissions and payouts', async () => {
    const promoter = await createUser(UserRole.PROMOTER);
    const referred = await seedCustomer();
    await ds
      .getRepository(User)
      .update(referred.id, { referredById: promoter.id });

    const admin = await createUser(UserRole.SUPER_ADMIN_DELIVERY);
    const payout = await ds.getRepository(Payout).save(
      ds.getRepository(Payout).create({
        earnerId: promoter.id,
        createdByUserId: admin.id,
        amountCents: 2500,
      } as Partial<Payout>),
    );
    await ds.getRepository(CommissionEntry).save(
      ds.getRepository(CommissionEntry).create({
        earnerId: promoter.id,
        referredUserId: referred.id,
        type: CommissionEntryType.PAID_OUT,
        status: CommissionEntryStatus.PAID,
        amountCents: 500,
        payoutId: payout.id,
      } as Partial<CommissionEntry>),
    );

    await expect(auth.deleteAccount(promoter.id)).resolves.toBeUndefined();
    // The referred customer survives with the referral link nulled.
    const stillReferred = await ds
      .getRepository(User)
      .findOneOrFail({ where: { id: referred.id } });
    expect(stillReferred.referredById).toBeNull();
  });

  it('deletes an admin that issued payouts, snapshotting their name', async () => {
    const admin = await createUser(UserRole.SUPER_ADMIN_DELIVERY, 'Admin Uno');
    const promoter = await createUser(UserRole.PROMOTER);
    const payout = await ds.getRepository(Payout).save(
      ds.getRepository(Payout).create({
        earnerId: promoter.id,
        createdByUserId: admin.id,
        amountCents: 2500,
      } as Partial<Payout>),
    );

    await expect(auth.deleteAccount(admin.id)).resolves.toBeUndefined();

    const kept = await ds
      .getRepository(Payout)
      .findOneOrFail({ where: { id: payout.id } });
    expect(kept.createdByUserId).toBeNull();
    expect(kept.createdByNameSnapshot).toBe('Admin Uno');
  });

  it('deletes a user with no phone on record', async () => {
    const userRepo = ds.getRepository(User);
    const user = await userRepo.save(
      userRepo.create(
        makeUser({ phone: null, email: null }) as unknown as Partial<User>,
      ),
    );
    createdUserIds.push(user.id);

    await expect(auth.deleteAccount(user.id)).resolves.toBeUndefined();
  });

  it('deletes a customer that also has an active rental', async () => {
    const user = await seedCustomer();
    const order = await ds
      .getRepository(Order)
      .findOneOrFail({ where: { customerId: user.id } });
    await ds.getRepository(Rental).save(
      ds.getRepository(Rental).create({
        userId: user.id,
        productId: product.id,
        orderId: order.id,
        status: RentalStatus.ACTIVE,
        stripePriceId: 'price_test_rental',
        monthlyRentCents: 1000,
        lateFeeCents: 500,
      } as Partial<Rental>),
    );

    await expect(auth.deleteAccount(user.id)).resolves.toBeUndefined();
    expect(
      await ds.getRepository(User).findOne({ where: { id: user.id } }),
    ).toBeNull();
  });
});
