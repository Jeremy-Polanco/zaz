import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'counters' })
export class Counter {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  key!: string;

  @Column({ type: 'int', default: 0 })
  value!: number;
}
