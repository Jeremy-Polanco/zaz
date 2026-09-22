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
import { SubscriptionTier } from './subscription-plan.entity';

export enum SubscriptionStatus {
  ACTIVE = 'active',
  PAST_DUE = 'past_due',
  CANCELED = 'canceled',
  UNPAID = 'unpaid',
  INCOMPLETE = 'incomplete',
  INCOMPLETE_EXPIRED = 'incomplete_expired',
}

/**
 * Tracks a user's Stripe subscription (plan mensual).
 *
 * Lo que cubre el plan: el bebedero (el primero gratis, los adicionales a la
 * tarifa de suscriptor), el precio de suscriptor por producto, el producto
 * premium y el mantenimiento. El ENVÍO no: desde 2026-09-14 el envío fijo lo
 * paga toda orden de cliente, suscriptor o no.
 *
 * `user_id` NO es único (ver migración
 * 1811000000000-DropSubscriptionsUserIdUnique): un usuario acumula una fila
 * por cada suscripción de Stripe que tuvo — cancelar y volver a suscribirse
 * crea una fila nueva con un `stripe_subscription_id` distinto. Todo el
 * código ya asumía esto (la más nueva por `current_period_end` gana en
 * `getMySubscription`, cancel/reactivate, el listado admin de usuarios y
 * `PlanDelinquencyListener`); la unique constraint original solo servía para
 * romper la re-suscripción con un duplicate key.
 */
@Entity('subscriptions')
@Index('IDX_subscriptions_user_id', ['userId'])
export class Subscription {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ name: 'stripe_subscription_id', type: 'varchar', length: 64, unique: true })
  stripeSubscriptionId!: string;

  @Column({ type: 'enum', enum: SubscriptionStatus })
  status!: SubscriptionStatus;

  /**
   * En qué plan está esta suscripción. Snapshot resuelto contra el
   * `stripe_product_id` del plan y NO contra el price id: al cambiar el precio
   * Stripe emite un price nuevo y el viejo sigue vivo para quien ya estaba
   * suscripto, así que el price id no identifica el plan. El producto no rota.
   */
  @Column({
    type: 'varchar',
    length: 20,
    default: SubscriptionTier.STANDARD,
  })
  tier!: SubscriptionTier;

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
