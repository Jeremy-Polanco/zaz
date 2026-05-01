import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
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
  Payout,
  PromoterCommissionEntry,
  PromoterCommissionEntryStatus,
  PromoterCommissionEntryType,
  User,
} from '../../entities';
import { UserRole } from '../../entities/enums';
import { InvitePromoterDto } from './dto/invite-promoter.dto';
import { generateReferralCode } from './referral-code';

const MAX_CODE_ATTEMPTS = 5;
const UNIQUE_VIOLATION_CODE = '23505';
const COMMISSION_VEST_DAYS = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface PromoterListItem {
  id: string;
  fullName: string;
  phone: string | null;
  referralCode: string | null;
  referredCount: number;
  claimableCents: number;
  pendingCents: number;
  paidCents: number;
  createdAt: Date;
}

export interface PromoterPublicInfo {
  fullName: string;
}

export interface PromoterMyStats {
  id: string;
  fullName: string;
  phone: string | null;
  referralCode: string | null;
  referredCount: number;
  shareUrl: string;
}

export interface PromoterInviteResponse {
  id: string;
  fullName: string;
  phone: string | null;
  referralCode: string | null;
  referredCount: number;
  shareUrl: string;
  createdAt: Date;
}

export interface PromoterBalances {
  pendingCents: number;
  claimableCents: number;
  paidCents: number;
}

export interface ReferredCustomerSummary {
  id: string;
  fullName: string;
  firstOrderAt: string | null;
  orderCount: number;
  totalSpentCents: number;
  totalCommissionGeneratedCents: number;
}

export interface PromoterCommissionEntryView {
  id: string;
  type: PromoterCommissionEntryType;
  status: PromoterCommissionEntryStatus;
  amountCents: number;
  orderId: string | null;
  referredUserId: string | null;
  referredUserName: string | null;
  claimableAt: string | null;
  payoutId: string | null;
  createdAt: string;
}

export interface PayoutView {
  id: string;
  amountCents: number;
  notes: string | null;
  createdAt: string;
  createdBy: { id: string; fullName: string } | null;
}

export interface PromoterDashboardView {
  promoter: {
    id: string;
    fullName: string;
    phone: string | null;
    referralCode: string | null;
    shareUrl: string;
  };
  balances: PromoterBalances;
  referredCount: number;
  referredCustomers: ReferredCustomerSummary[];
  recentCommissions: PromoterCommissionEntryView[];
  payouts: PayoutView[];
}

export interface CommissionsPageFilter {
  status?: PromoterCommissionEntryStatus;
  page?: number;
  pageSize?: number;
}

