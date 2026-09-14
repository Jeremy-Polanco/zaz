import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Zona de reparto — la unidad con la que el negocio piensa su mapa: "el Bronx",
 * "Brooklyn", "Elizabeth". Resuelve DOS pedidos con un solo concepto:
 *
 *   1. Agrupar los clientes por área (hasta ahora imposible: la dirección
 *      guardaba texto libre + lat/lng, sin ciudad ni código postal).
 *   2. Cobrarle un recargo por distancia al cliente lejano.
 *
 * Por qué prefijos de ZIP y no polígonos en un mapa: los boroughs de NYC son
 * exactamente ZIP (Bronx 104xx, Brooklyn 112xx, Manhattan 100xx-102xx) y
 * Elizabeth NJ es 072xx. Un polígono es una semana de trabajo para llegar a la
 * misma respuesta, y el ZIP se lo puede editar el admin sin dibujar nada.
 *
 * NO tiene agenda de días. El día de entrega se asigna POR ORDEN
 * (`orders.scheduled_delivery_date`) — decisión del dueño: "a la orden él se lo
 * pone". Una agenda semanal por zona sería una promesa que el reparto real no
 * puede sostener.
 */
@Entity('delivery_zones')
export class DeliveryZone {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Nombre que ve el admin: "Bronx", "Elizabeth NJ". */
  @Column({ type: 'varchar', length: 80 })
  name!: string;

  /**
   * Prefijos de código postal que caen en esta zona ("104", "112", "07201").
   * Prefijo y no ZIP completo para no tener que cargar cientos de códigos a
   * mano. La resolución elige el prefijo MÁS LARGO que matchea, así una zona
   * fina ("07201" = Elizabeth centro) le gana a una gruesa ("072" = todo NJ
   * norte) sin necesidad de prioridades explícitas.
   */
  @Column({
    name: 'zip_prefixes',
    type: 'varchar',
    array: true,
    default: () => "'{}'",
  })
  zipPrefixes!: string[];

  /**
   * Recargo por distancia en centavos. El DEFAULT de la zona — el admin lo
   * puede pisar orden por orden ("un pago ajustado", palabras del dueño).
   * 0 = zona cercana, no se cobra nada extra.
   */
  @Column({ name: 'surcharge_cents', type: 'integer', default: 0 })
  surchargeCents!: number;

  /**
   * Zona apagada: deja de aplicar recargo y de clasificar direcciones nuevas,
   * pero NO se borra — las órdenes viejas que la referencian tienen que seguir
   * explicando por qué se les cobró lo que se les cobró.
   */
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
