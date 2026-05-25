import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  LessThanOrEqual,
  Repository,
} from 'typeorm';
import {
  Order,
  OrderItem,
  PointsEntryStatus,
  PointsEntryType,
  PointsLedgerEntry,
} from '../../entities';

export interface PointsBalance {
  pendingCents: number;
  claimableCents: number;
  redeemedCents: number;
  expiredCents: number;
}

const VEST_DAYS = 90;
const EXPIRE_DAYS = 180;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class PointsService {
  private readonly logger = new Logger(PointsService.name);

  constructor(
    @InjectRepository(PointsLedgerEntry)
    private readonly ledger: Repository<PointsLedgerEntry>,
    private readonly dataSource: DataSource,
  ) {}

  async getBalance(userId: string): Promise<PointsBalance> {
    const entries = await this.ledger.find({ where: { userId } });

    let pendingCents = 0;
    let claimableCents = 0;
    let redeemedCents = 0;
    let expiredCents = 0;

    for (const e of entries) {
      if (e.type === PointsEntryType.EARNED) {
        if (e.status === PointsEntryStatus.PENDING) {
          pendingCents += e.amountCents;
        } else if (e.status === PointsEntryStatus.CLAIMABLE) {
          claimableCents += e.amountCents;
        }
      }
      if (
        e.type === PointsEntryType.REDEEMED &&
        e.status === PointsEntryStatus.REDEEMED
      ) {
        redeemedCents += Math.abs(e.amountCents);
      }
      if (e.type === PointsEntryType.EXPIRED) {
        expiredCents += Math.abs(e.amountCents);
      }
    }

    return { pendingCents, claimableCents, redeemedCents, expiredCents };
  }

  async getHistory(userId: string): Promise<PointsLedgerEntry[]> {
    return this.ledger.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  async creditForOrder(orderId: string, tx?: EntityManager): Promise<void> {
    const run = async (mgr: EntityManager) => {
      const orderRepo = mgr.getRepository(Order);
      const itemRepo = mgr.getRepository(OrderItem);
      const ledgerRepo = mgr.getRepository(PointsLedgerEntry);

      const order = await orderRepo.findOne({ where: { id: orderId } });
      if (!order) return;

      const existing = await ledgerRepo.count({
        where: { orderId: order.id, type: PointsEntryType.EARNED },
      });
      if (existing > 0) return;

      const items = await itemRepo.find({
        where: { orderId: order.id },
        relations: ['product'],
      });

      const now = new Date();
      const claimableAt = new Date(now.getTime() + VEST_DAYS * MS_PER_DAY);
      const expiresAt = new Date(now.getTime() + EXPIRE_DAYS * MS_PER_DAY);

      for (const item of items) {
        const priceCents = Math.round(parseFloat(item.priceAtOrder) * 100);
        const lineCents = priceCents * item.quantity;
        const pointsPct = parseFloat(item.product.pointsPct ?? '0');
        if (pointsPct <= 0) continue;
        const earnedCents = Math.round((lineCents * pointsPct) / 100);
        if (earnedCents <= 0) continue;

        await ledgerRepo.save(
          ledgerRepo.create({
            userId: order.customerId,
            type: PointsEntryType.EARNED,
            status: PointsEntryStatus.PENDING,
            amountCents: earnedCents,
            orderId: order.id,
            claimableAt,
            expiresAt,
          }),
        );
      }
    };

    if (tx) return run(tx);
    return this.dataSource.transaction(run);
  }

  async redeemAllClaimable(
    userId: string,
    orderId: string,
    tx: EntityManager,
  ): Promise<number> {
    const ledgerRepo = tx.getRepository(PointsLedgerEntry);

    const claimable = await ledgerRepo.find({
      where: {
        userId,
        type: PointsEntryType.EARNED,
        status: PointsEntryStatus.CLAIMABLE,
      },
    });

    if (claimable.length === 0) return 0;

    const totalCents = claimable.reduce((sum, e) => sum + e.amountCents, 0);
    if (totalCents <= 0) return 0;

    for (const entry of claimable) {
      entry.status = PointsEntryStatus.REDEEMED;
      entry.orderId = orderId;
      await ledgerRepo.save(entry);
    }

    await ledgerRepo.save(
      ledgerRepo.create({
        userId,
        type: PointsEntryType.REDEEMED,
        status: PointsEntryStatus.REDEEMED,
        amountCents: -totalCents,
        orderId,
        claimableAt: null,
        expiresAt: null,
      }),
    );

    return totalCents;
  }

  @Cron('0 3 * * *')
  async vestingTick() {
    return this.runVestingTick();
  }

  async runVestingTick(): Promise<{ vested: number; expired: number }> {
    const now = new Date();
    let vestedCount = 0;
    let expiredCount = 0;

    await this.dataSource.transaction(async (tx) => {
      const ledgerRepo = tx.getRepository(PointsLedgerEntry);

      const pendingDue = await ledgerRepo.find({
        where: {
          type: PointsEntryType.EARNED,
          status: PointsEntryStatus.PENDING,
          claimableAt: LessThanOrEqual(now),
        },
      });
      for (const e of pendingDue) {
        e.status = PointsEntryStatus.CLAIMABLE;
        await ledgerRepo.save(e);
        vestedCount++;
      }

      const claimableDue = await ledgerRepo.find({
        where: {
          type: PointsEntryType.EARNED,
          status: PointsEntryStatus.CLAIMABLE,
          expiresAt: LessThanOrEqual(now),
        },
      });
      for (const e of claimableDue) {
        e.status = PointsEntryStatus.EXPIRED;
        await ledgerRepo.save(e);
        await ledgerRepo.save(
          ledgerRepo.create({
            userId: e.userId,
            type: PointsEntryType.EXPIRED,
            status: PointsEntryStatus.EXPIRED,
            amountCents: -e.amountCents,
            orderId: null,
            claimableAt: null,
            expiresAt: null,
          }),
        );
        expiredCount++;
      }
    });

    this.logger.log(
      `Vesting tick: vested=${vestedCount} expired=${expiredCount}`,
    );
    return { vested: vestedCount, expired: expiredCount };
  }
}
