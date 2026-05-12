/**
 * Integration specs for CreditService.
 *
 * Runs against a real Postgres instance (Docker on port 5433).
 * Per-test transaction rollback via setupTransactionPerTest().
 *
 * Tags:
 *   @concurrency — run with `npm run test:concurrency` (--runInBand) to avoid
 *                  false positives from parallel connections.
 */

// Module-level Stripe mock — CreditService doesn't call Stripe directly
// but PaymentsService (which may be in the DI graph via OrdersService) does.
// MUST return the constructor directly (not { default: fn }) because the service
// uses `import Stripe = require('stripe')` (CJS interop).
jest.mock('stripe', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return jest.fn().mockImplementation(() => ({
    paymentIntents: {
      create: jest.fn().mockResolvedValue({ id: 'pi_test', client_secret: 'secret', status: 'requires_payment_method', amount: 1000, currency: 'usd' }),
      retrieve: jest.fn(),
      cancel: jest.fn(),
      capture: jest.fn(),
    },
    webhooks: { constructEvent: jest.fn() },
    customers: { create: jest.fn(), search: jest.fn().mockResolvedValue({ data: [] }), update: jest.fn(), list: jest.fn() },
    subscriptions: { create: jest.fn(), retrieve: jest.fn(), update: jest.fn(), list: jest.fn() },
    checkout: { sessions: { create: jest.fn().mockResolvedValue({ url: 'https://stripe.test/session' }) } },
    billingPortal: { sessions: { create: jest.fn().mockResolvedValue({ url: 'https://stripe.test/portal' }) } },
    prices: { retrieve: jest.fn(), create: jest.fn(), update: jest.fn() },
    products: { update: jest.fn() },
  }));
});

import * as path from 'path';
import * as fs from 'fs';
import { INestApplication } from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';
import { createTestingApp } from '../../src/test-utils/testing-app';
import { setupTransactionPerTest } from '../../src/test-utils/transaction';
import { makeCreditAccount, makeUser } from '../../src/test-utils/fixtures';
import { CreditAccount } from '../../src/entities/credit-account.entity';
import { CreditMovementType } from '../../src/entities/credit-movement.entity';
import { User } from '../../src/entities/user.entity';
import { UserRole } from '../../src/entities/enums';
import { CreditService } from '../../src/modules/credit/credit.service';

// Load .env.test before app bootstrap
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

