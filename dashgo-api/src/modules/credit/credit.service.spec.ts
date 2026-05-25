/**
 * Unit specs for CreditService.
 *
 * All TypeORM repositories and DataSource are mocked. No real DB connection.
 * Pattern: AAA (Arrange-Act-Assert) with one behaviour per it() block.
 */

import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, EntityManager, QueryRunner, Repository } from 'typeorm';
import { CreditService } from './credit.service';
import {
  CreditAccount,
  CreditMovement,
  CreditMovementType,
  Order,
} from '../../entities';

// ---------------------------------------------------------------------------
// Helpers — build a minimal fake account / movement
// ---------------------------------------------------------------------------

function fakeAccount(
  overrides: Partial<CreditAccount> = {},
): CreditAccount {
  return {
    userId: 'user-1',
    balanceCents: 500,
    creditLimitCents: 200,
    dueDate: null,
    currency: 'usd',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    user: {} as never,
    ...overrides,
  };
}

function fakeMovement(
  overrides: Partial<CreditMovement> = {},
): CreditMovement {
  return {
    id: 'mv-1',
    creditAccountId: 'user-1',
    type: CreditMovementType.CHARGE,
    amountCents: 100,
    orderId: 'order-1',
    performedByUserId: null,
    note: null,
    stripePaymentIntentId: null,
    createdAt: new Date(),
    creditAccount: {} as never,
    order: null,
    performedBy: null,
    ...overrides,
  };
}

