import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Product } from './product.entity';

@Entity({ name: 'categories' })
export class Category {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 100, unique: true })
  name!: string;

  @Column({ type: 'varchar', length: 120, unique: true })
  slug!: string;

  @Column({ name: 'icon_emoji', type: 'varchar', length: 8, nullable: true })
  iconEmoji!: string | null;

  @Column({ name: 'display_order', type: 'int', default: 0 })
  displayOrder!: number;

  @Column({ name: 'image_bytes', type: 'bytea', nullable: true, select: false })
  imageBytes!: Buffer | null;

  @Column({ name: 'image_content_type', type: 'varchar', length: 100, nullable: true })
  imageContentType!: string | null;

  @Column({ name: 'image_updated_at', type: 'timestamptz', nullable: true })
  imageUpdatedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @OneToMany(() => Product, (p) => p.category)
  products!: Product[];
}
