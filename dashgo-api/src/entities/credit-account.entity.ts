/**
 * CreditAccount — one row per user, created lazily on first access.
 *
 * Sign convention (IMPORTANT):
 *   - balance_cents and credit_limit_cents are always >= 0 at rest.
 *   - A negative balance_cents means the user owes money.
 *   - amount_cents on CreditMovement is ALWAYS POSITIVE; the `type` field
 *     communicates whether it adds to or subtracts from the balance.
 *     grant/reversal/payment → increment balance
 *     charge                 → decrement balance
 *     adjustment             → any direction (handled by service)
 */
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from './user.entity';

@Entity('credit_account')
export class CreditAccount {
  /** FK → users.id ON DELETE RESTRICT */
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @OneToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ name: 'balance_cents', type: 'int', default: 0 })
  balanceCents!: number;

  @Column({ name: 'credit_limit_cents', type: 'int', default: 0 })
  creditLimitCents!: number;

  @Column({ name: 'due_date', type: 'timestamptz', nullable: true })
  dueDate!: Date | null;

  @Column({ type: 'varchar', length: 3, default: 'usd' })
  currency!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
