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

export enum PointsEntryType {
  EARNED = 'earned',
  REDEEMED = 'redeemed',
  EXPIRED = 'expired',
}

export enum PointsEntryStatus {
  PENDING = 'pending',
  CLAIMABLE = 'claimable',
  REDEEMED = 'redeemed',
  EXPIRED = 'expired',
}

@Entity({ name: 'points_ledger_entries' })
export class PointsLedgerEntry {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ type: 'enum', enum: PointsEntryType })
  type!: PointsEntryType;

  @Column({ type: 'enum', enum: PointsEntryStatus })
  status!: PointsEntryStatus;

  @Column({ name: 'amount_cents', type: 'int' })
  amountCents!: number;

  @Column({ name: 'order_id', type: 'uuid', nullable: true })
  orderId!: string | null;

  @Column({
    name: 'claimable_at',
    type: 'timestamp with time zone',
    nullable: true,
  })
  claimableAt!: Date | null;

  @Column({
    name: 'expires_at',
    type: 'timestamp with time zone',
    nullable: true,
  })
  expiresAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
