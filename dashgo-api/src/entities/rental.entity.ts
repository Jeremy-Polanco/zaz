import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from './user.entity';
import { Product } from './product.entity';
import { Order } from './order.entity';

export enum RentalStatus {
  PENDING_SETUP = 'pending_setup',
  ACTIVE = 'active',
  PAST_DUE = 'past_due',
  UNPAID = 'unpaid',
  CANCELED = 'canceled',
}

/**
 * Tracks a rental contract between a user and a rental-mode product.
 *
 * Lifecycle:
 *  pending_setup → active   (via activateForOrder after capture)
 *  active        → past_due (via webhook customer.subscription.updated)
 *  past_due      → unpaid   (via webhook)
 *  any           → canceled (via admin cancel or webhook customer.subscription.deleted)
 *
 * stripeSubscriptionId is NULLABLE while status='pending_setup' — the Stripe
 * Subscription is created AFTER the DB row so Stripe calls stay outside the TX.
 *
 * One active Rental per (userId × productId) is enforced at the service layer
 * with SELECT … FOR UPDATE inside the activation TX.
 */
@Entity('rentals')
@Index('IDX_rentals_user_id', ['userId'])
@Index('IDX_rentals_status', ['status'])
@Index('IDX_rentals_user_product_status', ['userId', 'productId', 'status'])
export class Rental {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ name: 'product_id', type: 'uuid' })
  productId!: string;

  @ManyToOne(() => Product, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'product_id' })
  product!: Product;

  /**
   * orderId links the Rental to the Order that triggered activation.
   * Nullable: SET NULL if the order is deleted (rare, admin purge only).
   */
  @Column({ name: 'order_id', type: 'uuid', nullable: true })
  orderId!: string | null;

  @ManyToOne(() => Order, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'order_id' })
  order!: Order | null;

  /**
   * Stripe Subscription ID — null while pending_setup (Stripe call not yet made).
   * UNIQUE constraint prevents duplicate subscriptions from reaching the DB.
   */
  @Column({ name: 'stripe_subscription_id', type: 'varchar', length: 64, nullable: true, unique: true })
  stripeSubscriptionId!: string | null;

  /** Snapshot of the Stripe Price ID at activation time. Preserved even if Product.stripePriceId rotates. */
  @Column({ name: 'stripe_price_id', type: 'varchar', length: 64 })
  stripePriceId!: string;

  @Column({ type: 'enum', enum: RentalStatus, default: RentalStatus.PENDING_SETUP })
  status!: RentalStatus;

  /** Snapshot of monthly rent in cents at the time the Rental was created. */
  @Column({ name: 'monthly_rent_cents', type: 'integer' })
  monthlyRentCents!: number;

  /** Snapshot of the late-fee amount in cents at the time the Rental was created. */
  @Column({ name: 'late_fee_cents', type: 'integer' })
  lateFeeCents!: number;

  /**
   * Snapshot of the one-time theft/replacement fee (cents) at Rental creation.
   * Charged at most once via chargeTheftFee. 0 disables the charge.
   */
  @Column({ name: 'theft_fee_cents', type: 'integer', default: 0 })
  theftFeeCents!: number;

  /**
   * Timestamp of the (single) successful theft-fee charge, or null if never
   * charged. Guards against double-charging — chargeTheftFee rejects once set.
   */
  @Column({ name: 'theft_fee_charged_at', type: 'timestamptz', nullable: true })
  theftFeeChargedAt!: Date | null;

  @Column({ name: 'current_period_start', type: 'timestamptz', nullable: true })
  currentPeriodStart!: Date | null;

  @Column({ name: 'current_period_end', type: 'timestamptz', nullable: true })
  currentPeriodEnd!: Date | null;

  @Column({ name: 'activated_at', type: 'timestamptz', nullable: true })
  activatedAt!: Date | null;

  @Column({ name: 'canceled_at', type: 'timestamptz', nullable: true })
  canceledAt!: Date | null;

  /**
   * Timestamp of the first transition into PAST_DUE status (write-once).
   * Day 0 for the 3-day grace period is the UTC date of this column.
   * Set by handleSubscriptionUpdated only when transitioning INTO PAST_DUE.
   */
  @Column({ name: 'past_due_since', type: 'timestamptz', nullable: true })
  pastDueSince!: Date | null;

  /**
   * Timestamp of the most recent successful late-fee charge.
   * Updated by chargeLateFee on Stripe success.
   * Used by LateFeeCron to enforce daily idempotency (last_late_fee_at::date < CURRENT_DATE).
   */
  @Column({ name: 'last_late_fee_at', type: 'timestamptz', nullable: true })
  lastLateFeeAt!: Date | null;

  /**
   * When the next bebedero maintenance is due (countdown anchor).
   * The 30-day clock = next_maintenance_at − now. NULL means this rental does
   * not track maintenance (its product has requires_maintenance = false).
   * Set at activation (activated_at + 30d) and reset to now + 30d each time a
   * maintenance-service order is delivered for this user.
   */
  @Column({ name: 'next_maintenance_at', type: 'timestamptz', nullable: true })
  nextMaintenanceAt!: Date | null;

  /** Timestamp of the most recent completed maintenance (NULL until the first one). */
  @Column({ name: 'last_maintenance_at', type: 'timestamptz', nullable: true })
  lastMaintenanceAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
