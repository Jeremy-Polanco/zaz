export interface CommissionableLine {
  productId: string;
  /** Precio unitario cobrado, en cents (lo que quedó en `priceAtOrder`). */
  priceCents: number;
  quantity: number;
}

/**
 * Comisión que gana un vendedor por una orden, en cents.
 *
 * Se calcula sobre lo REALMENTE cobrado (`priceAtOrder`), no sobre el precio de
 * catálogo: si el cliente pagó con oferta o con precio de suscriptor, la
 * comisión sale de ese número. Cobrar comisión sobre un precio que nadie pagó
 * es cómo se termina pagando más comisión que margen.
 *
 * Un producto fuera del catálogo del vendedor no paga comisión (pct 0), igual
 * que uno cargado con 0%.
 */
export function computeSellerCommissionCents(
  lines: CommissionableLine[],
  commissionPctByProductId: Map<string, number>,
): number {
  let total = 0;
  for (const line of lines) {
    const pct = commissionPctByProductId.get(line.productId);
    if (pct === undefined || pct <= 0) continue;
    const lineCents = line.priceCents * line.quantity;
    const commission = Math.round((lineCents * pct) / 100);
    if (commission <= 0) continue;
    total += commission;
  }
  return total;
}
