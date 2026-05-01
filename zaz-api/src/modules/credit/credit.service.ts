import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import {
  CreditAccount,
  CreditMovement,
  CreditMovementType,
  Order,
} from '../../entities';
import {
  CreditAccountStatus,
  ListAccountsQueryDto,
} from './dto/list-accounts-query.dto';

export interface PaginatedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

@Injectable()
export class CreditService {
  constructor(
    @InjectRepository(CreditAccount)
    private readonly accounts: Repository<CreditAccount>,
    @InjectRepository(CreditMovement)
    private readonly movements: Repository<CreditMovement>,
    @InjectRepository(Order)
    private readonly orders: Repository<Order>,
    private readonly dataSource: DataSource,
  ) {}

  // ---------------------------------------------------------------------------
  // Read helpers (no lock)
  // ---------------------------------------------------------------------------

  async getAccount(userId: string): Promise<CreditAccount | null> {
    return this.accounts.findOne({ where: { userId } });
  }

  async getMyCredit(
    userId: string,
  ): Promise<{ account: CreditAccount | null; recentMovements: CreditMovement[] }> {
    const account = await this.accounts.findOne({ where: { userId } });
    if (!account) {
      return { account: null, recentMovements: [] };
    }
    const recentMovements = await this.movements.find({
      where: { creditAccountId: userId },
      order: { createdAt: 'DESC' },
      take: 20,
    });
    return { account, recentMovements };
  }

  async listAccounts(
    filter: ListAccountsQueryDto,
  ): Promise<PaginatedResult<CreditAccount>> {
    const page = filter.page ?? 1;
    const pageSize = filter.pageSize ?? 50;
    const skip = (page - 1) * pageSize;

    let qb = this.dataSource
      .getRepository(CreditAccount)
      .createQueryBuilder('ca')
      .leftJoinAndSelect('ca.user', 'u');

    if (filter.search) {
      qb = qb.andWhere(
        'u.full_name ILIKE :search OR u.phone ILIKE :search',
        { search: `%${filter.search}%` },
      );
    }

    const now = new Date();
    if (filter.status === CreditAccountStatus.VENCIDO) {
      qb = qb.andWhere(
        'ca.balance_cents < 0 AND ca.due_date IS NOT NULL AND ca.due_date < :now',
        { now },
      );
    } else if (filter.status === CreditAccountStatus.AL_DIA) {
      qb = qb.andWhere(
        'ca.balance_cents < 0 AND (ca.due_date IS NULL OR ca.due_date >= :now)',
        { now },
      );
    } else if (filter.status === CreditAccountStatus.SIN_DEUDA) {
      qb = qb.andWhere('ca.balance_cents >= 0');
    }

    // Default sort: most negative balance first
    qb = qb.orderBy('ca.balance_cents', 'ASC').skip(skip).take(pageSize);

    const [items, totalCount] = await qb.getManyAndCount();

    return {
      items,
      page,
      pageSize,
      totalCount,
      totalPages: Math.ceil(totalCount / pageSize),
    };
  }

  async getMovements(
    userId: string,
    page: number,
    pageSize: number,
  ): Promise<PaginatedResult<CreditMovement>> {
    const skip = (page - 1) * pageSize;
    const [items, totalCount] = await this.movements.findAndCount({
      where: { creditAccountId: userId },
      order: { createdAt: 'DESC' },
      skip,
      take: pageSize,
    });
    return {
      items,
      page,
      pageSize,
      totalCount,
      totalPages: Math.ceil(totalCount / pageSize),
    };
  }

