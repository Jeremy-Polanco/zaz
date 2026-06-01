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

  // customer_id is NULLABLE so we can SET NULL on account deletion (FIX C2).
  // Tax/accounting law in RD requires up to 7-year invoice retention, so we
  // can't hard-delete orders. Instead, on AuthService.deleteAccount, we set
  // customer_id=NULL and copy a redaction marker into customer_name_snapshot.
  @Index()
  @Column({ name: 'customer_id', type: 'uuid', nullable: true })
  customerId!: string | null;

  @ManyToOne(() => User, (user) => user.orders, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'customer_id' })
  customer!: User | null;

  // Snapshot fields populated ONLY when the customer's account is deleted
  // (FIX C2). At rest, they are null and joining `customer` gives the live
  // user. After deletion: customer_name_snapshot='Cuenta eliminada',
  // customer_phone_snapshot=null. The remaining order columns
  // (subtotal, totalAmount, taxRate, …) carry the business record forward.
  @Column({
    name: 'customer_name_snapshot',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  customerNameSnapshot!: string | null;

  @Column({
    name: 'customer_phone_snapshot',
    type: 'varchar',
    length: 40,
    nullable: true,
  })
  customerPhoneSnapshot!: string | null;

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
