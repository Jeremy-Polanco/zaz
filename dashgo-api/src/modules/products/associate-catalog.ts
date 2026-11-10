import { BadRequestException } from '@nestjs/common';
import { Product } from '../../entities';

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