function fakeOrder(
  overrides: Partial<Order> = {},
): Order {
  return {
    id: 'order-1',
    customerId: 'user-1',
    status: 'pending_quote' as never,
    deliveryAddress: { text: '123 Test' },
    subtotal: '10.00',
    pointsRedeemed: '0.00',
    shipping: '0.00',
    tax: '0.00',
    taxRate: '0.08887',
    totalAmount: '10.00',
    creditApplied: '1.00',
    paymentMethod: 'cash' as never,
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
// Mock setup
// ---------------------------------------------------------------------------

function makeRepoMock<T>(): jest.Mocked<Repository<T>> {
  return {
    findOne: jest.fn(),
    findOneOrFail: jest.fn(),
    find: jest.fn(),
    findAndCount: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    create: jest.fn((dto: Partial<T>) => dto as T),
    createQueryBuilder: jest.fn(),
    count: jest.fn(),
    delete: jest.fn(),
  } as unknown as jest.Mocked<Repository<T>>;
}

function makeEntityManagerMock(overrides: Partial<EntityManager> = {}): jest.Mocked<EntityManager> {
  const mgr = {
    getRepository: jest.fn(),
    save: jest.fn(),
    ...overrides,
  } as unknown as jest.Mocked<EntityManager>;
  return mgr;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('CreditService', () => {
  let service: CreditService;
  let accountsRepo: jest.Mocked<Repository<CreditAccount>>;
  let movementsRepo: jest.Mocked<Repository<CreditMovement>>;
  let ordersRepo: jest.Mocked<Repository<Order>>;
  let dataSource: jest.Mocked<DataSource>;

  beforeEach(async () => {
    accountsRepo = makeRepoMock<CreditAccount>();
    movementsRepo = makeRepoMock<CreditMovement>();
    ordersRepo = makeRepoMock<Order>();

    // DataSource mock — transaction() calls the callback with a fake EntityManager.
    // Cast to unknown then DataSource to sidestep the overloaded signature type check.
    const txMock = jest.fn();
    dataSource = {
      transaction: txMock,
      getRepository: jest.fn(),
      query: jest.fn(),
    } as unknown as jest.Mocked<DataSource>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CreditService,
        { provide: getRepositoryToken(CreditAccount), useValue: accountsRepo },
        { provide: getRepositoryToken(CreditMovement), useValue: movementsRepo },
        { provide: getRepositoryToken(Order), useValue: ordersRepo },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get<CreditService>(CreditService);
  });

  // -------------------------------------------------------------------------
  // isOverdue — pure helper
  // -------------------------------------------------------------------------

  describe('isOverdue', () => {
    it('returns true when balance is negative AND due date is in the past', () => {
      const account = fakeAccount({
        balanceCents: -100,
        dueDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
      });
      expect(service.isOverdue(account)).toBe(true);
    });

    it('returns false when balance is non-negative even if due date is past', () => {
      const account = fakeAccount({
        balanceCents: 0,
        dueDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
      });
      expect(service.isOverdue(account)).toBe(false);
    });

    it('returns false when balance is negative but due date is in the future', () => {
      const account = fakeAccount({
        balanceCents: -100,
        dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
      expect(service.isOverdue(account)).toBe(false);
    });

    it('returns false when balance is negative and due date is null', () => {
      const account = fakeAccount({ balanceCents: -100, dueDate: null });
      expect(service.isOverdue(account)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // assertNotOverdue
  // -------------------------------------------------------------------------

  describe('assertNotOverdue', () => {
    it('throws 402 CREDIT_OVERDUE when account is overdue', async () => {
      accountsRepo.findOne.mockResolvedValue(
        fakeAccount({
          balanceCents: -200,
          dueDate: new Date(Date.now() - 86400000),
        }),
      );

      await expect(service.assertNotOverdue('user-1')).rejects.toThrow(
        HttpException,
      );

      // Verify the specific error code
      try {
        await service.assertNotOverdue('user-1');
      } catch (e: unknown) {
        const err = e as HttpException;
        expect(err.getStatus()).toBe(HttpStatus.PAYMENT_REQUIRED);
        const body = err.getResponse() as Record<string, unknown>;
        expect(body.code).toBe('CREDIT_OVERDUE');
      }
    });

    it('does not throw when account does not exist (no credit = no debt)', async () => {
      accountsRepo.findOne.mockResolvedValue(null);
      await expect(service.assertNotOverdue('user-1')).resolves.toBeUndefined();
    });

    it('does not throw when account balance is non-negative', async () => {
      accountsRepo.findOne.mockResolvedValue(
        fakeAccount({ balanceCents: 0, dueDate: new Date(Date.now() - 86400000) }),
      );
      await expect(service.assertNotOverdue('user-1')).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // applyCharge
  // -------------------------------------------------------------------------

  describe('applyCharge', () => {
    function makeManagerForApplyCharge(
      account: CreditAccount,
    ): jest.Mocked<EntityManager> {
      const savedMovement = fakeMovement({ type: CreditMovementType.CHARGE, amountCents: 30 });
      const acctRepo = makeRepoMock<CreditAccount>();
      acctRepo.findOne.mockResolvedValue(account);
      acctRepo.update.mockResolvedValue({ affected: 1 } as never);
      const mvRepo = makeRepoMock<CreditMovement>();
      mvRepo.save.mockResolvedValue(savedMovement);
      mvRepo.create.mockImplementation((dto) => ({ ...dto }) as CreditMovement);

      const mgr = makeEntityManagerMock();
      mgr.getRepository.mockImplementation((entity: unknown) => {
        if (entity === CreditAccount) return acctRepo as unknown as Repository<unknown>;
        if (entity === CreditMovement) return mvRepo as unknown as Repository<unknown>;
        return makeRepoMock() as unknown as Repository<unknown>;
      });
      return mgr;
    }

    it('debits balance and creates a CHARGE movement', async () => {
      const account = fakeAccount({ balanceCents: 500, creditLimitCents: 200 });
      const mgr = makeManagerForApplyCharge(account);

      // Grab the mocked movement repo to inspect save call
      const acctRepo = mgr.getRepository(CreditAccount) as jest.Mocked<Repository<CreditAccount>>;
      const mvRepo = mgr.getRepository(CreditMovement) as jest.Mocked<Repository<CreditMovement>>;

      const result = await service.applyCharge(
        { userId: 'user-1', orderId: 'order-1', amountCents: 30 },
        mgr as unknown as EntityManager,
      );

      expect(acctRepo.update).toHaveBeenCalledWith('user-1', {
        balanceCents: 470, // 500 - 30
      });
      expect(mvRepo.save).toHaveBeenCalled();
      expect(result.type).toBe(CreditMovementType.CHARGE);
    });

    it('throws BadRequestException when available credit is 0 or negative', async () => {
      const account = fakeAccount({ balanceCents: 0, creditLimitCents: 0 });
      const mgr = makeManagerForApplyCharge(account);

      await expect(
        service.applyCharge(
          { userId: 'user-1', orderId: 'order-1', amountCents: 50 },
          mgr as unknown as EntityManager,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when no credit account exists', async () => {
      const acctRepo = makeRepoMock<CreditAccount>();
      acctRepo.findOne.mockResolvedValue(null);
      const mgr = makeEntityManagerMock();
      mgr.getRepository.mockImplementation((entity: unknown) => {
        if (entity === CreditAccount) return acctRepo as unknown as Repository<unknown>;
        return makeRepoMock() as unknown as Repository<unknown>;
      });

      await expect(
        service.applyCharge(
          { userId: 'user-1', orderId: 'order-1', amountCents: 50 },
          mgr as unknown as EntityManager,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // -------------------------------------------------------------------------
  // reverseCharge
  // -------------------------------------------------------------------------

  describe('reverseCharge', () => {
    it('returns null (idempotent) when a REVERSAL movement already exists for the order', async () => {
      // Mock the transaction() to invoke the callback with a manager
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (dataSource.transaction as jest.Mock).mockImplementation(async (cb: (mgr: EntityManager) => Promise<unknown>) => {
        const order = fakeOrder({ creditApplied: '1.00' });
        const account = fakeAccount({ balanceCents: -100 });
        const existingReversal = fakeMovement({ type: CreditMovementType.REVERSAL });

        const orderRepo = makeRepoMock<Order>();
        orderRepo.findOne.mockResolvedValue(order);
        const acctRepo = makeRepoMock<CreditAccount>();
        acctRepo.findOne.mockResolvedValue(account);
        const mvRepo = makeRepoMock<CreditMovement>();
        mvRepo.findOne.mockResolvedValue(existingReversal); // already reversed!

        const mgr = makeEntityManagerMock();
        mgr.getRepository.mockImplementation((entity: unknown) => {
          if (entity === Order) return orderRepo as unknown as Repository<unknown>;
          if (entity === CreditAccount) return acctRepo as unknown as Repository<unknown>;
          if (entity === CreditMovement) return mvRepo as unknown as Repository<unknown>;
          return makeRepoMock() as unknown as Repository<unknown>;
        });
        return cb(mgr as unknown as EntityManager);
      });

      const result = await service.reverseCharge('order-1');
      expect(result).toBeNull();
    });

    it('returns null when order creditApplied is 0', async () => {
      (dataSource.transaction as jest.Mock).mockImplementation(async (cb: (mgr: EntityManager) => Promise<unknown>) => {
        const order = fakeOrder({ creditApplied: '0.00' });
        const orderRepo = makeRepoMock<Order>();
        orderRepo.findOne.mockResolvedValue(order);

        const mgr = makeEntityManagerMock();
        mgr.getRepository.mockImplementation((entity: unknown) => {
          if (entity === Order) return orderRepo as unknown as Repository<unknown>;
          return makeRepoMock() as unknown as Repository<unknown>;
        });
        return cb(mgr as unknown as EntityManager);
      });

      const result = await service.reverseCharge('order-1');
      expect(result).toBeNull();
    });

    it('creates a REVERSAL movement and restores balance on first call', async () => {
      const savedReversal = fakeMovement({ type: CreditMovementType.REVERSAL, amountCents: 100 });

      (dataSource.transaction as jest.Mock).mockImplementation(async (cb: (mgr: EntityManager) => Promise<unknown>) => {
        const order = fakeOrder({ creditApplied: '1.00', customerId: 'user-1' });
        const account = fakeAccount({ userId: 'user-1', balanceCents: -100 });

        const orderRepo = makeRepoMock<Order>();
        orderRepo.findOne.mockResolvedValue(order);
        orderRepo.update.mockResolvedValue({ affected: 1 } as never);

        const acctRepo = makeRepoMock<CreditAccount>();
        acctRepo.findOne.mockResolvedValue(account);
        acctRepo.update.mockResolvedValue({ affected: 1 } as never);

        const mvRepo = makeRepoMock<CreditMovement>();
        mvRepo.findOne.mockResolvedValue(null); // no existing reversal
        mvRepo.save.mockResolvedValue(savedReversal);
        mvRepo.create.mockImplementation((dto) => ({ ...dto }) as CreditMovement);

        const mgr = makeEntityManagerMock();
        mgr.getRepository.mockImplementation((entity: unknown) => {
          if (entity === Order) return orderRepo as unknown as Repository<unknown>;
          if (entity === CreditAccount) return acctRepo as unknown as Repository<unknown>;
          if (entity === CreditMovement) return mvRepo as unknown as Repository<unknown>;
          return makeRepoMock() as unknown as Repository<unknown>;
        });
        return cb(mgr as unknown as EntityManager);
      });

      const result = await service.reverseCharge('order-1');
      expect(result).not.toBeNull();
      expect(result?.type).toBe(CreditMovementType.REVERSAL);
    });
  });

  // -------------------------------------------------------------------------
  // recordPayment
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // grantCredit — one-time dueDate semantics
  // -------------------------------------------------------------------------

  describe('grantCredit', () => {
    function setupGrantManager(account: CreditAccount | null) {
      const acctRepo = makeRepoMock<CreditAccount>();
      acctRepo.findOne.mockResolvedValue(account);
      if (account) {
        acctRepo.update.mockResolvedValue({ affected: 1 } as never);
      } else {
        // For "no account" path, save() returns the freshly created account.
        acctRepo.save.mockImplementation(async (dto: unknown) => {
          return { ...(dto as object), dueDate: null } as CreditAccount;
        });
      }

      const savedMovement = fakeMovement({ type: CreditMovementType.GRANT, amountCents: 1000 });
      const mvRepo = makeRepoMock<CreditMovement>();
      mvRepo.save.mockResolvedValue(savedMovement);
      mvRepo.create.mockImplementation((dto) => ({ ...dto }) as CreditMovement);

      const mgr = makeEntityManagerMock();
      mgr.getRepository.mockImplementation((entity: unknown) => {
        if (entity === CreditAccount) return acctRepo as unknown as Repository<unknown>;
        if (entity === CreditMovement) return mvRepo as unknown as Repository<unknown>;
        return makeRepoMock() as unknown as Repository<unknown>;
      });

      (dataSource.transaction as jest.Mock).mockImplementation(
        async (cb: (mgr: EntityManager) => Promise<unknown>) => cb(mgr as unknown as EntityManager),
      );

      return { mgr, acctRepo, mvRepo };
    }

    it('sets default due-date (now + 3 months) on first grant when account has no due date', async () => {
      const { acctRepo } = setupGrantManager(
        fakeAccount({ balanceCents: 0, dueDate: null }),
      );

      const before = new Date();
      await service.grantCredit('user-1', 1000, 'admin-1', 'first grant');
      const after = new Date();

      expect(acctRepo.update).toHaveBeenCalledWith('user-1', expect.objectContaining({
        balanceCents: 1000,
      }));
      const updateCall = acctRepo.update.mock.calls[0][1] as Partial<CreditAccount>;
      expect(updateCall.dueDate).toBeInstanceOf(Date);
      const due = updateCall.dueDate as Date;

      const expectedMin = new Date(before);
      expectedMin.setMonth(expectedMin.getMonth() + 3);
      const expectedMax = new Date(after);
      expectedMax.setMonth(expectedMax.getMonth() + 3);
      expect(due.getTime()).toBeGreaterThanOrEqual(expectedMin.getTime() - 10);
      expect(due.getTime()).toBeLessThanOrEqual(expectedMax.getTime() + 10);
    });

    it('does NOT touch due-date on subsequent grants when account already has one', async () => {
      const existingDue = new Date('2030-01-01');
      const { acctRepo } = setupGrantManager(
        fakeAccount({ balanceCents: -500, dueDate: existingDue }),
      );

      await service.grantCredit('user-1', 200, 'admin-1', 'top up');

      const updateCall = acctRepo.update.mock.calls[0][1] as Partial<CreditAccount>;
      expect(updateCall.balanceCents).toBe(-300); // -500 + 200
      // `dueDate` MUST NOT be in the update payload — admin overrides via PATCH only.
      expect('dueDate' in updateCall).toBe(false);
    });

    it('honors explicit dueDate from caller on first grant', async () => {
      const explicit = new Date('2027-06-15');
      const { acctRepo } = setupGrantManager(
        fakeAccount({ balanceCents: 0, dueDate: null }),
      );

      await service.grantCredit('user-1', 1000, 'admin-1', 'note', explicit);

      const updateCall = acctRepo.update.mock.calls[0][1] as Partial<CreditAccount>;
      expect(updateCall.dueDate).toEqual(explicit);
    });
  });

  // -------------------------------------------------------------------------
  // amountOwed — pure helper
  // -------------------------------------------------------------------------

  describe('amountOwed', () => {
    it('returns 0 when balance is positive', () => {
      expect(service.amountOwed({ balanceCents: 500 })).toBe(0);
    });

    it('returns 0 when balance is zero', () => {
      expect(service.amountOwed({ balanceCents: 0 })).toBe(0);
    });

    it('returns absolute value when balance is negative', () => {
      expect(service.amountOwed({ balanceCents: -1234 })).toBe(1234);
    });
  });

  // -------------------------------------------------------------------------
  // recordPaymentFromStripe — webhook idempotency
  // -------------------------------------------------------------------------

  describe('recordPaymentFromStripe', () => {
    function setupStripePaymentManager(args: {
      account: CreditAccount | null;
      existingMovement?: CreditMovement | null;
      saveImpl?: (dto: CreditMovement) => Promise<CreditMovement>;
      winnerOnConflict?: CreditMovement | null;
    }) {
      const acctRepo = makeRepoMock<CreditAccount>();
      acctRepo.findOne.mockResolvedValue(args.account);
      acctRepo.update.mockResolvedValue({ affected: 1 } as never);

      const mvRepo = makeRepoMock<CreditMovement>();
      // findOne is called twice in conflict path: once for fast-path dedup, once after unique violation
      mvRepo.findOne
        .mockResolvedValueOnce(args.existingMovement ?? null)
        .mockResolvedValueOnce(args.winnerOnConflict ?? null);
      mvRepo.create.mockImplementation((dto) => ({ ...dto }) as CreditMovement);
      if (args.saveImpl) {
        mvRepo.save.mockImplementation(args.saveImpl as never);
      } else {
        mvRepo.save.mockResolvedValue(
          fakeMovement({ type: CreditMovementType.PAYMENT, amountCents: 1500 }),
        );
      }

      const mgr = makeEntityManagerMock();
      mgr.getRepository.mockImplementation((entity: unknown) => {
        if (entity === CreditAccount) return acctRepo as unknown as Repository<unknown>;
        if (entity === CreditMovement) return mvRepo as unknown as Repository<unknown>;
        return makeRepoMock() as unknown as Repository<unknown>;
      });
      (dataSource.transaction as jest.Mock).mockImplementation(
        async (cb: (mgr: EntityManager) => Promise<unknown>) => cb(mgr as unknown as EntityManager),
      );
      return { acctRepo, mvRepo };
    }

    it('credits the account and creates a PAYMENT movement on first webhook delivery', async () => {
      const { acctRepo, mvRepo } = setupStripePaymentManager({
        account: fakeAccount({ balanceCents: -2000 }),
      });

      const result = await service.recordPaymentFromStripe({
        userId: 'user-1',
        amountCents: 1500,
        stripePaymentIntentId: 'pi_test_111',
      });

      expect(acctRepo.update).toHaveBeenCalledWith('user-1', {
        balanceCents: -500, // -2000 + 1500
      });
      expect(mvRepo.save).toHaveBeenCalledTimes(1);
      expect(result.type).toBe(CreditMovementType.PAYMENT);
    });

    it('is idempotent: returns existing movement and skips DB writes on duplicate webhook', async () => {
      const existing = fakeMovement({
        type: CreditMovementType.PAYMENT,
        amountCents: 1500,
        stripePaymentIntentId: 'pi_test_222',
      });
      const { acctRepo, mvRepo } = setupStripePaymentManager({
        account: fakeAccount({ balanceCents: -500 }),
        existingMovement: existing,
      });

      const result = await service.recordPaymentFromStripe({
        userId: 'user-1',
        amountCents: 1500,
        stripePaymentIntentId: 'pi_test_222',
      });

      expect(result).toBe(existing);
      expect(mvRepo.save).not.toHaveBeenCalled();
      expect(acctRepo.update).not.toHaveBeenCalled();
    });

    it('handles concurrent webhook race: returns winner movement when unique-violation (23505) is thrown', async () => {
      const winner = fakeMovement({
        type: CreditMovementType.PAYMENT,
        amountCents: 1500,
        stripePaymentIntentId: 'pi_test_333',
      });
      const { mvRepo } = setupStripePaymentManager({
        account: fakeAccount({ balanceCents: -1000 }),
        existingMovement: null, // fast-path miss: not yet visible in this TX
        winnerOnConflict: winner,
        saveImpl: () => {
          throw Object.assign(new Error('duplicate key'), { code: '23505' });
        },
      });

      const result = await service.recordPaymentFromStripe({
        userId: 'user-1',
        amountCents: 1500,
        stripePaymentIntentId: 'pi_test_333',
      });

      expect(result).toBe(winner);
      // Two findOne calls: one for fast-path dedup, one after unique violation to fetch winner.
      expect(mvRepo.findOne).toHaveBeenCalledTimes(2);
    });

    it('throws BadRequestException when account does not exist', async () => {
      setupStripePaymentManager({ account: null });

      await expect(
        service.recordPaymentFromStripe({
          userId: 'user-missing',
          amountCents: 1500,
          stripePaymentIntentId: 'pi_test_444',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('recordPayment', () => {
    it('increments balance and creates a PAYMENT movement', async () => {
      const account = fakeAccount({ balanceCents: -200 });
      const savedPayment = fakeMovement({ type: CreditMovementType.PAYMENT, amountCents: 150 });

      const acctRepo = makeRepoMock<CreditAccount>();
      acctRepo.findOne.mockResolvedValue(account);
      acctRepo.update.mockResolvedValue({ affected: 1 } as never);
      const mvRepo = makeRepoMock<CreditMovement>();
      mvRepo.save.mockResolvedValue(savedPayment);
      mvRepo.create.mockImplementation((dto) => ({ ...dto }) as CreditMovement);

      const mgr = makeEntityManagerMock();
      mgr.getRepository.mockImplementation((entity: unknown) => {
        if (entity === CreditAccount) return acctRepo as unknown as Repository<unknown>;
        if (entity === CreditMovement) return mvRepo as unknown as Repository<unknown>;
        return makeRepoMock() as unknown as Repository<unknown>;
      });

      (dataSource.transaction as jest.Mock).mockImplementation(async (cb: (mgr: EntityManager) => Promise<unknown>) => {
        return cb(mgr as unknown as EntityManager);
      });

      const result = await service.recordPayment('user-1', 150, 'admin-1');

      expect(acctRepo.update).toHaveBeenCalledWith('user-1', {
        balanceCents: -50, // -200 + 150
      });
      expect(result.type).toBe(CreditMovementType.PAYMENT);
    });
  });

  // -------------------------------------------------------------------------
  // adjustLimit
  // -------------------------------------------------------------------------

  describe('adjustLimit', () => {
    it('updates creditLimitCents without creating any movement', async () => {
      const account = fakeAccount({ creditLimitCents: 500 });
      const updatedAccount = fakeAccount({ creditLimitCents: 1000 });

      const acctRepo = makeRepoMock<CreditAccount>();
      acctRepo.findOne.mockResolvedValue(account);
      acctRepo.update.mockResolvedValue({ affected: 1 } as never);
      acctRepo.findOneOrFail.mockResolvedValue(updatedAccount);

      const mvRepo = makeRepoMock<CreditMovement>();

      const mgr = makeEntityManagerMock();
      mgr.getRepository.mockImplementation((entity: unknown) => {
        if (entity === CreditAccount) return acctRepo as unknown as Repository<unknown>;
        if (entity === CreditMovement) return mvRepo as unknown as Repository<unknown>;
        return makeRepoMock() as unknown as Repository<unknown>;
      });

      (dataSource.transaction as jest.Mock).mockImplementation(async (cb: (mgr: EntityManager) => Promise<unknown>) => {
        return cb(mgr as unknown as EntityManager);
      });

      const result = await service.adjustLimit('user-1', 1000, 'admin-1');

      expect(acctRepo.update).toHaveBeenCalledWith('user-1', { creditLimitCents: 1000 });
      expect(mvRepo.save).not.toHaveBeenCalled();
      expect(result.creditLimitCents).toBe(1000);
    });
  });

  // -------------------------------------------------------------------------
  // manualAdjustment
  // -------------------------------------------------------------------------

  describe('manualAdjustment', () => {
    function makeManagerForAdjustment(
      account: CreditAccount,
      savedMovement: CreditMovement,
    ): jest.Mocked<EntityManager> {
      const acctRepo = makeRepoMock<CreditAccount>();
      acctRepo.findOne.mockResolvedValue(account);
      acctRepo.update.mockResolvedValue({ affected: 1 } as never);
      const mvRepo = makeRepoMock<CreditMovement>();
      mvRepo.save.mockResolvedValue(savedMovement);
      mvRepo.create.mockImplementation((dto) => ({ ...dto }) as CreditMovement);

      const mgr = makeEntityManagerMock();
      mgr.getRepository.mockImplementation((entity: unknown) => {
        if (entity === CreditAccount) return acctRepo as unknown as Repository<unknown>;
        if (entity === CreditMovement) return mvRepo as unknown as Repository<unknown>;
        return makeRepoMock() as unknown as Repository<unknown>;
      });
      return mgr;
    }

    it('stores ADJUSTMENT_INCREASE for positive amountCents', async () => {
      const account = fakeAccount({ balanceCents: 100 });
      const savedMovement = fakeMovement({
        type: CreditMovementType.ADJUSTMENT_INCREASE,
        amountCents: 500,
      });

      const mgr = makeManagerForAdjustment(account, savedMovement);
      (dataSource.transaction as jest.Mock).mockImplementation(
        async (cb: (mgr: EntityManager) => Promise<unknown>) => cb(mgr as unknown as EntityManager),
      );

      const result = await service.manualAdjustment('user-1', 500, 'admin-1', 'bonus');
      expect(result.type).toBe(CreditMovementType.ADJUSTMENT_INCREASE);
    });

    it('stores ADJUSTMENT_DECREASE for negative amountCents', async () => {
      const account = fakeAccount({ balanceCents: 1000 });
      const savedMovement = fakeMovement({
        type: CreditMovementType.ADJUSTMENT_DECREASE,
        amountCents: 200,
      });

      const mgr = makeManagerForAdjustment(account, savedMovement);
      (dataSource.transaction as jest.Mock).mockImplementation(
        async (cb: (mgr: EntityManager) => Promise<unknown>) => cb(mgr as unknown as EntityManager),
      );

      const result = await service.manualAdjustment('user-1', -200, 'admin-1', 'correction');
      expect(result.type).toBe(CreditMovementType.ADJUSTMENT_DECREASE);
    });

    it('stores ADJUSTMENT_INCREASE for zero amountCents (boundary)', async () => {
      const account = fakeAccount({ balanceCents: 100 });
      const savedMovement = fakeMovement({
        type: CreditMovementType.ADJUSTMENT_INCREASE,
        amountCents: 0,
      });

      const mgr = makeManagerForAdjustment(account, savedMovement);
      (dataSource.transaction as jest.Mock).mockImplementation(
        async (cb: (mgr: EntityManager) => Promise<unknown>) => cb(mgr as unknown as EntityManager),
      );

      const result = await service.manualAdjustment('user-1', 0, 'admin-1', 'zero adjustment');
      expect(result.type).toBe(CreditMovementType.ADJUSTMENT_INCREASE);
    });

    it('stores absolute amountCents regardless of sign', async () => {
      const account = fakeAccount({ balanceCents: 500 });

      const acctRepo = makeRepoMock<CreditAccount>();
      acctRepo.findOne.mockResolvedValue(account);
      acctRepo.update.mockResolvedValue({ affected: 1 } as never);
      const mvRepo = makeRepoMock<CreditMovement>();
      mvRepo.save.mockImplementation(async (dto: Partial<CreditMovement>) => dto as CreditMovement);
      mvRepo.create.mockImplementation((dto) => ({ ...dto }) as CreditMovement);

      const mgr = makeEntityManagerMock();
      mgr.getRepository.mockImplementation((entity: unknown) => {
        if (entity === CreditAccount) return acctRepo as unknown as Repository<unknown>;
        if (entity === CreditMovement) return mvRepo as unknown as Repository<unknown>;
        return makeRepoMock() as unknown as Repository<unknown>;
      });
      (dataSource.transaction as jest.Mock).mockImplementation(
        async (cb: (mgr: EntityManager) => Promise<unknown>) => cb(mgr as unknown as EntityManager),
      );

      const result = await service.manualAdjustment('user-1', -300, 'admin-1', 'deduction');
      expect(result.amountCents).toBe(300); // Math.abs(-300)
    });
  });

  // -------------------------------------------------------------------------
  // getAccountWithLock
  // -------------------------------------------------------------------------

  describe('getAccountWithLock', () => {
    it('returns the account when found with pessimistic_write lock', async () => {
      const account = fakeAccount();
      const acctRepo = makeRepoMock<CreditAccount>();
      acctRepo.findOne.mockResolvedValue(account);

      const mgr = makeEntityManagerMock();
      mgr.getRepository.mockImplementation(() => acctRepo as unknown as Repository<unknown>);

      const result = await service.getAccountWithLock('user-1', mgr as unknown as EntityManager);

      expect(acctRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1' },
          lock: { mode: 'pessimistic_write' },
        }),
      );
      expect(result.userId).toBe('user-1');
    });

    it('throws BadRequestException when account not found', async () => {
      const acctRepo = makeRepoMock<CreditAccount>();
      acctRepo.findOne.mockResolvedValue(null);

      const mgr = makeEntityManagerMock();
      mgr.getRepository.mockImplementation(() => acctRepo as unknown as Repository<unknown>);

      await expect(
        service.getAccountWithLock('user-1', mgr as unknown as EntityManager),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
