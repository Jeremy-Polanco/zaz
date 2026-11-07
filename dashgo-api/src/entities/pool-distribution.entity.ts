import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * El reparto de un trimestre. UNIQUE en `quarter`: es la traba que impide
 * repartir dos veces el mismo pool aunque el cron corra en dos instancias.
 */
@Entity({ name: 'pool_distributions' })
export class PoolDistribution {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 7, unique: true })
  quarter!: string;

  @Column({ name: 'total_cents', type: 'int' })
  totalCents!: number;

  @Column({ name: 'associate_count', type: 'int' })
  associateCount!: number;

  @Column({ name: 'share_cents', type: 'int' })
  shareCents!: number;

  /** Lo que sobra de dividir en partes iguales; pasa al trimestre siguiente. */
  @Column({ name: 'remainder_cents', type: 'int' })
  remainderCents!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
