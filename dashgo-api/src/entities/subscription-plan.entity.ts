import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('subscription_plan')
export class SubscriptionPlan {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'stripe_product_id', type: 'varchar', length: 64 })
  stripeProductId!: string;

  @Column({ name: 'active_stripe_price_id', type: 'varchar', length: 64 })
  activeStripePriceId!: string;

  @Column({ name: 'unit_amount_cents', type: 'integer' })
  unitAmountCents!: number;

  @Column({ type: 'varchar', length: 8, default: 'usd' })
  currency!: string;

  @Column({ type: 'varchar', length: 16, default: 'month' })
  interval!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