export interface CommissionsPage {
  items: PromoterCommissionEntryView[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

@Injectable()
export class PromotersService {
  private readonly logger = new Logger(PromotersService.name);

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(PromoterCommissionEntry)
    private readonly commissions: Repository<PromoterCommissionEntry>,
    @InjectRepository(Payout) private readonly payouts: Repository<Payout>,
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  // -----------------------------
  // Invite / listing (existing)
  // -----------------------------

  async invite(dto: InvitePromoterDto): Promise<PromoterInviteResponse> {
    const phone = dto.phone.trim();
    const fullName = dto.fullName.trim();

    const existing = await this.users.findOne({ where: { phone } });
    if (existing) {
      throw new ConflictException('Ya existe un usuario con ese teléfono');
    }

    let lastError: unknown = null;
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
      const referralCode = generateReferralCode(8);
      try {
        const saved = await this.users.save(
          this.users.create({
            phone,
            fullName,
            email: null,
            role: UserRole.PROMOTER,
            referralCode,
          }),
        );
        return this.toInviteResponse(saved, 0);
      } catch (err) {
        lastError = err;
        const errorCode = (err as { code?: string })?.code;
        if (errorCode === UNIQUE_VIOLATION_CODE) {
          this.logger.warn(
            `Referral code collision for attempt ${attempt + 1}, retrying`,
          );
          continue;
        }
        throw err;
      }
    }

    this.logger.error(
      'Se agotaron los reintentos generando código de referido',
      lastError as Error,
    );
    throw new ConflictException(
      'No se pudo generar un código de referido único',
    );
  }

  async getAll(): Promise<PromoterListItem[]> {
    const promoters = await this.users.find({
      where: { role: UserRole.PROMOTER },
      order: { createdAt: 'DESC' },
    });

    if (promoters.length === 0) return [];

    const ids = promoters.map((p) => p.id);
    const [counts, balances] = await Promise.all([
      this.countReferredBy(ids),
      this.balancesFor(ids),
    ]);

    return promoters.map((p) => {
      const b = balances.get(p.id) ?? {
        pendingCents: 0,
        claimableCents: 0,
        paidCents: 0,
      };
      return {
        id: p.id,
        fullName: p.fullName,
        phone: p.phone,
        referralCode: p.referralCode,
        referredCount: counts.get(p.id) ?? 0,
        claimableCents: b.claimableCents,
        pendingCents: b.pendingCents,
        paidCents: b.paidCents,
        createdAt: p.createdAt,
      };
    });
  }

  async getByCode(code: string): Promise<PromoterPublicInfo> {
    const normalized = code.trim().toUpperCase();
    const promoter = await this.users.findOne({
      where: { referralCode: normalized, role: UserRole.PROMOTER },
    });
    if (!promoter) {
      throw new NotFoundException('Código de referido no encontrado');
    }
    return { fullName: promoter.fullName };
  }

  async getMyStats(userId: string): Promise<PromoterMyStats> {
    const promoter = await this.users.findOne({ where: { id: userId } });
    if (!promoter) {
      throw new NotFoundException('Promotor no encontrado');
    }
    if (promoter.role !== UserRole.PROMOTER) {
      throw new NotFoundException('Este usuario no es un promotor');
    }

    const referredCount = await this.users.count({
      where: { referredById: promoter.id },
    });

    return {
      id: promoter.id,
      fullName: promoter.fullName,
      phone: promoter.phone,
      referralCode: promoter.referralCode,
      referredCount,
      shareUrl: this.buildShareUrl(promoter.referralCode),
    };
  }

  async findPromoterByReferralCode(code: string): Promise<User | null> {
    const normalized = code.trim().toUpperCase();
    if (!normalized) return null;
    return this.users.findOne({
      where: { referralCode: normalized, role: UserRole.PROMOTER },
    });
  }

  // -----------------------------
  // Commission ledger
  // -----------------------------

  async creditCommissionsForOrder(
    orderId: string,
    tx?: EntityManager,
  ): Promise<void> {
    const run = async (mgr: EntityManager) => {
      const orderRepo = mgr.getRepository(Order);
      const itemRepo = mgr.getRepository(OrderItem);
      const userRepo = mgr.getRepository(User);
      const commRepo = mgr.getRepository(PromoterCommissionEntry);

      const order = await orderRepo.findOne({ where: { id: orderId } });
      if (!order) return;

      const customer = await userRepo.findOne({
        where: { id: order.customerId },
      });
      if (!customer) return;

      // No referrer → no commission
      if (!customer.referredById) return;

      // Self-referral safety
      if (customer.referredById === customer.id) return;

      const promoter = await userRepo.findOne({
        where: { id: customer.referredById },
      });
      if (!promoter) return;
      if (promoter.role !== UserRole.PROMOTER) return;

      // Idempotency: if we already have an earned commission for this order,
      // skip to avoid double-crediting on repeat hook calls.
      const existing = await commRepo.count({
        where: {
          orderId: order.id,
          type: PromoterCommissionEntryType.EARNED,
        },
      });
      if (existing > 0) return;

      const items = await itemRepo.find({
        where: { orderId: order.id },
        relations: ['product'],
      });

      let totalCommissionCents = 0;
      for (const item of items) {
        const priceCents = Math.round(parseFloat(item.priceAtOrder) * 100);
        const lineCents = priceCents * item.quantity;
        const commissionPct = parseFloat(
          item.product.promoterCommissionPct ?? '0',
        );
        if (commissionPct <= 0) continue;
        const lineCommissionCents = Math.round(
          (lineCents * commissionPct) / 100,
        );
        if (lineCommissionCents <= 0) continue;
        totalCommissionCents += lineCommissionCents;
      }

      if (totalCommissionCents <= 0) return;

      const now = new Date();
      const claimableAt = new Date(
        now.getTime() + COMMISSION_VEST_DAYS * MS_PER_DAY,
      );

      await commRepo.save(
        commRepo.create({
          promoterId: promoter.id,
          referredUserId: customer.id,
          orderId: order.id,
          type: PromoterCommissionEntryType.EARNED,
          status: PromoterCommissionEntryStatus.PENDING,
          amountCents: totalCommissionCents,
          claimableAt,
          payoutId: null,
        }),
      );
    };

    if (tx) return run(tx);
    return this.dataSource.transaction(run);
  }

  @Cron('0 3 * * *')
  async commissionVestingTick() {
    return this.runVestingTick();
  }

  async runVestingTick(): Promise<{ vested: number }> {
    const now = new Date();
    let vested = 0;

    await this.dataSource.transaction(async (tx) => {
      const commRepo = tx.getRepository(PromoterCommissionEntry);
      const pendingDue = await commRepo.find({
        where: {
          type: PromoterCommissionEntryType.EARNED,
          status: PromoterCommissionEntryStatus.PENDING,
          claimableAt: LessThanOrEqual(now),
        },
      });
      for (const e of pendingDue) {
        e.status = PromoterCommissionEntryStatus.CLAIMABLE;
        await commRepo.save(e);
        vested++;
      }
    });

    this.logger.log(`Commission vesting tick: vested=${vested}`);
    return { vested };
  }

  // -----------------------------
  // Dashboards
  // -----------------------------

  async getDashboardForPromoter(userId: string): Promise<PromoterDashboardView> {
    const promoter = await this.users.findOne({ where: { id: userId } });
    if (!promoter) {
      throw new NotFoundException('Promotor no encontrado');
    }
    if (promoter.role !== UserRole.PROMOTER) {
      throw new ForbiddenException('Este usuario no es un promotor');
    }
    return this.buildDashboard(promoter);
  }

  async getDashboardAsAdmin(promoterId: string): Promise<PromoterDashboardView> {
    const promoter = await this.users.findOne({ where: { id: promoterId } });
    if (!promoter || promoter.role !== UserRole.PROMOTER) {
      throw new NotFoundException('Promotor no encontrado');
    }
    return this.buildDashboard(promoter);
  }

  async getCommissionsForPromoter(
    userId: string,
    params: CommissionsPageFilter,
  ): Promise<CommissionsPage> {
    const promoter = await this.users.findOne({ where: { id: userId } });
    if (!promoter || promoter.role !== UserRole.PROMOTER) {
      throw new NotFoundException('Promotor no encontrado');
    }
    return this.pageCommissions(promoter.id, params);
  }

  async getCommissionsAsAdmin(
    promoterId: string,
    params: CommissionsPageFilter,
  ): Promise<CommissionsPage> {
    const promoter = await this.users.findOne({ where: { id: promoterId } });
    if (!promoter || promoter.role !== UserRole.PROMOTER) {
      throw new NotFoundException('Promotor no encontrado');
    }
    return this.pageCommissions(promoter.id, params);
  }

  async getPayouts(promoterId: string): Promise<PayoutView[]> {
    const promoter = await this.users.findOne({ where: { id: promoterId } });
    if (!promoter || promoter.role !== UserRole.PROMOTER) {
      throw new NotFoundException('Promotor no encontrado');
    }
    return this.listPayouts(promoter.id);
  }

  async getMyPayouts(userId: string): Promise<PayoutView[]> {
    const promoter = await this.users.findOne({ where: { id: userId } });
    if (!promoter || promoter.role !== UserRole.PROMOTER) {
      throw new NotFoundException('Promotor no encontrado');
    }
    return this.listPayouts(promoter.id);
  }

  // -----------------------------
  // Payouts
  // -----------------------------

  async createPayout(
    promoterId: string,
    superAdminId: string,
    notes: string | null,
  ): Promise<PayoutView> {
    return this.dataSource.transaction(async (tx) => {
      const userRepo = tx.getRepository(User);
      const commRepo = tx.getRepository(PromoterCommissionEntry);
      const payoutRepo = tx.getRepository(Payout);

      const promoter = await userRepo.findOne({ where: { id: promoterId } });
      if (!promoter || promoter.role !== UserRole.PROMOTER) {
        throw new NotFoundException('Promotor no encontrado');
      }

      const superAdmin = await userRepo.findOne({
        where: { id: superAdminId },
      });
      if (!superAdmin) {
        throw new NotFoundException('Administrador no encontrado');
      }

      // Lock claimable entries for this promoter
      const claimable = await commRepo.find({
        where: {
          promoterId: promoter.id,
          type: PromoterCommissionEntryType.EARNED,
          status: PromoterCommissionEntryStatus.CLAIMABLE,
        },
        lock: { mode: 'pessimistic_write' },
      });

      if (claimable.length === 0) {
        throw new BadRequestException(
          'No hay comisiones disponibles para pagar',
        );
      }

      const totalCents = claimable.reduce((sum, e) => sum + e.amountCents, 0);
      if (totalCents <= 0) {
        throw new BadRequestException(
          'No hay comisiones disponibles para pagar',
        );
      }

      const payout = await payoutRepo.save(
        payoutRepo.create({
          promoterId: promoter.id,
          amountCents: totalCents,
          notes: notes && notes.trim().length > 0 ? notes.trim() : null,
          createdByUserId: superAdmin.id,
        }),
      );

      for (const entry of claimable) {
        entry.status = PromoterCommissionEntryStatus.PAID;
        entry.payoutId = payout.id;
        await commRepo.save(entry);
      }

      // Audit aggregated paid_out entry
      await commRepo.save(
        commRepo.create({
          promoterId: promoter.id,
          referredUserId: null,
          orderId: null,
          type: PromoterCommissionEntryType.PAID_OUT,
          status: PromoterCommissionEntryStatus.PAID,
          amountCents: -totalCents,
          claimableAt: null,
          payoutId: payout.id,
        }),
      );

      return {
        id: payout.id,
        amountCents: payout.amountCents,
        notes: payout.notes,
        createdAt: payout.createdAt.toISOString(),
        createdBy: { id: superAdmin.id, fullName: superAdmin.fullName },
      };
    });
  }

  // -----------------------------
  // Internal helpers
  // -----------------------------

  private async buildDashboard(promoter: User): Promise<PromoterDashboardView> {
    const [entries, payouts, referredCustomers] = await Promise.all([
      this.commissions.find({
        where: { promoterId: promoter.id },
        order: { createdAt: 'DESC' },
        relations: ['referredUser'],
      }),
      this.listPayouts(promoter.id, 10),
      this.buildReferredCustomerSummaries(promoter.id),
    ]);

    const balances = this.computeBalancesFromEntries(entries);
    const recentCommissions = entries
      .slice(0, 20)
      .map((e) => this.toCommissionView(e));

    return {
      promoter: {
        id: promoter.id,
        fullName: promoter.fullName,
        phone: promoter.phone,
        referralCode: promoter.referralCode,
        shareUrl: this.buildShareUrl(promoter.referralCode),
      },
      balances,
      referredCount: referredCustomers.length,
      referredCustomers,
      recentCommissions,
      payouts,
    };
  }

  private async pageCommissions(
    promoterId: string,
    params: CommissionsPageFilter,
  ): Promise<CommissionsPage> {
    const page = Math.max(1, Math.floor(params.page ?? 1));
    const pageSize = Math.min(
      100,
      Math.max(5, Math.floor(params.pageSize ?? 25)),
    );

    const qb = this.commissions
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.referredUser', 'referredUser')
      .where('c.promoter_id = :promoterId', { promoterId });

    if (params.status) {
      qb.andWhere('c.status = :status', { status: params.status });
    }

    qb.orderBy('c.createdAt', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);

    const [rows, totalCount] = await qb.getManyAndCount();
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

    return {
      items: rows.map((e) => this.toCommissionView(e)),
      page,
      pageSize,
      totalCount,
      totalPages,
    };
  }

  private async listPayouts(
    promoterId: string,
    limit?: number,
  ): Promise<PayoutView[]> {
    const qb = this.payouts
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.createdBy', 'createdBy')
      .where('p.promoter_id = :promoterId', { promoterId })
      .orderBy('p.createdAt', 'DESC');
    if (limit) qb.take(limit);
    const rows = await qb.getMany();
    return rows.map((p) => ({
      id: p.id,
      amountCents: p.amountCents,
      notes: p.notes,
      createdAt: p.createdAt.toISOString(),
      createdBy: p.createdBy
        ? { id: p.createdBy.id, fullName: p.createdBy.fullName }
        : null,
    }));
  }

  private async balancesFor(
    promoterIds: string[],
  ): Promise<Map<string, PromoterBalances>> {
    const result = new Map<string, PromoterBalances>();
    if (promoterIds.length === 0) return result;
    const entries = await this.commissions
      .createQueryBuilder('c')
      .where('c.promoter_id IN (:...ids)', { ids: promoterIds })
      .getMany();
    for (const id of promoterIds) {
      result.set(id, { pendingCents: 0, claimableCents: 0, paidCents: 0 });
    }
    for (const e of entries) {
      const b = result.get(e.promoterId);
      if (!b) continue;
      if (e.type === PromoterCommissionEntryType.EARNED) {
        if (e.status === PromoterCommissionEntryStatus.PENDING) {
          b.pendingCents += e.amountCents;
        } else if (e.status === PromoterCommissionEntryStatus.CLAIMABLE) {
          b.claimableCents += e.amountCents;
        } else if (e.status === PromoterCommissionEntryStatus.PAID) {
          b.paidCents += e.amountCents;
        }
      }
    }
    return result;
  }

  private computeBalancesFromEntries(
    entries: PromoterCommissionEntry[],
  ): PromoterBalances {
    let pendingCents = 0;
    let claimableCents = 0;
    let paidCents = 0;
    for (const e of entries) {
      if (e.type !== PromoterCommissionEntryType.EARNED) continue;
      if (e.status === PromoterCommissionEntryStatus.PENDING)
        pendingCents += e.amountCents;
      else if (e.status === PromoterCommissionEntryStatus.CLAIMABLE)
        claimableCents += e.amountCents;
      else if (e.status === PromoterCommissionEntryStatus.PAID)
        paidCents += e.amountCents;
    }
    return { pendingCents, claimableCents, paidCents };
  }

  private async buildReferredCustomerSummaries(
    promoterId: string,
  ): Promise<ReferredCustomerSummary[]> {
    const referred = await this.users.find({
      where: { referredById: promoterId },
      order: { createdAt: 'ASC' },
    });
    if (referred.length === 0) return [];

    const referredIds = referred.map((r) => r.id);
    const orderRepo = this.dataSource.getRepository(Order);
    const itemRepo = this.dataSource.getRepository(OrderItem);
    const commRepo = this.commissions;

    const orders = await orderRepo.find({
      where: referredIds.map((id) => ({ customerId: id })),
    });

    const ordersByCustomer = new Map<string, Order[]>();
    for (const id of referredIds) ordersByCustomer.set(id, []);
    for (const o of orders) {
      const list = ordersByCustomer.get(o.customerId);
      if (list) list.push(o);
    }

    const orderIds = orders.map((o) => o.id);
    const items = orderIds.length
      ? await itemRepo.find({ where: orderIds.map((id) => ({ orderId: id })) })
      : [];
    const itemsByOrder = new Map<string, OrderItem[]>();
    for (const it of items) {
      const list = itemsByOrder.get(it.orderId) ?? [];
      list.push(it);
      itemsByOrder.set(it.orderId, list);
    }

    const commissionsByReferred = new Map<string, number>();
    const earnedEntries = await commRepo.find({
      where: {
        promoterId,
        type: PromoterCommissionEntryType.EARNED,
      },
    });
    for (const e of earnedEntries) {
      if (!e.referredUserId) continue;
      commissionsByReferred.set(
        e.referredUserId,
        (commissionsByReferred.get(e.referredUserId) ?? 0) + e.amountCents,
      );
    }

    return referred.map((r) => {
      const custOrders = ordersByCustomer.get(r.id) ?? [];
      let totalSpentCents = 0;
      let firstOrderAt: Date | null = null;
      for (const o of custOrders) {
        const its = itemsByOrder.get(o.id) ?? [];
        for (const it of its) {
          const priceCents = Math.round(parseFloat(it.priceAtOrder) * 100);
          totalSpentCents += priceCents * it.quantity;
        }
        if (!firstOrderAt || o.createdAt < firstOrderAt) {
          firstOrderAt = o.createdAt;
        }
      }
      return {
        id: r.id,
        fullName: r.fullName,
        firstOrderAt: firstOrderAt ? firstOrderAt.toISOString() : null,
        orderCount: custOrders.length,
        totalSpentCents,
        totalCommissionGeneratedCents:
          commissionsByReferred.get(r.id) ?? 0,
      };
    });
  }

  private toCommissionView(
    e: PromoterCommissionEntry,
  ): PromoterCommissionEntryView {
    return {
      id: e.id,
      type: e.type,
      status: e.status,
      amountCents: e.amountCents,
      orderId: e.orderId,
      referredUserId: e.referredUserId,
      referredUserName: e.referredUser ? e.referredUser.fullName : null,
      claimableAt: e.claimableAt ? e.claimableAt.toISOString() : null,
      payoutId: e.payoutId,
      createdAt: e.createdAt.toISOString(),
    };
  }

  private async countReferredBy(
    promoterIds: string[],
  ): Promise<Map<string, number>> {
    if (promoterIds.length === 0) return new Map();
    const rows = await this.users
      .createQueryBuilder('u')
      .select('u.referred_by_id', 'promoterId')
      .addSelect('COUNT(u.id)', 'count')
      .where('u.referred_by_id IN (:...ids)', { ids: promoterIds })
      .groupBy('u.referred_by_id')
      .getRawMany<{ promoterId: string; count: string }>();
    const map = new Map<string, number>();
    for (const row of rows) {
      map.set(row.promoterId, parseInt(row.count, 10));
    }
    return map;
  }

  private buildShareUrl(code: string | null): string {
    const base =
      this.config.get<string>('PUBLIC_WEB_URL') ?? 'http://localhost:5173';
    const cleaned = base.replace(/\/+$/, '');
    return code ? `${cleaned}/r/${code}` : cleaned;
  }

  private toInviteResponse(
    user: User,
    referredCount: number,
  ): PromoterInviteResponse {
    return {
      id: user.id,
      fullName: user.fullName,
      phone: user.phone,
      referralCode: user.referralCode,
      referredCount,
      shareUrl: this.buildShareUrl(user.referralCode),
      createdAt: user.createdAt,
    };
  }
}
