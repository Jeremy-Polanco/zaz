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

@Entity({ name: 'payouts' })
export class Payout {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'promoter_id', type: 'uuid' })
  promoterId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'promoter_id' })
  promoter!: User;

  @Column({ name: 'amount_cents', type: 'int' })
  amountCents!: number;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  // FIX HIGH-G5 — created_by_user_id was ON DELETE RESTRICT, which blocked
  // any super_admin who issued payouts from deleting their own account.
  // The FK is now ON DELETE SET NULL and AuthService.deleteAccount
  // snapshots the admin's full name into `created_by_name_snapshot`
  // BEFORE the user row is removed so the audit display survives.
  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId!: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by_user_id' })
  createdBy!: User | null;

  @Column({
    name: 'created_by_name_snapshot',
    type: 'text',
    nullable: true,
  })
  createdByNameSnapshot!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
