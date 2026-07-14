import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * Key/value store for small admin-editable settings (e.g. the birthday push
 * copy). Not for secrets and not for config that belongs in env vars — this
 * is for content an admin edits from the web panel at runtime.
 */
@Entity('app_settings')
export class AppSetting {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  key!: string;

  @Column({ type: 'text' })
  value!: string;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