  /**
   * Throws 402 PaymentRequired if the user's credit account is overdue.
   * Called as the first check in orders.service.create() — before any TX.
   */
  async assertNotOverdue(userId: string): Promise<void> {
    const account = await this.accounts.findOne({
      where: { userId },
      select: ['balanceCents', 'dueDate'],
    });
    if (!account) return; // no account = no debt
    if (this.isOverdue(account)) {
      throw new HttpException(
        {
          statusCode: HttpStatus.PAYMENT_REQUIRED,
          code: 'CREDIT_OVERDUE',
          message: 'Tienes pagos vencidos. Saldá tu cuenta antes de comprar.',
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Locking read — only callable inside a caller-owned TX
  // ---------------------------------------------------------------------------

  async getAccountWithLock(
    userId: string,
    manager: EntityManager,
  ): Promise<CreditAccount> {
    const account = await manager.getRepository(CreditAccount).findOne({
      where: { userId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!account) {
      throw new BadRequestException({
        code: 'CREDIT_ACCOUNT_NOT_FOUND',
        message: 'No existe cuenta de crédito para este usuario',
      });
    }
    return account;
  }

  // ---------------------------------------------------------------------------
  // Writes (all accept optional EntityManager for TX composition)
  // ---------------------------------------------------------------------------

  async getOrCreateAccount(
    userId: string,
    manager?: EntityManager,
  ): Promise<CreditAccount> {
    const run = async (mgr: EntityManager) => {
      const repo = mgr.getRepository(CreditAccount);
      const existing = await repo.findOne({ where: { userId } });
      if (existing) return existing;
      return repo.save(
        repo.create({
          userId,
          balanceCents: 0,
          creditLimitCents: 0,
          dueDate: null,
          currency: 'usd',
        }),
      );
    };
    if (manager) return run(manager);
    return this.dataSource.transaction(run);
  }

  async grantCredit(
    userId: string,
    amountCents: number,
    actorUserId: string,
    note?: string,
    dueDate?: Date | null,
    manager?: EntityManager,
  ): Promise<CreditMovement> {
    const run = async (mgr: EntityManager) => {
      const accountRepo = mgr.getRepository(CreditAccount);
      const movementRepo = mgr.getRepository(CreditMovement);

      // Ensure account exists (upsert)
      let account = await accountRepo.findOne({
        where: { userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!account) {
        account = await accountRepo.save(
          accountRepo.create({
            userId,
            balanceCents: 0,
            creditLimitCents: 0,
            dueDate: null,
            currency: 'usd',
          }),
        );
      }

      // Due-date rule: ONE-TIME on first grant. If the account currently has
      // no due_date, set one. Admin can pass an explicit dueDate; otherwise we
      // default to now + 3 months. Subsequent grants leave due_date untouched —
      // override is exclusively via PATCH /admin/credit-accounts/:userId.
      const updates: Partial<CreditAccount> = {
        balanceCents: account.balanceCents + amountCents,
      };
      if (account.dueDate === null) {
        updates.dueDate = dueDate ?? defaultDueDate();
      }
      await accountRepo.update(userId, updates);

      return movementRepo.save(
        movementRepo.create({
          creditAccountId: userId,
          type: CreditMovementType.GRANT,
          amountCents,
          orderId: null,
          performedByUserId: actorUserId,
          note: note ?? null,
        }),
      );
    };
    if (manager) return run(manager);
    return this.dataSource.transaction(run);
  }

  /**
   * Records a customer self-payment that succeeded on Stripe. Idempotent via
   * the unique partial index on `stripe_payment_intent_id` — duplicate webhook
   * deliveries return the existing movement instead of creating a second one.
   */
  async recordPaymentFromStripe(args: {
    userId: string;
    amountCents: number;
    stripePaymentIntentId: string;
  }): Promise<CreditMovement> {
    const { userId, amountCents, stripePaymentIntentId } = args;

    return this.dataSource.transaction(async (mgr) => {
      const accountRepo = mgr.getRepository(CreditAccount);
      const movementRepo = mgr.getRepository(CreditMovement);

      // Fast-path dedup: if the movement already exists for this intent, no-op.
      const existing = await movementRepo.findOne({
        where: { stripePaymentIntentId },
      });
      if (existing) return existing;

      const account = await accountRepo.findOne({
        where: { userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!account) {
        throw new BadRequestException({
          code: 'CREDIT_ACCOUNT_NOT_FOUND',
          message: 'No existe cuenta de crédito para este usuario',
        });
      }

      try {
        const movement = await movementRepo.save(
          movementRepo.create({
            creditAccountId: userId,
            type: CreditMovementType.PAYMENT,
            amountCents,
            orderId: null,
            performedByUserId: userId,
            note: 'Pago en línea',
            stripePaymentIntentId,
          }),
        );

        await accountRepo.update(userId, {
          balanceCents: account.balanceCents + amountCents,
        });

        return movement;
      } catch (e: unknown) {
        if (isUniqueViolation(e)) {
          // Concurrent webhook delivery raced us — the other request won.
          const winner = await movementRepo.findOne({
            where: { stripePaymentIntentId },
          });
          if (winner) return winner;
        }
        throw e;
      }
    });
  }

  /**
   * Computes how much the user owes, in cents (always >= 0). 0 means no debt.
   */
  amountOwed(account: Pick<CreditAccount, 'balanceCents'>): number {
    return account.balanceCents < 0 ? -account.balanceCents : 0;
  }

  /**
   * Applies a credit charge for an order. amountCents MUST be positive.
   * Decrements balance_cents. Throws 400 if insufficient credit.
   * Requires an EntityManager (must run inside the order creation TX).
   */
  async applyCharge(
    args: { userId: string; orderId: string; amountCents: number },
    manager: EntityManager,
  ): Promise<CreditMovement> {
    const { userId, orderId, amountCents } = args;
    const accountRepo = manager.getRepository(CreditAccount);
    const movementRepo = manager.getRepository(CreditMovement);

    const account = await accountRepo.findOne({
      where: { userId },
      lock: { mode: 'pessimistic_write' },
    });

    if (!account) {
      throw new BadRequestException({
        code: 'CREDIT_INSUFFICIENT',
        message: 'Crédito insuficiente',
      });
    }

    const available = account.balanceCents + account.creditLimitCents;
    if (available <= 0) {
      throw new BadRequestException({
        code: 'CREDIT_INSUFFICIENT',
        message: 'Crédito insuficiente',
      });
    }

    await accountRepo.update(userId, {
      balanceCents: account.balanceCents - amountCents,
    });

    return movementRepo.save(
      movementRepo.create({
        creditAccountId: userId,
        type: CreditMovementType.CHARGE,
        amountCents,
        orderId,
        performedByUserId: userId,
        note: null,
      }),
    );
  }

  /**
   * Reverses a credit charge for an order. Idempotent — returns null if a
   * reversal movement already exists for this orderId.
   *
   * Two-tier idempotency:
   *   1. Service-level SELECT check (fast path)
   *   2. DB unique partial index (race-condition safety net — catches UniqueViolation)
   */
  async reverseCharge(
    orderId: string,
    manager?: EntityManager,
  ): Promise<CreditMovement | null> {
    const run = async (mgr: EntityManager) => {
      const orderRepo = mgr.getRepository(Order);
      const accountRepo = mgr.getRepository(CreditAccount);
      const movementRepo = mgr.getRepository(CreditMovement);

      const order = await orderRepo.findOne({ where: { id: orderId } });
      if (!order) return null;

      const creditAppliedCents = Math.round(
        parseFloat(order.creditApplied || '0') * 100,
      );
      if (creditAppliedCents === 0) return null;

      const account = await accountRepo.findOne({
        where: { userId: order.customerId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!account) return null;

      // Service-level dedup check (fast path)
      const existing = await movementRepo.findOne({
        where: {
          creditAccountId: account.userId,
          orderId,
          type: CreditMovementType.REVERSAL,
        },
      });
      if (existing) return null;

      try {
        const mv = await movementRepo.save(
          movementRepo.create({
            creditAccountId: account.userId,
            type: CreditMovementType.REVERSAL,
            amountCents: creditAppliedCents,
            orderId,
            performedByUserId: null,
            note: 'auto-reversal',
          }),
        );

        await accountRepo.update(account.userId, {
          balanceCents: account.balanceCents + creditAppliedCents,
        });

        await orderRepo.update(orderId, { creditApplied: '0.00' });

        return mv;
      } catch (e: unknown) {
        // DB-level unique index race protection (ADR-4)
        if (isUniqueViolation(e)) return null;
        throw e;
      }
    };

    if (manager) return run(manager);
    return this.dataSource.transaction(run);
  }

  async recordPayment(
    userId: string,
    amountCents: number,
    actorUserId: string,
    note?: string,
    manager?: EntityManager,
  ): Promise<CreditMovement> {
    const run = async (mgr: EntityManager) => {
      const accountRepo = mgr.getRepository(CreditAccount);
      const movementRepo = mgr.getRepository(CreditMovement);

      const account = await accountRepo.findOne({
        where: { userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!account) {
        throw new BadRequestException('No existe cuenta de crédito');
      }

      await accountRepo.update(userId, {
        balanceCents: account.balanceCents + amountCents,
      });

      return movementRepo.save(
        movementRepo.create({
          creditAccountId: userId,
          type: CreditMovementType.PAYMENT,
          amountCents,
          orderId: null,
          performedByUserId: actorUserId,
          note: note ?? null,
        }),
      );
    };
    if (manager) return run(manager);
    return this.dataSource.transaction(run);
  }

  async adjustLimit(
    userId: string,
    newLimitCents: number,
    actorUserId: string,
    manager?: EntityManager,
  ): Promise<CreditAccount> {
    const run = async (mgr: EntityManager) => {
      const accountRepo = mgr.getRepository(CreditAccount);
      // Ensure account exists
      let account = await accountRepo.findOne({ where: { userId } });
      if (!account) {
        account = await accountRepo.save(
          accountRepo.create({
            userId,
            balanceCents: 0,
            creditLimitCents: newLimitCents,
            dueDate: null,
            currency: 'usd',
          }),
        );
        return account;
      }
      await accountRepo.update(userId, { creditLimitCents: newLimitCents });
      // Re-fetch updated row
      return accountRepo.findOneOrFail({ where: { userId } });
    };
    // actorUserId is accepted for future audit trail extension
    void actorUserId;
    if (manager) return run(manager);
    return this.dataSource.transaction(run);
  }

  async setDueDate(
    userId: string,
    dueDate: Date | null,
    actorUserId: string,
    manager?: EntityManager,
  ): Promise<CreditAccount> {
    const run = async (mgr: EntityManager) => {
      const accountRepo = mgr.getRepository(CreditAccount);
      let account = await accountRepo.findOne({ where: { userId } });
      if (!account) {
        account = await accountRepo.save(
          accountRepo.create({
            userId,
            balanceCents: 0,
            creditLimitCents: 0,
            dueDate,
            currency: 'usd',
          }),
        );
        return account;
      }
      await accountRepo.update(userId, { dueDate });
      return accountRepo.findOneOrFail({ where: { userId } });
    };
    void actorUserId;
    if (manager) return run(manager);
    return this.dataSource.transaction(run);
  }

  /**
   * Manual adjustment by a super-admin. amountCents is signed:
   *   positive → credit added (balance increases)
   *   negative → credit removed (balance decreases)
   */
  async manualAdjustment(
    userId: string,
    amountCents: number,
    actorUserId: string,
    note: string,
    manager?: EntityManager,
  ): Promise<CreditMovement> {
    const run = async (mgr: EntityManager) => {
      const accountRepo = mgr.getRepository(CreditAccount);
      const movementRepo = mgr.getRepository(CreditMovement);

      const account = await accountRepo.findOne({
        where: { userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!account) {
        throw new BadRequestException('No existe cuenta de crédito');
      }

      await accountRepo.update(userId, {
        balanceCents: account.balanceCents + amountCents,
      });

      const adjustmentType =
        amountCents >= 0
          ? CreditMovementType.ADJUSTMENT_INCREASE
          : CreditMovementType.ADJUSTMENT_DECREASE;

      return movementRepo.save(
        movementRepo.create({
          creditAccountId: userId,
          type: adjustmentType,
          amountCents: Math.abs(amountCents),
          orderId: null,
          performedByUserId: actorUserId,
          note,
        }),
      );
    };
    if (manager) return run(manager);
    return this.dataSource.transaction(run);
  }

  // ---------------------------------------------------------------------------
  // Pure helper
  // ---------------------------------------------------------------------------

  isOverdue(account: Pick<CreditAccount, 'balanceCents' | 'dueDate'>): boolean {
    return (
      account.balanceCents < 0 &&
      account.dueDate !== null &&
      account.dueDate < new Date()
    );
  }
}

// ---------------------------------------------------------------------------
// Internal utility
// ---------------------------------------------------------------------------

function isUniqueViolation(e: unknown): boolean {
  if (e && typeof e === 'object') {
    const err = e as Record<string, unknown>;
    // PostgreSQL error code 23505 = unique_violation
    return err['code'] === '23505';
  }
  return false;
}

/**
 * Default due-date applied on the first grant when the admin doesn't supply
 * one explicitly: now + 3 calendar months.
 */
function defaultDueDate(): Date {
  const d = new Date();
  d.setMonth(d.getMonth() + 3);
  return d;
}
