import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from './user.entity';

export enum SubscriptionStatus {
  ACTIVE = 'active',
  PAST_DUE = 'past_due',
  CANCELED = 'canceled',
  UNPAID = 'unpaid',
  INCOMPLETE = 'incomplete',
  INCOMPLETE_EXPIRED = 'incomplete_expired',
}

/**
 * Billing model for dispenser acquisition.
 * - RENTAL: recurring monthly charge via Stripe Subscription (stripeSubscriptionId = sub_*)
 * - PURCHASE: one-time charge via Stripe PaymentIntent (stripeSubscriptionId = 'purchase:<pi.id>')
 */
export enum SubscriptionModel {
  RENTAL = 'rental',
  PURCHASE = 'purchase',
}

/**
 * Tracks dispenser acquisition (rental or purchase) for a user.
 *
 * Mutual-exclusion contract:
 *   model='rental'   → stripeSubscriptionId SET (sub_*), stripeChargeId NULL, purchasedAt NULL
 *   model='purchase' → stripeChargeId SET (pi_*), purchasedAt SET,
 *                      stripeSubscriptionId = 'purchase:<pi.id>' (synthetic sentinel to satisfy
 *                      the existing NOT NULL UNIQUE constraint without a destructive migration),
 *                      currentPeriodEnd = 9999-12-31 (sentinel so isActiveSubscriber() stays true),
 *                      status = 'active' permanently.
 *
 * The webhook handler ignores rows with stripeSubscriptionId starting with 'purchase:' because
 * Stripe subscription IDs always begin with 'sub_'.
 */
@Entity('subscriptions')
export class Subscription {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid', unique: true })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ name: 'stripe_subscription_id', type: 'varchar', length: 64, unique: true })
  stripeSubscriptionId!: string;

  @Column({ type: 'enum', enum: SubscriptionStatus })
  status!: SubscriptionStatus;

  /**
   * Billing model: 'rental' (recurring Stripe Subscription) or 'purchase' (one-time PaymentIntent).
   * Defaults to 'rental' for all pre-existing rows.
   */
  @Column({ type: 'varchar', length: 16, default: 'rental' })
  model!: SubscriptionModel;

  /**
   * PaymentIntent ID for purchase-model rows. NULL for rental rows.
   */
  @Column({ name: 'stripe_charge_id', type: 'varchar', length: 64, nullable: true })
  stripeChargeId!: string | null;

  /**
   * Timestamp when the one-time purchase was confirmed. NULL for rental rows.
   */
  @Column({ name: 'purchased_at', type: 'timestamptz', nullable: true })
  purchasedAt!: Date | null;

  @Column({ name: 'current_period_start', type: 'timestamptz' })
  currentPeriodStart!: Date;

  @Column({ name: 'current_period_end', type: 'timestamptz' })
  currentPeriodEnd!: Date;

  @Column({ name: 'cancel_at_period_end', type: 'boolean', default: false })
  cancelAtPeriodEnd!: boolean;

  @Column({ name: 'canceled_at', type: 'timestamptz', nullable: true })
  canceledAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
