import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Order } from './order.entity';
import { User } from './user.entity';

/** De dónde viene un aporte al pool. */
export enum PoolContributionSource {
  /** Puntos generados por una orden (lo que antes se le acreditaba al cliente). */
  ORDER = 'order',
  /** Puntos sin usar que tenían los clientes al activarse el pool. */
  LEGACY_MIGRATION = 'legacy_migration',
  /** Ajuste negativo cuando se anula un aporte legacy. */
  LEGACY_REVERSAL = 'legacy_reversal',
  /** Resto del trimestre anterior que no se pudo repartir en partes iguales. */
  CARRYOVER = 'carryover',
}

/**
 * Un aporte al pool trimestral de asociados. El pool de un trimestre es la
 * suma de sus aportes: un asiento por evento en vez de un total mutable, para
 * poder auditar de dónde salió cada centavo repartido.
 */
@Entity({ name: 'pool_contributions' })
// Una orden aporta UNA sola vez: protege contra el reintento de un webhook o de
// la confirmación. Parcial porque los demás orígenes no tienen orden.
@Index('uq_pool_contributions_order', ['orderId'], {
  unique: true,
  where: `"source" = 'order'`,
})
export class PoolContribution {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('idx_pool_contributions_quarter')
  @Column({ type: 'varchar', length: 7 })
  quarter!: string;

  @Column({ name: 'amount_cents', type: 'int' })
  amountCents!: number;

  @Column({ type: 'varchar', length: 20 })
  source!: PoolContributionSource;

  @Column({ name: 'order_id', type: 'uuid', nullable: true })
  orderId!: string | null;

  @ManyToOne(() => Order, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'order_id' })
  order!: Order | null;

  /**
   * El cliente cuyos puntos originaron el aporte. SET NULL y no CASCADE: borrar
   * la cuenta de un cliente no puede achicar el pool ya recaudado.
   */
  @Column({ name: 'source_user_id', type: 'uuid', nullable: true })
  sourceUserId!: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'source_user_id' })
  sourceUser!: User | null;

  /**
   * Fila de `points_ledger_entries` de la que salió un aporte legacy. Sin FK a
   * propósito: es solo la huella para poder revertir la migración, y el ledger
   * no debe quedar atado a esta tabla.
   */
  @Column({ name: 'legacy_points_entry_id', type: 'uuid', nullable: true })
  legacyPointsEntryId!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
