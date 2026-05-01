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
import type { GeoAddress } from './enums';
import { UserRole } from './enums';
import { Order } from './order.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true, where: '"email" IS NOT NULL' })
  @Column({ type: 'varchar', length: 255, nullable: true })
  email!: string | null;

  @Column({ name: 'full_name', type: 'varchar', length: 255 })
  fullName!: string;

  @Index({ unique: true, where: '"phone" IS NOT NULL' })
  @Column({ type: 'varchar', length: 40, nullable: true })
  phone!: string | null;

  @Column({
    type: 'enum',
    enum: UserRole,
    default: UserRole.CLIENT,
  })
  role!: UserRole;

  @Column({ name: 'address_default', type: 'jsonb', nullable: true })
  addressDefault!: GeoAddress | null;

  @Index({ unique: true, where: '"referral_code" IS NOT NULL' })
  @Column({
    name: 'referral_code',
    type: 'varchar',
    length: 10,
    nullable: true,
  })
  referralCode!: string | null;

  @Column({ name: 'referred_by_id', type: 'uuid', nullable: true })
  referredById!: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'referred_by_id' })
  referredBy!: User | null;

  @Column({ name: 'stripe_customer_id', type: 'varchar', length: 64, nullable: true, unique: true })
  stripeCustomerId!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @OneToMany(() => Order, (order) => order.customer)
  orders?: Order[];
}
