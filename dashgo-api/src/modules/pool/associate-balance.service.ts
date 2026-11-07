import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import {
  AssociateBalanceEntry,
  AssociateBalanceEntryType,
} from '../../entities';

/**
 * Libro de saldo del asociado. El saldo NO es una columna en `users`: es la
 * suma firmada de sus asientos, así cada centavo tiene origen (reparto) y
 * destino (orden) auditables y no hay un número que se pueda desincronizar.
 */
@Injectable()
export class AssociateBalanceService {
  constructor(
    @InjectRepository(AssociateBalanceEntry)
    private readonly entries: Repository<AssociateBalanceEntry>,
  ) {}

  async getBalanceCents(userId: string, mgr?: EntityManager): Promise<number> {
    const manager = mgr ?? this.entries.manager;
    const row = await manager
      .createQueryBuilder(AssociateBalanceEntry, 'e')
      .select('COALESCE(SUM(e.amount_cents), 0)', 'sum')
      .where('e.user_id = :userId', { userId })
      .getRawOne<{ sum: string }>();
    return Number(row?.sum ?? 0);
  }

  getHistory(userId: string): Promise<AssociateBalanceEntry[]> {
    return this.entries.find({
      where: { userId },
      relations: { distribution: true },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Descuenta del saldo SOLO lo que el pedido necesita (canje parcial): el bug
   * viejo quemaba todo el saldo reclamable al canjear, aunque la orden costara
   * menos. Corre dentro de la transacción del checkout (`tx`).
   */
  async redeem(
    userId: string,
    orderId: string,
    amountCents: number,
    tx: EntityManager,
  ): Promise<void> {
    if (amountCents <= 0) return;

    // Lock (ver lockUser) de la fila del usuario ANTES de recalcular: dos checkouts a la vez
    // se serializan acá, y el segundo ve el saldo ya descontado por el primero,
    // así que no se puede gastar dos veces el mismo saldo (ni quedar negativo).
    await this.lockUser(userId, tx);

    const balance = await this.getBalanceCents(userId, tx);
    if (balance < amountCents) {
      throw new BadRequestException({
        code: 'INSUFFICIENT_BALANCE',
        message: 'Tu saldo de asociado no alcanza para este pedido',
      });
    }

    await tx.insert(AssociateBalanceEntry, {
      userId,
      type: AssociateBalanceEntryType.REDEMPTION,
      amountCents: -amountCents,
      orderId,
    });
  }

  /**
   * Devuelve el saldo canjeado por una orden (p. ej. al cancelarla). Idempotente:
   * un webhook repetido o un doble cancel no devuelve dos veces. Retorna el
   * monto devuelto, o 0 si no había nada que devolver.
   */
  async reverseForOrder(orderId: string, tx: EntityManager): Promise<number> {
    const redemption = await tx.findOne(AssociateBalanceEntry, {
      where: { orderId, type: AssociateBalanceEntryType.REDEMPTION },
    });
    if (!redemption) return 0;

    // Mismo lock que redeem: dos reversos concurrentes de la misma orden se
    // serializan y el segundo ve la reversión del primero (el índice único
    // parcial queda como segunda red de seguridad).
    await this.lockUser(redemption.userId, tx);

    const alreadyReversed = await tx.exists(AssociateBalanceEntry, {
      where: { orderId, type: AssociateBalanceEntryType.REVERSAL },
    });
    if (alreadyReversed) return 0;

    const amountCents = -redemption.amountCents;
    await tx.insert(AssociateBalanceEntry, {
      userId: redemption.userId,
      type: AssociateBalanceEntryType.REVERSAL,
      amountCents,
      orderId,
    });
    return amountCents;
  }

  /**
   * FOR NO KEY UPDATE y no FOR UPDATE: en el checkout la orden se inserta ANTES
   * de canjear, y ese insert toma FOR KEY SHARE sobre la fila del usuario (FK
   * orders.customer_id). FOR UPDATE choca con KEY SHARE, así que dos checkouts
   * del mismo asociado quedaban cada uno con KEY SHARE esperando al otro:
   * deadlock (40P01) y un 500 aunque el saldo alcanzara para los dos. NO KEY
   * UPDATE sigue serializando canje contra canje (y reverso contra reverso) y
   * sigue impidiendo borrar al usuario, pero no choca con KEY SHARE.
   * La garantía supone READ COMMITTED (el default): el segundo, al despertar,
   * recalcula el saldo viendo lo que el primero ya commiteó.
   */
  private async lockUser(userId: string, tx: EntityManager): Promise<void> {
    await tx.query('SELECT id FROM users WHERE id = $1 FOR NO KEY UPDATE', [
      userId,
    ]);
  }
}
