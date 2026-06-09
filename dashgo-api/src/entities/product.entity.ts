import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Category } from './category.entity';

@Entity('products')
export class Product {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({
    name: 'price_to_public',
    type: 'numeric',
    precision: 10,
    scale: 2,
  })
  priceToPublic!: string;

  @Column({ name: 'is_available', type: 'boolean', default: true })
  isAvailable!: boolean;

  @Column({ type: 'int', default: 0 })
  stock!: number;

  /**
   * When TRUE (default), orders containing this product require a manual
   * cotización: they start in PENDING_QUOTE and the super admin sets shipping.
   *
   * When FALSE (e.g. water — standardized bulk delivery), the product skips
   * cotización. An order whose items are ALL `requiresQuote = false` is
   * auto-quoted at creation (shipping = $0) and lands directly in QUOTED.
   */
  @Column({ name: 'requires_quote', type: 'boolean', default: true })
  requiresQuote!: boolean;

  @Column({ name: 'image_bytes', type: 'bytea', nullable: true, select: false })
  imageBytes!: Buffer | null;

  @Column({
    name: 'image_content_type',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  imageContentType!: string | null;

  @Column({ name: 'image_updated_at', type: 'timestamptz', nullable: true })
  imageUpdatedAt!: Date | null;

  @Column({
    name: 'promoter_commission_pct',
    type: 'numeric',
    precision: 5,
    scale: 2,
    default: 0,
  })
  promoterCommissionPct!: string;

  @Column({
    name: 'points_pct',
    type: 'numeric',
    precision: 5,
    scale: 2,
    default: 1.0,
  })
  pointsPct!: string;

  @Column({ name: 'category_id', type: 'uuid', nullable: true })
  categoryId!: string | null;

  @ManyToOne(() => Category, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'category_id' })
  category!: Category | null;

  @Column({ name: 'offer_label', type: 'varchar', length: 40, nullable: true })
  offerLabel!: string | null;

  @Column({
    name: 'offer_discount_pct',
    type: 'numeric',
    precision: 5,
    scale: 2,
    nullable: true,
  })
  offerDiscountPct!: string | null;

  @Column({
    name: 'offer_starts_at',
    type: 'timestamp with time zone',
    nullable: true,
  })
  offerStartsAt!: Date | null;

  @Column({
    name: 'offer_ends_at',
    type: 'timestamp with time zone',
    nullable: true,
  })
  offerEndsAt!: Date | null;

  /**
   * Rental pricing fields.
   *
   * `monthlyRentCents` and `lateFeeCents` are only semantically meaningful when
   * `pricingMode === 'rental'`. They MUST be zero (and are ignored) for
   * `pricingMode === 'single_payment'` products.
   *
   * `stripeProductId` and `stripePriceId` are lazy-created by the server when
   * rental mode is first activated with a non-zero `monthlyRentCents`. They are
   * server-managed — client DTOs MUST NOT include them.
   */
  @Column({ name: 'pricing_mode', type: 'varchar', length: 20, default: 'single_payment' })
  pricingMode!: 'single_payment' | 'rental';

  @Column({ name: 'monthly_rent_cents', type: 'integer', default: 0 })
  monthlyRentCents!: number;

  @Column({ name: 'late_fee_cents', type: 'integer', default: 0 })
  lateFeeCents!: number;

  @Column({ name: 'stripe_product_id', type: 'varchar', length: 64, nullable: true })
  stripeProductId!: string | null;

  @Column({ name: 'stripe_price_id', type: 'varchar', length: 64, nullable: true })
  stripePriceId!: string | null;

  /**
   * Bebedero maintenance flags.
   *
   * `requiresMaintenance = true` marks a rentable dispenser (bebedero) that
   * needs periodic (30-day) maintenance. When such a rental is activated, the
   * rental's next_maintenance_at countdown is started.
   *
   * `isMaintenanceService = true` marks THE dedicated "Mantenimiento Bebedero"
   * service product. When an order containing this product is delivered, the
   * customer's active rentals get their maintenance countdown reset.
   *
   * The two flags are independent: a bebedero is `requiresMaintenance`; the
   * service that fulfills it is `isMaintenanceService`.
   */
  @Column({ name: 'requires_maintenance', type: 'boolean', default: false })
  requiresMaintenance!: boolean;

  @Column({ name: 'is_maintenance_service', type: 'boolean', default: false })
  isMaintenanceService!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
