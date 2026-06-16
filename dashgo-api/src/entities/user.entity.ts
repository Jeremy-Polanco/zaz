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
import { UserAddress } from './user-address.entity';

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

  /**
   * @deprecated Use `UserAddress` entity / `GET /me/addresses`.
   * Retained for `ShippingService.warehouseOrigin` and `useBootstrapLocation` read-throughs (dashgo-web).
   */
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

  /**
   * The `UserAddress` this user is currently operating from. Meaningful for
   * `SUPER_ADMIN_DELIVERY` (repartidor): when a driver works out of multiple
   * locations they pick the active one, which becomes the shipping origin
   * (see `ShippingService.getOrigin`). NULL falls back to the default address.
   * FK is `ON DELETE SET NULL` — deleting the active address clears the pointer.
   */
  @Column({ name: 'active_location_id', type: 'uuid', nullable: true })
  activeLocationId!: string | null;

  @ManyToOne(() => UserAddress, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'active_location_id' })
  activeLocation!: UserAddress | null;

  /**
   * Admin switch to suppress this user's bebedero maintenance timer. When true,
   * rental activation and maintenance resets do NOT set `next_maintenance_at`,
   * so the user never appears as "maintenance due". Used for subscribers who do
   * not actually hold a physical bebedero. Default false (timer active).
   */
  @Column({ name: 'maintenance_timer_disabled', type: 'boolean', default: false })
  maintenanceTimerDisabled!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @OneToMany(() => Order, (order) => order.customer)
  orders?: Order[];

  @OneToMany(() => UserAddress, (a) => a.user)
  addresses?: UserAddress[];
}
