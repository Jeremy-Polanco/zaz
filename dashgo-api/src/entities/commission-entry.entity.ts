import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from './user.entity';
import { Order } from './order.entity';
import { Payout } from './payout.entity';
import { PaymentMethod } from './enums';

export enum CommissionEntryType {
  EARNED = 'earned',
  PAID_OUT = 'paid_out',
}

export enum CommissionEntryStatus {
  PENDING = 'pending',
  CLAIMABLE = 'claimable',
  PAID = 'paid',
}

/** Quién gana la comisión. Promotores y vendedores comparten esta tabla. */
export enum EarnerRole {
  PROMOTER = 'promoter',
  SELLER = 'seller',
}

/**
 * Un asiento de comisión. Una sola tabla para promotores y vendedores: dos
 * tablas paralelas darían dos respuestas a "cuánto le debo a esta persona", y
 * ninguna confiable.
 */
@Entity({ name: 'commission_entries' })
@Index('idx_commission_entries_earner', ['earnerId', 'earnerRole'])
export class CommissionEntry {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'earner_id', type: 'uuid' })
  earnerId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'earner_id' })
  earner!: User;

  @Column({
    name: 'earner_role',
    type: 'varchar',
    length: 20,
    default: EarnerRole.PROMOTER,
  })
  earnerRole!: EarnerRole;

  /**
   * El usuario cuya orden generó la comisión. Para un promotor es su referido;
   * para un vendedor, el cliente de su cartera.
   */
  @Column({ name: 'referred_user_id', type: 'uuid', nullable: true })
  referredUserId!: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'referred_user_id' })
  referredUser!: User | null;

  @Column({ name: 'order_id', type: 'uuid', nullable: true })
  orderId!: string | null;

  @ManyToOne(() => Order, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'order_id' })
  order!: Order | null;

  @Column({ type: 'enum', enum: CommissionEntryType })
  type!: CommissionEntryType;

  @Column({ type: 'enum', enum: CommissionEntryStatus })
  status!: CommissionEntryStatus;

  @Column({ name: 'amount_cents', type: 'int' })
  amountCents!: number;

  /**
   * Cómo pagó el cliente la orden que generó esta comisión.
   *
   * Tarjeta y efectivo NO son la misma deuda: con tarjeta la plata entró a la
   * empresa y se le debe la comisión completa a quien la ganó; en efectivo
   * alguien ya agarró los billetes. Mezclarlos en un solo total hace pagar de
   * más. NULL en asientos históricos, que no lo registraban.
   */
  @Column({
    name: 'payment_method',
    type: 'varchar',
    length: 16,
    nullable: true,
  })
  paymentMethod!: PaymentMethod | null;

  @Column({
    name: 'claimable_at',
    type: 'timestamp with time zone',
    nullable: true,
  })
  claimableAt!: Date | null;

  @Column({ name: 'payout_id', type: 'uuid', nullable: true })
  payoutId!: string | null;

  @ManyToOne(() => Payout, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'payout_id' })
  payout!: Payout | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
