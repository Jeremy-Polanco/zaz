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

export enum PromoterCommissionEntryType {
  EARNED = 'earned',
  PAID_OUT = 'paid_out',
}

export enum PromoterCommissionEntryStatus {
  PENDING = 'pending',
  CLAIMABLE = 'claimable',
  PAID = 'paid',
}

@Entity({ name: 'promoter_commission_entries' })
export class PromoterCommissionEntry {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'promoter_id', type: 'uuid' })
  promoterId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'promoter_id' })
  promoter!: User;

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

  @Column({ type: 'enum', enum: PromoterCommissionEntryType })
  type!: PromoterCommissionEntryType;

  @Column({ type: 'enum', enum: PromoterCommissionEntryStatus })
  status!: PromoterCommissionEntryStatus;

  @Column({ name: 'amount_cents', type: 'int' })
  amountCents!: number;

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
