import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { taxRateTransformer } from './delivery-zone.entity';

/** Las jurisdicciones que hoy sabemos cobrar. Ampliarlo es agregar una fila. */
export type TaxJurisdictionCode = 'NJ' | 'NYC';

/**
 * La LEY, como fila.
 *
 * Hasta acá la tasa vivía en la zona de reparto, y la zona es un concepto de
 * LOGÍSTICA: la dibuja el dueño con prefijos de ZIP para agrupar el reparto y
 * cobrar distancia. Que el impuesto colgara de ahí significaba que renombrar,
 * partir o apagar una zona podía cambiarle la tasa a un cliente sin que nadie
 * lo decidiera — y el impuesto no lo decide el reparto, lo decide el estado.
 *
 * Acá hay UNA fila por jurisdicción fiscal, con la cita legal al lado
 * (`source`): cuando dentro de dos años alguien pregunte por qué a Elizabeth se
 * le cobró 6.625%, la respuesta está en la base y no en un commit.
 *
 * `delivery_zones.tax_rate` sigue existiendo, pero ahora es un OVERRIDE
 * opcional (NULL = "usá la ley"), para el caso raro de una zona con un régimen
 * especial cargado a mano.
 */
@Entity('tax_jurisdictions')
@Unique('UQ_tax_jurisdictions_code', ['code'])
export class TaxJurisdiction {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /**
   * Clave estable con la que resuelve el código y con la que se congela la
   * jurisdicción en la orden ('NJ', 'NYC'). NO es el nombre: el nombre es
   * texto para humanos y se puede editar.
   */
  @Column({ type: 'varchar', length: 16 })
  code!: string;

  @Column({ type: 'varchar', length: 80 })
  name!: string;

  /**
   * Tasa como fracción (0.06625 = 6.625%). Mismo transformer que la zona:
   * Postgres devuelve `numeric` como string y esto se multiplica por centavos.
   */
  @Column({
    name: 'tax_rate',
    type: 'numeric',
    precision: 6,
    scale: 5,
    transformer: taxRateTransformer,
  })
  taxRate!: number;

  /**
   * De dónde sale el número: la norma y la fecha en que se verificó. Es la
   * diferencia entre "cobramos 8.875%" y "cobramos 8.875% porque 4% NYS +
   * 4.5% NYC + 0.375% MCTD, verificado el 2026-09-21".
   */
  @Column({ type: 'text', nullable: true })
  source!: string | null;

  /**
   * Apagada = deja de cobrarse (se cae al fallback histórico), pero la fila NO
   * se borra: las órdenes viejas guardan su `tax_jurisdiction` y tienen que
   * poder seguir explicándose.
   */
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