describe('CreditService (integration)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let creditService: CreditService;

  beforeAll(async () => {
    loadEnvTest();
    app = await createTestingApp();
    dataSource = app.get(DataSource);
    creditService = app.get(CreditService);
  });

  afterAll(async () => {
    await app.close();
  });

  // -------------------------------------------------------------------------
  // Balance correctness — basic charge + reversal idempotency
  //
  // setupTransactionPerTest is scoped to THIS describe block only, so its
  // beforeEach/afterEach hooks do NOT apply to the @concurrency describe below.
  // -------------------------------------------------------------------------

  describe('applyCharge and reverseCharge', () => {
    // Transaction-per-test rollback: scoped to this describe only.
    const { getQueryRunner } = setupTransactionPerTest(() => dataSource);

    it('charges balance and reversal restores it exactly once', async () => {
      const qr: QueryRunner = getQueryRunner();

      // Arrange: save a user and credit account
      const userData = makeUser({ role: UserRole.CLIENT });
      const savedUser = await qr.manager.getRepository(User).save(userData as unknown as User);

      const acctData = makeCreditAccount({ userId: savedUser.id, balanceCents: 500, creditLimitCents: 200 });
      await qr.manager.getRepository(CreditAccount).save(acctData as unknown as CreditAccount);

      // We need an order ID for the charge — save a minimal order
      const { Order } = await import('../../src/entities/order.entity');
      const { OrderStatus, PaymentMethod } = await import('../../src/entities/enums');
      const orderRepo = qr.manager.getRepository(Order);
      const order = await orderRepo.save({
        customerId: savedUser.id,
        status: OrderStatus.PENDING_QUOTE,
        deliveryAddress: { text: 'Integration Test St' },
        subtotal: '5.00',
        pointsRedeemed: '0.00',
        shipping: '0.00',
        tax: '0.00',
        taxRate: '0.08887',
        totalAmount: '5.00',
        creditApplied: '0.00',
        paymentMethod: PaymentMethod.CASH,
      } as unknown as InstanceType<typeof Order>);

      // Act: apply charge using the query runner manager (monkey-patched ds.manager)
      await creditService.applyCharge(
        { userId: savedUser.id, orderId: order.id, amountCents: 300 },
        qr.manager,
      );

      // Assert: balance should be 500 - 300 = 200
      const afterCharge = await qr.manager
        .getRepository(CreditAccount)
        .findOneOrFail({ where: { userId: savedUser.id } });
      expect(afterCharge.balanceCents).toBe(200);

      // Update order to reflect credit applied
      await orderRepo.update(order.id, { creditApplied: '3.00' });

      // Act: reverse charge — uses its own TX internally
      // For integration test we call reverseCharge with the qr.manager
      await creditService.reverseCharge(order.id, qr.manager);

      // Assert: balance restored to original
      const afterReversal = await qr.manager
        .getRepository(CreditAccount)
        .findOneOrFail({ where: { userId: savedUser.id } });
      expect(afterReversal.balanceCents).toBe(500);

      // Act: call reverseCharge a second time (idempotency test)
      const secondResult = await creditService.reverseCharge(order.id, qr.manager);
      expect(secondResult).toBeNull(); // idempotent — no second reversal

      // Assert: balance still 500
      const afterSecondReversal = await qr.manager
        .getRepository(CreditAccount)
        .findOneOrFail({ where: { userId: savedUser.id } });
      expect(afterSecondReversal.balanceCents).toBe(500);
    });
  });

  // -------------------------------------------------------------------------
  // Concurrency — pessimistic lock prevents over-charge
  //
  // @concurrency — run with npm run test:concurrency (--runInBand)
  // -------------------------------------------------------------------------

  describe('@concurrency concurrent applyCharge calls', () => {
    it('final balance is mathematically consistent after two parallel charges', async () => {
      // This test does NOT use the per-test transaction rollback because
      // concurrent connections require separate transactions.
      // We use the test DB directly and clean up manually.
      const { User: UserEntity } = await import('../../src/entities/user.entity');
      const { CreditAccount: CreditAccountEntity } = await import(
        '../../src/entities/credit-account.entity'
      );

      const userRepo = dataSource.getRepository(UserEntity);
      const acctRepo = dataSource.getRepository(CreditAccountEntity);

      // Create a fresh user + account for this test (outside any rolled-back TX)
      const user = await userRepo.save({
        fullName: 'Concurrency Test User',
        email: `concurrency-${Date.now()}@test.example`,
        phone: null,
        role: UserRole.CLIENT,
        stripeCustomerId: null,
        referralCode: null,
        referredById: null,
        addressDefault: null,
      } as unknown as InstanceType<typeof UserEntity>);

      const initialBalance = 1000;
      await acctRepo.save({
        userId: user.id,
        balanceCents: initialBalance,
        creditLimitCents: 500,
        dueDate: null,
        currency: 'usd',
      } as unknown as InstanceType<typeof CreditAccountEntity>);

      const { Order: OrderEntity } = await import('../../src/entities/order.entity');
      const { OrderStatus: OS, PaymentMethod: PM } = await import('../../src/entities/enums');
      const orderRepo2 = dataSource.getRepository(OrderEntity);

      // Create two orders for the two concurrent charges
      const [order1, order2] = await Promise.all([
        orderRepo2.save({
          customerId: user.id,
          status: OS.PENDING_QUOTE,
          deliveryAddress: { text: 'Test' },
          subtotal: '3.00', pointsRedeemed: '0.00', shipping: '0.00',
          tax: '0.00', taxRate: '0.08887', totalAmount: '3.00',
          creditApplied: '0.00', paymentMethod: PM.CASH,
        } as unknown as InstanceType<typeof OrderEntity>),
        orderRepo2.save({
          customerId: user.id,
          status: OS.PENDING_QUOTE,
          deliveryAddress: { text: 'Test' },
          subtotal: '2.00', pointsRedeemed: '0.00', shipping: '0.00',
          tax: '0.00', taxRate: '0.08887', totalAmount: '2.00',
          creditApplied: '0.00', paymentMethod: PM.CASH,
        } as unknown as InstanceType<typeof OrderEntity>),
      ]);

      // Run two parallel charge calls. Because applyCharge uses pessimistic_write
      // locking, one will wait for the other to complete, ensuring consistency.
      const charge1 = dataSource.transaction(async (tx) =>
        creditService.applyCharge({ userId: user.id, orderId: order1.id, amountCents: 300 }, tx),
      );
      const charge2 = dataSource.transaction(async (tx) =>
        creditService.applyCharge({ userId: user.id, orderId: order2.id, amountCents: 200 }, tx),
      );

      // Both should succeed (total = 500, available = 1000 + 500 = 1500)
      const results = await Promise.allSettled([charge1, charge2]);
      const succeeded = results.filter((r) => r.status === 'fulfilled');
      expect(succeeded.length).toBeGreaterThanOrEqual(1);

      // Reload final balance
      const finalAccount = await acctRepo.findOneOrFail({ where: { userId: user.id } });
      const totalCharged = succeeded.reduce((sum, r) => {
        const mv = (r as PromiseFulfilledResult<{ amountCents: number }>).value;
        return sum + mv.amountCents;
      }, 0);

      // Final balance must equal initialBalance - sum of successful charges
      expect(finalAccount.balanceCents).toBe(initialBalance - totalCharged);

      // Cleanup
      await orderRepo2.delete({ customerId: user.id });
      await acctRepo.delete({ userId: user.id });
      await userRepo.delete({ id: user.id });
    });
  });
});
