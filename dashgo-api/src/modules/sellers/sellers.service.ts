import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import {
  CommissionEntry,
  CommissionEntryStatus,
  CommissionEntryType,
  EarnerRole,
  Order,
  OrderItem,
  SellerProduct,
  User,
} from '../../entities';
import { PaymentMethod, UserRole } from '../../entities/enums';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { computeSellerCommissionCents } from './commission-math';

/** Mismo vesting que las comisiones de promotores — una sola regla. */
const COMMISSION_VEST_DAYS = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface SellerEarningsBreakdown {
  /** Devengado pero todavía no cobrable (en vesting). */
  pendingCents: number;
  /** Cobrable: venció el vesting y no se pagó. */
  claimableCents: number;
  /** Ya pagado. */
  paidCents: number;
}

export interface SellerEarnings extends SellerEarningsBreakdown {
  sellerId: string;
  /**
   * El MISMO total, separado por cómo pagó el cliente.
   *
   * Con tarjeta la plata entró a la empresa: se le debe la comisión completa.
   * En efectivo alguien ya agarró los billetes. Un solo número mezclado hace
   * pagar de más — por eso el desglose no es un extra, es el dato.
   */
  byPaymentMethod: {
    card: SellerEarningsBreakdown;
    cash: SellerEarningsBreakdown;
    unknown: SellerEarningsBreakdown;
  };
}

@Injectable()
export class SellersService {
  private readonly logger = new Logger(SellersService.name);

  constructor(
    @InjectRepository(CommissionEntry)
    private readonly commissions: Repository<CommissionEntry>,
    @InjectRepository(SellerProduct)
    private readonly sellerProducts: Repository<SellerProduct>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Devenga la comisión del vendedor por una orden entregada.
   *
   * Espejo de `PromotersService.creditCommissionsForOrder`, con dos
   * diferencias: el % sale del catálogo del vendedor (no del producto), y el
   * asiento guarda con qué método se pagó.
   *
   * Idempotente por (orden, rol): si ya hay un asiento de vendedor para esa
   * orden no crea otro. El webhook de entrega puede reintentarse.
   */
  async creditCommissionsForOrder(
    orderId: string,
    tx?: EntityManager,
  ): Promise<void> {
    const run = async (mgr: EntityManager) => {
      const orderRepo = mgr.getRepository(Order);
      const itemRepo = mgr.getRepository(OrderItem);
      const userRepo = mgr.getRepository(User);
      const commRepo = mgr.getRepository(CommissionEntry);
      const catalogRepo = mgr.getRepository(SellerProduct);

      const order = await orderRepo.findOne({ where: { id: orderId } });
      if (!order) return;

      const customer = await userRepo.findOne({
        where: { id: order.customerId },
      });
      // Sin cliente o sin vendedor asignado no hay a quién comisionar.
      if (!customer?.sellerId) return;

      const seller = await userRepo.findOne({
        where: { id: customer.sellerId },
      });
      // Un `seller_id` que ya no es vendedor (degradado) no cobra. La cartera
      // se desasigna al degradarlo, así que esto es cinturón y tiradores.
      if (!seller || seller.role !== UserRole.SELLER) return;

      const existing = await commRepo.count({
        where: {
          orderId: order.id,
          earnerRole: EarnerRole.SELLER,
          type: CommissionEntryType.EARNED,
        },
      });
      if (existing > 0) return;

      const [items, catalog] = await Promise.all([
        itemRepo.find({ where: { orderId: order.id } }),
        catalogRepo.find({ where: { sellerId: seller.id } }),
      ]);

      const pctByProduct = new Map(
        catalog.map((c) => [c.productId, parseFloat(c.commissionPct)]),
      );
      const totalCents = computeSellerCommissionCents(
        items.map((i) => ({
          productId: i.productId,
          priceCents: Math.round(parseFloat(i.priceAtOrder) * 100),
          quantity: i.quantity,
        })),
        pctByProduct,
      );
      if (totalCents <= 0) return;

      const now = new Date();
      await commRepo.save(
        commRepo.create({
          earnerId: seller.id,
          earnerRole: EarnerRole.SELLER,
          referredUserId: customer.id,
          orderId: order.id,
          type: CommissionEntryType.EARNED,
          status: CommissionEntryStatus.PENDING,
          amountCents: totalCents,
          paymentMethod: order.paymentMethod,
          claimableAt: new Date(
            now.getTime() + COMMISSION_VEST_DAYS * MS_PER_DAY,
          ),
          payoutId: null,
        }),
      );
    };

    if (tx) return run(tx);
    return this.dataSource.transaction(run);
  }

  /**
   * Ingresos de un vendedor. El super admin puede pedir los de cualquiera; un
   * vendedor solo los suyos.
   */
  async getEarnings(
    sellerId: string,
    actor: AuthenticatedUser,
  ): Promise<SellerEarnings> {
    if (actor.role !== UserRole.SUPER_ADMIN_DELIVERY) {
      if (actor.role !== UserRole.SELLER || actor.id !== sellerId) {
        throw new ForbiddenException('Sin acceso a estos ingresos');
      }
    }

    const entries = await this.commissions.find({
      where: { earnerId: sellerId, earnerRole: EarnerRole.SELLER },
    });

    const empty = (): SellerEarningsBreakdown => ({
      pendingCents: 0,
      claimableCents: 0,
      paidCents: 0,
    });
    const total = empty();
    const byPaymentMethod = {
      card: empty(),
      cash: empty(),
      unknown: empty(),
    };

    const now = new Date();
    for (const e of entries) {
      if (e.type !== CommissionEntryType.EARNED) continue;
      const bucket =
        e.paymentMethod === PaymentMethod.DIGITAL
          ? byPaymentMethod.card
          : e.paymentMethod === PaymentMethod.CASH
            ? byPaymentMethod.cash
            : byPaymentMethod.unknown;

      // `claimable` se deriva de la fecha, no de un cron: un asiento vencido
      // cuenta como cobrable aunque nadie haya corrido el job todavía.
      const isPaid = e.status === CommissionEntryStatus.PAID;
      const isClaimable =
        !isPaid && (!e.claimableAt || e.claimableAt <= now);

      const key = isPaid
        ? 'paidCents'
        : isClaimable
          ? 'claimableCents'
          : 'pendingCents';
      total[key] += e.amountCents;
      bucket[key] += e.amountCents;
    }

    return { sellerId, ...total, byPaymentMethod };
  }

  /**
   * Resumen para el admin: cuánto hay que pagarle a cada vendedor, separado
   * por cómo cobró el cliente.
   */
  async getPayableSummary(
    actor: AuthenticatedUser,
  ): Promise<(SellerEarnings & { fullName: string })[]> {
    if (actor.role !== UserRole.SUPER_ADMIN_DELIVERY) {
      throw new ForbiddenException();
    }
    const sellers = await this.users.find({
      where: { role: UserRole.SELLER },
    });
    return Promise.all(
      sellers.map(async (s) => ({
        ...(await this.getEarnings(s.id, actor)),
        fullName: s.fullName,
      })),
    );
  }
}
