import { UserRole } from '../entities/enums';

/**
 * El asociado compra "como cualquier cliente" (spec del pool de puntos): un
 * pedido activo a la vez, fiado permitido y los mismos estados cancelables.
 * Cada regla de compra que antes preguntaba `role === CLIENT` pregunta aquí,
 * así un rol nuevo con esa conducta se agrega en un solo lugar.
 */
export function buysAsClient(role: UserRole): boolean {
  return role === UserRole.CLIENT || role === UserRole.ASSOCIATE;
}
