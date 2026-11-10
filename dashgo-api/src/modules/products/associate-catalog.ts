import { BadRequestException } from '@nestjs/common';
import { Order, Product } from '../../entities';
import { UserRole } from '../../entities/enums';

/**
 * Solo un producto de pago único "normal" puede tener precio mayorista: las
 * rentas y los productos que el sistema provisiona por suscripción
 * (mantenimiento, bebedero gratis, premium) no se venden a asociados.
 */
export function canCarryAssociatePrice(
  p: Pick<
    Product,
    | 'pricingMode'
    | 'isMaintenanceService'
    | 'isDefaultSubscriberBebedero'
    | 'isPremiumSubscriberProduct'
  >,
): boolean {
  return (
    p.pricingMode === 'single_payment' &&
    !p.isMaintenanceService &&
    !p.isDefaultSubscriberBebedero &&
    !p.isPremiumSubscriberProduct
  );
}

/**
 * Un asociado solo puede comprar productos con precio para asociados. Lanza
 * 400 si el carrito trae alguno sin él (p. ej. un carrito persistido de antes
 * de que el producto se retirara del catálogo mayorista).
 */
export function assertAssociateCart(
  products: Array<Pick<Product, 'associatePriceCents'>>,
): void {
  if (products.some((p) => p.associatePriceCents == null)) {
    throw new BadRequestException({
      code: 'PRODUCT_NOT_AVAILABLE_FOR_ASSOCIATES',
      message: 'Este producto no está disponible para asociados',
    });
  }
}

/**
 * El precio mayorista solo lo ve el super admin. Quita `associatePriceCents`
 * del producto embebido en cada ítem de la(s) orden(es) que se devuelven a
 * cualquier otro rol (cliente, asociado, vendedor, promotor).
 *
 * MUTA en el lugar. Lo que devuelve `OrdersService.findOne/findAll` es, por lo
 * tanto, una forma de RESPUESTA: nunca se debe usar para (re)calcular precios
 * con `isAssociate` (el precio mayorista ya no está en el producto embebido).
 */
export function hideAssociatePrice(
  orders: Order | Order[],
  role: UserRole | null | undefined,
): void {
  if (role === UserRole.SUPER_ADMIN_DELIVERY) return;
  for (const order of Array.isArray(orders) ? orders : [orders]) {
    for (const item of order.items ?? []) {
      if (item.product)
        Reflect.deleteProperty(item.product, 'associatePriceCents');
    }
  }
}
