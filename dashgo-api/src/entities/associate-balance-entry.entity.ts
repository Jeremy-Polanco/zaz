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
import { PoolDistribution } from './pool-distribution.entity';
import { User } from './user.entity';

export enum AssociateBalanceEntryType {
  /** Su parte de un reparto trimestral (+). */
  ALLOCATION = 'allocation',
  /** Saldo usado para pagar una orden (−). */
  REDEMPTION = 'redemption',
  /** Devolución del saldo cuando se cancela esa orden (+). */
  REVERSAL = 'reversal',
}

/**
 * Libro de saldo del asociado: el saldo es la suma firmada de sus asientos, no
 * una columna mutable, así cada centavo tiene origen y destino auditables.
 */
@Entity({ name: 'associate_balance_entries' })
@Index('idx_associate_balance_entries_user', ['userId'])
// Un asociado recibe UNA parte por reparto.
@Index('uq_associate_balance_allocation', ['distributionId', 'userId'], {
  unique: true,
  where: `"type" = 'allocation'`,
})
// Una orden descuenta saldo una sola vez, y lo devuelve una sola vez.
@Index('uq_associate_balance_redemption', ['orderId'], {
  unique: true,
  where: `"type" = 'redemption'`,
})
@Index('uq_associate_balance_reversal', ['orderId'], {
  unique: true,
  where: `"type" = 'reversal'`,
})
export class AssociateBalanceEntry {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ type: 'varchar', length: 20 })
  type!: AssociateBalanceEntryType;

  /** Firmado: positivo suma saldo, negativo lo gasta. */
  @Column({ name: 'amount_cents', type: 'int' })
  amountCents!: number;

  @Column({ name: 'distribution_id', type: 'uuid', nullable: true })
  distributionId!: string | null;

  @ManyToOne(() => PoolDistribution, { nullable: true })
  @JoinColumn({ name: 'distribution_id' })
  distribution!: PoolDistribution | null;

  @Column({ name: 'order_id', type: 'uuid', nullable: true })
  orderId!: string | null;

  @ManyToOne(() => Order, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'order_id' })
  order!: Order | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
