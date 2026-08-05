/**
 * Regla de visibilidad del catálogo para un comprador.
 *
 * Un cliente con vendedor asignado ve SOLO el catálogo de su vendedor. Pero hay
 * dos salidas de emergencia deliberadas, y las dos fallan hacia "puede
 * comprar":
 *
 *  - Sin vendedor asignado (o invitado) → catálogo completo. Es el
 *    comportamiento de siempre, intacto.
 *  - Vendedor sin NINGÚN producto cargado → catálogo completo. Un vendedor
 *    recién creado no puede dejar a su cartera sin poder comprar nada; eso
 *    sería pérdida de venta silenciosa. Se nota en que sus comisiones dan cero,
 *    que es un problema visible y barato.
 *
 * Devuelve `null` cuando NO hay que filtrar (ver todo), o el set de ids
 * visibles cuando sí.
 */
export function resolveVisibleProductIds(
  sellerCatalogProductIds: string[] | null | undefined,
): Set<string> | null {
  if (!sellerCatalogProductIds || sellerCatalogProductIds.length === 0) {
    return null;
  }
  return new Set(sellerCatalogProductIds);
}

/** Aplica la regla a una lista de productos. */
export function applyCatalogScope<T extends { id: string }>(
  products: T[],
  sellerCatalogProductIds: string[] | null | undefined,
): T[] {
  const visible = resolveVisibleProductIds(sellerCatalogProductIds);
  if (visible === null) return products;
  return products.filter((p) => visible.has(p.id));
}
