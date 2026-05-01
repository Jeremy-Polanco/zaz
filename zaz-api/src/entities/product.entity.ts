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

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
