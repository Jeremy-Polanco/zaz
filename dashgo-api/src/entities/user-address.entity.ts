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
   * Número de puerta. Lo ESCRIBE el cliente (o lo completa la geocodificación
   * inversa cuando no lo escribió): hasta ahora se perdía — el snapshot de la
   * orden lo guardaba y la libreta no, así que el segundo pedido a la misma
   * casa llegaba sin número.
   *
   * 40 caracteres y no 10: acá los números de puerta son "1101-A", "24 1/2" y
   * "120-05" (Queens), que parecen errores y no lo son.
   */
  @Column({ name: 'house_number', type: 'varchar', length: 40, nullable: true })
  houseNumber!: string | null;

  /**
   * Ciudad. La DERIVA EL SERVIDOR por geocodificación inversa de la chincheta
   * (ver modules/geocoding). Ya no es una columna decorativa: junto con
   * `state` y `county` decide la jurisdicción fiscal — "New York" es la
   * diferencia entre 8.875% y la tasa de otro condado del estado.
   */
  @Column({ type: 'varchar', length: 120, nullable: true })
  city!: string | null;

  /**
   * Sigla del estado ('NJ', 'NY'). La CLAVE con la que se busca la ley en
   * `tax_jurisdictions`.
   *
   * NUNCA la manda el cliente: sale de la lat/lng por geocodificación inversa.
   * Si el cliente pudiera escribirla, estaría eligiendo cuánto impuesto paga.
   *
   * Nullable porque las direcciones viejas nacen sin esto; el backfill
   * (`src/database/backfill-address-geo.ts`) las completa, y mientras tanto la
   * jurisdicción se deduce del ZIP.
   */
  @Column({ type: 'varchar', length: 2, nullable: true })
  state!: string | null;

  /**
   * Condado tal como lo nombra Nominatim ("Union County", "Bronx County").
   * Es lo que distingue los cinco condados de New York City del resto del
   * estado cuando la ciudad viene con otro nombre.
   */
  @Column({ type: 'varchar', length: 80, nullable: true })
  county!: string | null;

  /**
   * Cuándo el geocoder CONTESTÓ por última vez sobre esta chincheta.
   *
   * No es lo mismo que "tiene estado": Nominatim puede contestar con un punto
   * de Pennsylvania, que no está en el mapa de siglas, y dejar `state` en NULL.
   * Sin este sello el backfill (`state IS NULL`) volvería a pedir esa misma
   * fila en cada vuelta, para siempre, gastando la cuota de 1 request/segundo
   * de la política de uso.
   *
   * La cola del backfill es entonces `state IS NULL AND geocoded_at IS NULL`:
   * lo que nunca se miró. Un fallo del geocoder NO lo sella — esa fila tiene
   * que volver a intentarse.
   */
  @Column({ name: 'geocoded_at', type: 'timestamptz', nullable: true })
  geocodedAt!: Date | null;

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
