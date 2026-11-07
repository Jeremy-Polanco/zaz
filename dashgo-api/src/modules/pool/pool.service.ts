import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import {
  AssociateBalanceEntry,
  AssociateBalanceEntryType,
  Order,
  OrderItem,
  PointsEntryStatus,
  PointsEntryType,
  PointsLedgerEntry,
  PoolContribution,
  PoolContributionSource,
  PoolDistribution,
  User,
} from '../../entities';
import { UserRole } from '../../entities/enums';
import { nextDistributionAt, nextQuarter, quarterOf } from './quarter';

export interface PoolSummary {
  quarter: string;
  poolCents: number;
  /** ISO 8601. */
  nextDistributionAt: string;
  associateCount: number;
  /** floor(pool / n); 0 si no hay asociados. */
  estimatedShareCents: number;
}

/**
 * Aportes al pool trimestral de asociados. Los puntos que generan las compras
 * ya no se le acreditan al cliente: se suman al pool del trimestre en que se
 * entrega la orden.
 */
@Injectable()
export class PoolService {
  private readonly logger = new Logger(PoolService.name);

  constructor(
    @InjectRepository(PoolContribution)
    private readonly contributions: Repository<PoolContribution>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Aporta al pool lo que la orden habría acreditado en puntos al cliente. Se
   * inserta UNA sola fila por orden (la suma de sus líneas) para que cada
   * aporte sea trazable a su orden y el índice único parcial pueda impedir el
   * doble aporte. El trimestre es el de la fecha de ENTREGA en hora de NY, no
   * el de creación: el pool se arma con lo efectivamente entregado.
   *
   * Idempotente por orden (un reintento de la entrega o del webhook no
   * duplica). Devuelve los centavos aportados en ESTA llamada; 0 si no había
   * puntos que aportar o si la orden ya había aportado.
   */
  async contributeForOrder(
    orderId: string,
    tx: EntityManager,
    now?: Date,
  ): Promise<number> {
    const order = await tx.findOne(Order, { where: { id: orderId } });
    if (!order) return 0;

    const already = await tx.exists(PoolContribution, {
      where: { orderId: order.id, source: PoolContributionSource.ORDER },
    });
    if (already) return 0;

    const items = await tx.find(OrderItem, {
      where: { orderId: order.id },
      relations: ['product'],
    });

    // Misma cuenta que usaba el antiguo servicio de puntos de cliente (redondeo por línea),
    // para que el pool recaude exactamente lo que antes se acreditaba.
    let totalCents = 0;
    for (const item of items) {
      const priceCents = Math.round(parseFloat(item.priceAtOrder) * 100);
      const lineCents = priceCents * item.quantity;
      const pointsPct = parseFloat(item.product?.pointsPct ?? '0');
      if (pointsPct <= 0) continue;
      const earnedCents = Math.round((lineCents * pointsPct) / 100);
      if (earnedCents <= 0) continue;
      totalCents += earnedCents;
    }
    if (totalCents <= 0) return 0;

    // ON CONFLICT DO NOTHING: si dos entregas corren a la vez, el índice único
    // parcial deja pasar solo una y la otra no cuenta nada.
    const result = await tx
      .createQueryBuilder()
      .insert()
      .into(PoolContribution)
      .values({
        quarter: quarterOf(now ?? new Date()),
        amountCents: totalCents,
        source: PoolContributionSource.ORDER,
        orderId: order.id,
        sourceUserId: order.customerId,
      })
      .orIgnore()
      .returning('id')
      .execute();

    return result.raw.length > 0 ? totalCents : 0;
  }

  /**
   * Reverso de un canje VIEJO (hecho con puntos del cliente antes de que
   * existiera el pool) cuando la orden se cancela. Esos puntos ya no se le
   * devuelven al cliente: al activarse el pool pasaron a ser del pool y él ya
   * no puede gastarlos. Por eso quedan en `pooled` y el monto completo entra
   * al trimestre actual como aporte `legacy_reversal`.
   *
   * Idempotente: la segunda llamada no encuentra EARNED en `redeemed` y
   * devuelve 0. Devuelve el total aportado.
   */
  async reverseLegacyRedemption(
    orderId: string,
    tx: EntityManager,
  ): Promise<number> {
    const redeemedEntries = await tx.find(PointsLedgerEntry, {
      where: {
        orderId,
        type: PointsEntryType.EARNED,
        status: PointsEntryStatus.REDEEMED,
      },
    });
    if (redeemedEntries.length === 0) return 0;

    for (const entry of redeemedEntries) {
      entry.status = PointsEntryStatus.POOLED;
      await tx.save(PointsLedgerEntry, entry);
    }

    // La entrada negativa solo registraba el canje; ya no hay nada que canjear.
    await tx.delete(PointsLedgerEntry, {
      orderId,
      type: PointsEntryType.REDEEMED,
    });

    const totalCents = redeemedEntries.reduce(
      (sum, e) => sum + e.amountCents,
      0,
    );
    if (totalCents <= 0) return 0;

    await tx.insert(PoolContribution, {
      quarter: quarterOf(new Date()),
      amountCents: totalCents,
      source: PoolContributionSource.LEGACY_REVERSAL,
      orderId,
      sourceUserId: redeemedEntries[0].userId,
    });

    this.logger.log(
      `reverseLegacyRedemption: ${totalCents}c de la orden ${orderId} pasan al pool`,
    );
    return totalCents;
  }

  /**
   * Saca del pool el aporte de una orden que se cancela después de entregada
   * (solo la alcanza la operación masiva cancelNonRentalOrders; updateStatus
   * bloquea DELIVERED -> CANCELLED). Una venta cancelada no puede financiar el
   * pool de los asociados, PERO si el trimestre ya se repartió el reparto no se
   * toca: lo pagado no se reclama, y el pool de un trimestre cerrado ya no se
   * recalcula. Devuelve los centavos retirados; 0 si no había aporte o el
   * trimestre está cerrado.
   */
  async withdrawOrderContribution(
    orderId: string,
    tx: EntityManager,
  ): Promise<number> {
    // Se bloquea la fila del aporte ANTES de mirar si hay reparto. Así una
    // cancelación que corre justo al cierre del trimestre pasa de una de dos
    // formas: retira el aporte antes de que el reparto sume (el reparto espera
    // el lock y después ya no ve la fila), o ve el reparto ya hecho y deja el
    // aporte. Nunca queda un total repartido distinto del pool.
    const contribution = await tx.findOne(PoolContribution, {
      where: { orderId, source: PoolContributionSource.ORDER },
      lock: { mode: 'pessimistic_write' },
    });
    if (!contribution) return 0;

    const closed = await tx.exists(PoolDistribution, {
      where: { quarter: contribution.quarter },
    });
    if (closed) return 0;

    await tx.delete(PoolContribution, { id: contribution.id });
    return contribution.amountCents;
  }

  /** Total recaudado en un trimestre ('YYYY-Qn'): suma de sus aportes. */
  async getPoolCents(quarter: string, mgr?: EntityManager): Promise<number> {
    const manager = mgr ?? this.contributions.manager;
    const row = await manager
      .createQueryBuilder(PoolContribution, 'c')
      .select('COALESCE(SUM(c.amount_cents), 0)', 'sum')
      .where('c.quarter = :quarter', { quarter })
      .getRawOne<{ sum: string }>();
    return Number(row?.sum ?? 0);
  }

  /**
   * Reparte el pool de un trimestre en partes IGUALES entre los usuarios con
   * rol `associate` en este momento. Cada asociado es dueño de su parte por
   * igual; lo que no divide exacto (el resto) pasa como aporte `carryover` al
   * trimestre siguiente para que no se pierda ni un centavo.
   *
   * Idempotente y a prueba de dos instancias: lo primero que hace es RECLAMAR
   * el trimestre insertando su fila en `pool_distributions` con
   * ON CONFLICT DO NOTHING. Si no devuelve fila, otra corrida ya lo reparte (o
   * lo repartió) y se devuelve `null` sin escribir nada más; si dos corren a la
   * vez, la segunda espera en el índice único hasta que la primera commitea y
   * recién ahí recibe el DO NOTHING. Con el reclamo hecho, hay exactamente un
   * reparto por trimestre y nadie más suma ni asigna.
   */
  async distributeQuarter(quarter: string): Promise<PoolDistribution | null> {
    return this.dataSource.transaction(async (tx) => {
      const claim = await tx.query(
        `INSERT INTO pool_distributions (quarter, total_cents, associate_count, share_cents, remainder_cents)
         VALUES ($1, 0, 0, 0, 0)
         ON CONFLICT (quarter) DO NOTHING
         RETURNING id`,
        [quarter],
      );
      if (claim.length === 0) return null;
      const distributionId: string = claim[0].id;

      // FOR UPDATE sobre los aportes: una cancelación concurrente
      // (withdrawOrderContribution) espera a este reparto o lo hace esperar,
      // así el total repartido es exactamente lo que queda en el pool.
      const rows: Array<{ amount_cents: number }> = await tx.query(
        `SELECT amount_cents FROM pool_contributions WHERE quarter = $1 FOR UPDATE`,
        [quarter],
      );
      const totalCents = rows.reduce((sum, r) => sum + Number(r.amount_cents), 0);

      const associates = await tx.find(User, {
        where: { role: UserRole.ASSOCIATE },
        select: { id: true },
        order: { id: 'ASC' },
      });
      const n = associates.length;
      // Sin asociados no hay a quién repartir: todo el pool pasa adelante.
      const shareCents = n === 0 ? 0 : Math.floor(totalCents / n);
      const remainderCents = totalCents - shareCents * n;

      await tx.update(PoolDistribution, distributionId, {
        totalCents,
        associateCount: n,
        shareCents,
        remainderCents,
      });

      // Con menos centavos que asociados la parte es 0: no se asientan filas
      // de 0 en el libro.
      if (shareCents > 0) {
        await tx.insert(
          AssociateBalanceEntry,
          associates.map((a) => ({
            userId: a.id,
            type: AssociateBalanceEntryType.ALLOCATION,
            amountCents: shareCents,
            distributionId,
          })),
        );
      }

      if (remainderCents > 0) {
        await tx.insert(PoolContribution, {
          quarter: nextQuarter(quarter),
          amountCents: remainderCents,
          source: PoolContributionSource.CARRYOVER,
        });
      }

      this.logger.log(
        `distributeQuarter ${quarter}: total ${totalCents}c, ${n} asociados, parte ${shareCents}c, arrastre ${remainderCents}c`,
      );
      return tx.findOneByOrFail(PoolDistribution, { id: distributionId });
    });
  }

  /**
   * Reparte todos los trimestres vencidos que quedaron sin repartir (la app
   * estuvo caída el día del corte, un deploy se comió el cron). Va del MÁS
   * viejo al más nuevo y de a uno: el arrastre de un trimestre cae en el
   * siguiente, y ese siguiente tiene que repartirse DESPUÉS para que lo
   * incluya. El trimestre en curso nunca se reparte. Devuelve los trimestres
   * repartidos por esta corrida, en orden.
   */
  async distributeDueQuarters(now: Date = new Date()): Promise<string[]> {
    const current = quarterOf(now);
    const done: string[] = [];
    const tried = new Set<string>();

    for (;;) {
      const [row] = await this.dataSource.query(
        `SELECT MIN(c.quarter) AS quarter
           FROM pool_contributions c
          WHERE c.quarter < $1
            AND NOT EXISTS (SELECT 1 FROM pool_distributions d WHERE d.quarter = c.quarter)`,
        [current],
      );
      const quarter: string | null = row?.quarter ?? null;
      // Defensa: si un trimestre vuelve a salir sin haberse podido repartir,
      // se corta en vez de girar en falso.
      if (!quarter || tried.has(quarter)) break;
      tried.add(quarter);

      const distribution = await this.distributeQuarter(quarter);
      if (distribution) done.push(quarter);
    }
    return done;
  }

  /** Repartos hechos, del trimestre más reciente al más viejo. */
  listDistributions(): Promise<PoolDistribution[]> {
    return this.dataSource
      .getRepository(PoolDistribution)
      .find({ order: { quarter: 'DESC' } });
  }

  /**
   * Resumen del pool en curso para la pantalla de asociados. La parte
   * estimada es lo que tocaría HOY si se repartiera ya: cambia si entran
   * aportes o asociados antes del corte, por eso es una estimación y no un
   * saldo. Con 0 asociados es 0 (no hay división por cero).
   */
  async getSummary(now: Date = new Date()): Promise<PoolSummary> {
    const quarter = quarterOf(now);
    const [poolCents, associateCount] = await Promise.all([
      this.getPoolCents(quarter),
      this.dataSource
        .getRepository(User)
        .count({ where: { role: UserRole.ASSOCIATE } }),
    ]);
    return {
      quarter,
      poolCents,
      nextDistributionAt: nextDistributionAt(now).toISOString(),
      associateCount,
      estimatedShareCents:
        associateCount > 0 ? Math.floor(poolCents / associateCount) : 0,
    };
  }
}
