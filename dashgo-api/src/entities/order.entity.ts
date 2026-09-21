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

  // Nullable: customers order without an address; the super-admin sets it at
  // delivery time via PATCH /orders/:id/delivery-address.
  @Column({ name: 'delivery_address', type: 'jsonb', nullable: true })
  deliveryAddress!: GeoAddress | null;

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

  /**
   * Recargo por distancia — el "delivery aparte del envío" que el dueño le
   * cobra al cliente lejano. Columna SEPARADA de `shipping` a propósito y por
   * una razón de plata, no de estética: son DOS cargos distintos — el envío es
   * el VIAJE (la tarifa plana que fija el super admin y paga toda orden de
   * cliente) y el recargo es la DISTANCIA, que el admin tipea al cotizar. Si
   * compartieran columna, perdonar el envío perdonaría también el recargo y el
   * cliente lejano viajaría gratis.
   *
   * Se prorratea igual que el envío para el impuesto (ver common/tax.ts).
   */
  @Column({
    name: 'delivery_surcharge',
    type: 'numeric',
    precision: 10,
    scale: 2,
    default: 0,
  })
  deliverySurcharge!: string;

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

  /**
   * QUÉ LEY le puso precio a este pedido: 'NJ', 'NYC' o NULL (ninguna — se
   * cobró el fallback histórico).
   *
   * Se congela junto con `tax_rate` porque el número solo no se explica: un
   * 0.06625 en 2029 no dice si fue New Jersey, una zona con override, o un
   * error. Con el código al lado, una auditoría se contesta leyendo la fila.
   *
   * NULL en todos los pedidos anteriores a la migración 1809 — es un dato
   * esperado, no un faltante.
   */
  @Column({
    name: 'tax_jurisdiction',
    type: 'varchar',
    length: 16,
    nullable: true,
  })
  taxJurisdiction!: string | null;

  /**
   * Base gravable congelada al cotizar: la parte del pedido sobre la que se
   * aplicó `tax_rate`, ya con el envío y los puntos prorrateados.
   *
   * Sin esto el cálculo no se puede reconstruir después. La orden guarda UN
   * solo `tax_rate`, y con ítems mixtos (agua exenta + producto gravado) el
   * rate por sí solo no explica el impuesto cobrado. Este es el número que
   * responde una auditoría.
   */
  @Column({
    name: 'taxable_subtotal',
    type: 'numeric',
    precision: 10,
    scale: 2,
    default: 0,
  })
  taxableSubtotal!: string;

  @Column({
    name: 'total_amount',
    type: 'numeric',
    precision: 10,
    scale: 2,
  })
  totalAmount!: string;

  // Propina — digital-only, % of product subtotal, untaxed (added after tax).
  // Included in totalAmount, so the Stripe charge picks it up unchanged.
  @Column({
    type: 'numeric',
    precision: 10,
    scale: 2,
    default: 0,
  })
  tip!: string;

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

  /**
   * Día de entrega que el super-admin le asigna a la orden. `date` y no
   * `timestamptz`: es un DÍA de reparto ("te toca el martes"), no un instante —
   * guardarlo con hora arrastraría zona horaria y correría el día en el borde.
   * Null = sin día asignado todavía.
   */
  @Column({ name: 'scheduled_delivery_date', type: 'date', nullable: true })
  scheduledDeliveryDate!: string | null;

  @Column({ name: 'authorized_at', type: 'timestamptz', nullable: true })
  authorizedAt!: Date | null;

  @Column({ name: 'captured_at', type: 'timestamptz', nullable: true })
  capturedAt!: Date | null;

  @Column({ name: 'was_subscriber_at_quote', type: 'boolean', default: false })
  wasSubscriberAtQuote!: boolean;

  // True when the order was created as skip-cotización (every item
  // requiresQuote=false → se auto-cotiza al crearse, con el envío fijo ya
  // cargado). Drives auto-confirm: such orders advance PENDING_VALIDATION →
  // CONFIRMED_BY_COLMADO without an admin review step once paid/confirmed.
  //
  // NO se infiere de shipping=0 — es un flag persistido a propósito: el envío
  // puede quedar en $0 por otros motivos (la orden que provisiona el sistema,
  // o un envío que el admin perdona al cotizar) y eso no la vuelve
  // skip-cotización.
  @Column({ name: 'skip_quote', type: 'boolean', default: false })
  skipQuote!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @OneToMany(() => OrderItem, (item) => item.order, {
    cascade: ['insert'],
    eager: true,
  })
  items!: OrderItem[];
}
