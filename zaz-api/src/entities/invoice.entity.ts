import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Order } from './order.entity';

@Entity({ name: 'invoices' })
export class Invoice {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'order_id', type: 'uuid', unique: true })
  orderId!: string;

  @OneToOne(() => Order, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order!: Order;

  @Column({ name: 'invoice_number', type: 'varchar', length: 32, unique: true })
  invoiceNumber!: string;

  @Column({ type: 'numeric', precision: 10, scale: 2 })
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

  @Column({ type: 'numeric', precision: 10, scale: 2 })
  tax!: string;

  @Column({
    name: 'tax_rate',
    type: 'numeric',
    precision: 6,
    scale: 5,
  })
  taxRate!: string;

  @Column({ type: 'numeric', precision: 10, scale: 2 })
  total!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
