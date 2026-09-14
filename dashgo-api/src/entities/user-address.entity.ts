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
import { DeliveryZone } from './delivery-zone.entity';

// Numeric → number transformer (TypeORM returns numeric() as string by default).
const numericTransformer = {
  to: (value: number | null | undefined): number | null | undefined => value,
  from: (value: string | null): number | null =>
    value === null || value === undefined ? null : parseFloat(value),
};

@Entity('user_addresses')
@Index('idx_user_addresses_user_id', ['userId'])
export class UserAddress {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ type: 'varchar', length: 60 })
  label!: string;

  @Column({ type: 'varchar', length: 255 })
  line1!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  line2!: string | null;

  /** Building / house / unit number — pinpoints the exact drop-off for future trips. */
  @Column({ type: 'varchar', length: 120, nullable: true })
  building!: string | null;

  @Column({ type: 'numeric', precision: 10, scale: 7, transformer: numericTransformer })
  lat!: number;

  @Column({ type: 'numeric', precision: 10, scale: 7, transformer: numericTransformer })
  lng!: number;

  @Column({ type: 'text', nullable: true })
  instructions!: string | null;

  /**
   * Código postal que ESCRIBE el cliente en el formulario de la dirección
   * (pedido del dueño: "en la dirección también quiere ver el zip code, y que
   * el usuario lo ingrese"). No sale de geocodificación inversa: el cliente
   * sabe su ZIP y escribirlo cuesta menos que adivinarlo desde la lat/lng.
   * Validado como 5 dígitos en el DTO; se guarda como texto porque Elizabeth NJ
   * es 072xx y como número el cero de adelante se pierde.
   *
   * Hasta ahora la dirección era texto libre + lat/lng: no había forma de
   * responder "¿cuántos clientes tengo en el Bronx?" porque el dato no existía
   * como dato.
   *
   * Nullable porque las direcciones viejas nacen sin esto y NO se backfillean:
   * se completan cuando el cliente edita la dirección. La chincheta del admin y
   * las versiones viejas de la app también pueden guardar sin ZIP.
   */
  @Column({ name: 'postal_code', type: 'varchar', length: 12, nullable: true })
  postalCode!: string | null;

  /**
   * Ciudad. Todavía no se pide ni se deriva en ningún lado — la columna existe
   * desde la migración de zonas y queda en null hasta que haya un pedido
   * concreto que la use.
   */
  @Column({ type: 'varchar', length: 120, nullable: true })
  city!: string | null;

  /**
   * Zona resuelta a partir del `postalCode`. Se guarda RESUELTA y no se calcula
   * al vuelo en cada consulta: agrupar clientes por zona es una pantalla de
   * admin que pagina, y recalcular prefijos por fila la haría inútil.
   *
   * ON DELETE SET NULL: borrar una zona no puede borrar la dirección del
   * cliente.
   */
  @Column({ name: 'zone_id', type: 'uuid', nullable: true })
  zoneId!: string | null;

  @ManyToOne(() => DeliveryZone, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'zone_id' })
  zone!: DeliveryZone | null;

  @Column({ name: 'is_default', type: 'boolean', default: false })
  isDefault!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
