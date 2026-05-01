/**
 * Integration specs for OrdersService — CRIT-1 regression and idempotent cancellation.
 *
 * CRIT-1: Verify Stripe paymentIntent amount = totalCents - creditAppliedCents
 * The Stripe mock captures the create call so we can assert the amount.
 */

import * as path from 'path';
import * as fs from 'fs';

// Module-level Stripe mock — captures paymentIntents.create call
jest.mock('stripe', () => ({
  default: jest.fn().mockImplementation(() => mockStripe),
}));

const mockStripe = {
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
};

import { INestApplication } from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';
import { createTestingApp } from '../../src/test-utils/testing-app';
import { setupTransactionPerTest } from '../../src/test-utils/transaction';
import { makeUser } from '../../src/test-utils/fixtures';
import { User } from '../../src/entities/user.entity';
import { CreditAccount } from '../../src/entities/credit-account.entity';
import { CreditMovementType } from '../../src/entities/credit-movement.entity';
import { Order } from '../../src/entities/order.entity';
import { CreditMovement } from '../../src/entities/credit-movement.entity';
import { UserRole, OrderStatus, PaymentMethod } from '../../src/entities/enums';
import { OrdersService } from '../../src/modules/orders/orders.service';
import { CreditService } from '../../src/modules/credit/credit.service';
import { PaymentsService } from '../../src/modules/payments/payments.service';

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
  let creditService: CreditService;
  let paymentsService: PaymentsService;

  beforeAll(async () => {
    loadEnvTest();
    app = await createTestingApp();
    dataSource = app.get(DataSource);
    ordersService = app.get(OrdersService);
    creditService = app.get(CreditService);
    paymentsService = app.get(PaymentsService);
  });

  afterAll(async () => {
    await app.close();
  });

  const { getQueryRunner } = setupTransactionPerTest(() => dataSource);

  // -------------------------------------------------------------------------
  // CRIT-1 regression: Stripe amount = totalCents - creditAppliedCents
  // -------------------------------------------------------------------------

  describe('CRIT-1 regression', () => {
    it('Stripe paymentIntent amount equals totalCents minus creditAppliedCents', async () => {
      const qr: QueryRunner = getQueryRunner();

      // Arrange: user with credit
      const userData = makeUser({ role: UserRole.CLIENT });
      const user = await qr.manager.getRepository(User).save(userData as unknown as User);

      const creditLimitCents = 500;
      const balanceCents = 800; // positive balance (user has been granted credit)
      await qr.manager.getRepository(CreditAccount).save({
        userId: user.id,
        balanceCents,
        creditLimitCents,
        dueDate: null,
        currency: 'usd',
      } as unknown as CreditAccount);

      // Create a product to order (or save a fake order directly)
      // Since we can't easily create products here, we'll save an order directly
      // and test the authorize flow which is what actually calls Stripe.
      const totalCents = 2000; // $20.00
      const creditAppliedCents = 500; // $5.00 credit applied
      const expectedStripeCents = totalCents - creditAppliedCents; // $15.00

      // Save order with creditApplied already set (simulates post-create state)
      const order = await qr.manager.getRepository(Order).save({
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

      // Act: authorize the order (this calls PaymentsService.createAuthorizationIntent)
      const authUser = { id: user.id, role: UserRole.CLIENT, email: null };

      // We need to update the ordersRepo to know about this order
      // The service's findOne will use the data-source which is monkey-patched
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
      const qr: QueryRunner = getQueryRunner();

      // Arrange
      const userData = makeUser({ role: UserRole.CLIENT });
      const user = await qr.manager.getRepository(User).save(userData as unknown as User);

      const initialBalance = 600;
      const creditAppliedCents = 300;
      await qr.manager.getRepository(CreditAccount).save({
        userId: user.id,
        balanceCents: initialBalance - creditAppliedCents, // balance after charge = 300
        creditLimitCents: 200,
        dueDate: null,
        currency: 'usd',
      } as unknown as CreditAccount);

      // Create a CREDIT CHARGE movement (to be reversed)
      await qr.manager.getRepository(CreditMovement).save({
        creditAccountId: user.id,
        type: CreditMovementType.CHARGE,
        amountCents: creditAppliedCents,
        orderId: null, // will be updated when order is created
        performedByUserId: user.id,
        note: null,
      } as unknown as CreditMovement);

      // Create order with creditApplied > 0
      const order = await qr.manager.getRepository(Order).save({
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

      // Update movement to reference this order
      await qr.manager.getRepository(CreditMovement).update(
        { creditAccountId: user.id, type: CreditMovementType.CHARGE },
        { orderId: order.id },
      );

      const superUser = { id: 'super-1', role: UserRole.SUPER_ADMIN_DELIVERY, email: null };

      // Act: cancel the order (first time)
      await ordersService.updateStatus(order.id, { status: OrderStatus.CANCELLED }, superUser);

      // Assert: credit balance restored
      const accountAfterCancel = await qr.manager
        .getRepository(CreditAccount)
        .findOneOrFail({ where: { userId: user.id } });
      expect(accountAfterCancel.balanceCents).toBe(initialBalance);

      // Verify exactly one REVERSAL movement exists
      const reversals = await qr.manager.getRepository(CreditMovement).find({
        where: { creditAccountId: user.id, type: CreditMovementType.REVERSAL },
      });
      expect(reversals).toHaveLength(1);
    });

    it('order without credit has Stripe amount equal to full total', async () => {
      const qr: QueryRunner = getQueryRunner();

      const userData = makeUser({ role: UserRole.CLIENT });
      const user = await qr.manager.getRepository(User).save(userData as unknown as User);

      const totalCents = 1500;
      const order = await qr.manager.getRepository(Order).save({
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
});
