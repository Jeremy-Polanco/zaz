import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from './user.entity';
import { OrderItem } from './order-item.entity';
import type { GeoAddress } from './enums';
import { OrderStatus, PaymentMethod } from './enums';

@Entity('orders')
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @ManyToOne(() => User, (user) => user.orders, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'customer_id' })
  customer!: User;

  @Index()
  @Column({
    type: 'enum',
    enum: OrderStatus,
    default: OrderStatus.PENDING_QUOTE,
  })
  status!: OrderStatus;

  @Column({ name: 'delivery_address', type: 'jsonb' })
  deliveryAddress!: GeoAddress;

  @Column({
    type: 'numeric',
    precision: 10,
    scale: 2,
    default: 0,
  })
  subtotal!: string;

  @Column({
    name: 'points_redeemed',
    type: 'numeric',
    precision: 10,
    scale: 2,
    default: 0,
  })
  pointsRedeemed!: string;

  @Column({
    type: 'numeric',
    precision: 10,
    scale: 2,
    default: 0,
  })
  shipping!: string;

  @Column({
    type: 'numeric',
    precision: 10,
    scale: 2,
    default: 0,
  })
  tax!: string;

  @Column({
    name: 'tax_rate',
    type: 'numeric',
    precision: 6,
    scale: 5,
    default: 0.08887,
  })
  taxRate!: string;

  @Column({
    name: 'total_amount',
    type: 'numeric',
    precision: 10,
    scale: 2,
  })
  totalAmount!: string;

  @Column({
    name: 'credit_applied',
    type: 'numeric',
    precision: 10,
    scale: 2,
    default: '0.00',
  })
  creditApplied!: string;

  @Column({
    name: 'payment_method',
    type: 'enum',
    enum: PaymentMethod,
    default: PaymentMethod.CASH,
  })
  paymentMethod!: PaymentMethod;

  @Index()
  @Column({
    name: 'stripe_payment_intent_id',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  stripePaymentIntentId!: string | null;

  @Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
  paidAt!: Date | null;

  @Column({ name: 'quoted_at', type: 'timestamptz', nullable: true })
  quotedAt!: Date | null;

  @Column({ name: 'authorized_at', type: 'timestamptz', nullable: true })
  authorizedAt!: Date | null;

  @Column({ name: 'captured_at', type: 'timestamptz', nullable: true })
  capturedAt!: Date | null;

  @Column({ name: 'was_subscriber_at_quote', type: 'boolean', default: false })
  wasSubscriberAtQuote!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @OneToMany(() => OrderItem, (item) => item.order, {
    cascade: ['insert'],
    eager: true,
  })
  items!: OrderItem[];
}
