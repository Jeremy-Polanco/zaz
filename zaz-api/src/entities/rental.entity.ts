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

  @Column({ name: 'current_period_start', type: 'timestamptz', nullable: true })
  currentPeriodStart!: Date | null;

  @Column({ name: 'current_period_end', type: 'timestamptz', nullable: true })
  currentPeriodEnd!: Date | null;

  @Column({ name: 'activated_at', type: 'timestamptz', nullable: true })
  activatedAt!: Date | null;

  @Column({ name: 'canceled_at', type: 'timestamptz', nullable: true })
  canceledAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
