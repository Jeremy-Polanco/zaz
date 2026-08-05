import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { User } from './user.entity';
import { Product } from './product.entity';

/**
 * Catálogo de un vendedor: qué productos lleva y cuánto gana por cada uno.
 *
 * Hace DOS cosas a la vez, y conviene tenerlas separadas en la cabeza:
 *
 *  1. **Acota el catálogo** de los clientes de ese vendedor. Un cliente con
 *     vendedor asignado solo ve estos productos. Con una salvaguarda: si el
 *     vendedor no cargó NINGÚN producto, no se le tapa nada a su cartera — un
 *     vendedor nuevo no puede dejar a sus clientes sin poder comprar.
 *  2. **Define la comisión** por línea. `commissionPct` es lo que GANA el
 *     vendedor (igual que `products.promoter_commission_pct`, no invertido).
 *
 * Solo el super admin escribe esta tabla.
 */
@Entity('seller_products')
@Unique('UQ_seller_products_seller_product', ['sellerId', 'productId'])
@Index('idx_seller_products_seller_id', ['sellerId'])
export class SellerProduct {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'seller_id', type: 'uuid' })
  sellerId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'seller_id' })
  seller!: User;

  @Column({ name: 'product_id', type: 'uuid' })
  productId!: string;

  @ManyToOne(() => Product, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'product_id' })
  product!: Product;

  /**
   * Porcentaje que gana el vendedor sobre esa línea. 0 es válido: el producto
   * está en su catálogo (sus clientes lo ven) pero no paga comisión.
   */
  @Column({
    name: 'commission_pct',
    type: 'numeric',
    precision: 5,
    scale: 2,
    default: 0,
  })
  commissionPct!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
