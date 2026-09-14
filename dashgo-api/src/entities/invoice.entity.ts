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

  /**
   * Recargo por distancia — snapshot del `delivery_surcharge` de la orden.
   *
   * Vive en su propia columna y no dentro de `shipping` por el mismo motivo que
   * en la orden: es OTRO cargo — el envío es el viaje, el recargo es la
   * distancia — y va en su propio renglón de la factura. Sin esta columna los
   * renglones no sumaban el total del cliente lejano: faltaba justo el recargo.
   */
  @Column({
    name: 'delivery_surcharge',
    type: 'numeric',
    precision: 10,
    scale: 2,
    default: 0,
  })
  deliverySurcharge!: string;

  // Propina — snapshotted from the order; untaxed, already inside `total`.
  @Column({ type: 'numeric', precision: 10, scale: 2, default: 0 })
  tip!: string;

  @Column({ type: 'numeric', precision: 10, scale: 2 })
  total!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
