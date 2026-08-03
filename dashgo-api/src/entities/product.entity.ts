import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Category } from './category.entity';
import type { TaxCategory } from '../common/tax';

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
   * Price (in cents) an ACTIVE SUBSCRIBER pays for this product. NULL means the
   * product has no subscriber price and everyone pays the catalog/offer price.
   *
   * When set, it WINS outright for subscribers: the offer is not evaluated and
   * the two never stack, even when the offer would be cheaper (see
   * `getEffectivePrice`). 0 is a valid value — the product is free for
   * subscribers — so callers must check `!= null`, never truthiness.
   *
   * The catalog endpoint is anonymous, so it only EXPOSES this number as a
   * hook ("Suscriptores: $X"). Whether it is actually charged is decided
   * server-side at order time, where the subscription is verified.
   */
  @Column({ name: 'subscriber_price_cents', type: 'integer', nullable: true })
  subscriberPriceCents!: number | null;

  /**
   * Categoría fiscal del producto. 'standard' (default) paga TAX_RATE;
   * 'exempt' no paga impuesto — el caso que lo motivó es el agua embotellada,
   * exenta en NJ.
   *
   * Varchar y no boolean a propósito: la exención de US es
   * (categoría × jurisdicción), no un switch. Ver `src/common/tax.ts`.
   */
  @Column({
    name: 'tax_category',
    type: 'varchar',
    length: 20,
    default: 'standard',
  })
  taxCategory!: TaxCategory;

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
  @Column({
    name: 'pricing_mode',
    type: 'varchar',
    length: 20,
    default: 'single_payment',
  })
  pricingMode!: 'single_payment' | 'rental';

  @Column({ name: 'monthly_rent_cents', type: 'integer', default: 0 })
  monthlyRentCents!: number;

  @Column({ name: 'late_fee_cents', type: 'integer', default: 0 })
  lateFeeCents!: number;

  /**
   * One-time theft / replacement fee (in cents) charged off-session when a
   * subscriber stops paying and effectively keeps (steals) the rented unit.
   * Snapshotted onto the Rental at order time; charged at most once via
   * RentalsService.chargeTheftFee. Only meaningful for rental products; 0
   * disables the charge.
   */
  @Column({ name: 'theft_fee_cents', type: 'integer', default: 0 })
  theftFeeCents!: number;

  @Column({
    name: 'stripe_product_id',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  stripeProductId!: string | null;

  @Column({
    name: 'stripe_price_id',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  stripePriceId!: string | null;

  /**
   * Bebedero maintenance flags.
   *
   * `requiresMaintenance = true` marks a rentable dispenser (bebedero) that
   * needs periodic (90-day) maintenance. When such a rental is activated, the
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

  /**
   * Marks THE bebedero given for free when a user subscribes. Exactly one
   * product should carry this flag; the subscription-activated listener
   * auto-creates a free order for it. If none is flagged, no auto-bebedero is
   * created (logged). Should only be set on a rental dispenser
   * (pricingMode='rental', requiresMaintenance=true).
   */
  @Column({
    name: 'is_default_subscriber_bebedero',
    type: 'boolean',
    default: false,
  })
  isDefaultSubscriberBebedero!: boolean;

  /** Posición en el catálogo — menor número aparece primero. */
  @Column({ name: 'display_order', type: 'int', default: 0 })
  displayOrder!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
