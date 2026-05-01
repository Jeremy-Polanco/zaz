import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { CreditAccount } from './credit-account.entity';
import { Order } from './order.entity';
import { User } from './user.entity';

export enum CreditMovementType {
  GRANT = 'grant',
  CHARGE = 'charge',
  REVERSAL = 'reversal',
  PAYMENT = 'payment',
  /** @deprecated Use ADJUSTMENT_INCREASE or ADJUSTMENT_DECREASE for new writes. Kept for back-compat with existing rows. */
  ADJUSTMENT = 'adjustment',
  ADJUSTMENT_INCREASE = 'adjustment_increase',
  ADJUSTMENT_DECREASE = 'adjustment_decrease',
}

@Entity('credit_movement')
export class CreditMovement {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** FK → credit_account(user_id) ON DELETE CASCADE */
  @Column({ name: 'credit_account_id', type: 'uuid' })
  creditAccountId!: string;

  @ManyToOne(() => CreditAccount, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'credit_account_id', referencedColumnName: 'userId' })
  creditAccount!: CreditAccount;

  @Column({ type: 'enum', enum: CreditMovementType })
  type!: CreditMovementType;

  /**
   * Always POSITIVE. The `type` communicates direction:
   *   grant/reversal/payment → added to balance
   *   charge                 → subtracted from balance
   *   adjustment             → service adjusts balance by signed delta
   */
  @Column({ name: 'amount_cents', type: 'int' })
  amountCents!: number;

  /** nullable FK → orders.id ON DELETE SET NULL */
  @Column({ name: 'order_id', type: 'uuid', nullable: true })
  orderId!: string | null;

  @ManyToOne(() => Order, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'order_id' })
  order!: Order | null;

  /** nullable FK → users.id ON DELETE SET NULL */
  @Column({ name: 'performed_by_user_id', type: 'uuid', nullable: true })
  performedByUserId!: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'performed_by_user_id' })
  performedBy!: User | null;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  /**
   * Set when this movement records a customer self-payment via Stripe.
   * The unique partial index on this column makes webhook delivery idempotent:
   * a duplicate `payment_intent.succeeded` event collapses into the same row.
   */
  @Column({
    name: 'stripe_payment_intent_id',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  stripePaymentIntentId!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
