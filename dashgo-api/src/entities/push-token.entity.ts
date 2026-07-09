import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from './user.entity';

/**
 * Expo push token for one device of one user. A user can hold several rows
 * (phone + tablet, reinstalls); a token is globally unique — re-registering an
 * existing token for a different user (device changed hands / re-login) moves
 * the row via upsert. Dead tokens (Expo `DeviceNotRegistered`) are deleted by
 * PushService on send.
 */
@Entity('push_tokens')
export class PushToken {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  /** Expo push token, e.g. ExponentPushToken[xxxxxxxx]. */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 128 })
  token!: string;

  @Column({ type: 'varchar', length: 16 })
  platform!: 'ios' | 'android';

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  /** Bumped on every re-registration — stale rows can be pruned by age. */
  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
