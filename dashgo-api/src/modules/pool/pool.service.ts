import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import {
  Order,
  OrderItem,
  PointsEntryStatus,
  PointsEntryType,
  PointsLedgerEntry,
  PoolContribution,
  PoolContributionSource,
} from '../../entities';
import { quarterOf } from './quarter';

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

    // Misma cuenta que usaba PointsService.creditForOrder (redondeo por línea),
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
}
