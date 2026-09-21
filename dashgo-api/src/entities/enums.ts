export enum UserRole {
  CLIENT = 'client',
  PROMOTER = 'promoter',
  /**
   * Vendedor. Ve y opera SOLO los pedidos y los clientes que tiene asignados
   * (`users.seller_id`). La asignación la hace únicamente el super admin — un
   * vendedor no puede asignarse clientes a sí mismo ni moverlos de cartera.
   */
  SELLER = 'seller',
  SUPER_ADMIN_DELIVERY = 'super_admin_delivery',
}

export enum OrderStatus {
  PENDING_QUOTE = 'pending_quote',
  QUOTED = 'quoted',
  PENDING_VALIDATION = 'pending_validation',
  CONFIRMED_BY_COLMADO = 'confirmed_by_colmado',
  IN_DELIVERY_ROUTE = 'in_delivery_route',
  DELIVERED = 'delivered',
  CANCELLED = 'cancelled',
}

export enum PaymentMethod {
  CASH = 'cash',
  DIGITAL = 'digital',
}

// FIX CRITICAL-N1 — widened lat/lng to `number | null` so the anonymized
// state after account deletion is representable: { text: 'Cuenta eliminada',
// lat: null, lng: null }. Live addresses still use number; only the
// post-deletion scrub overwrites with null.
export interface GeoAddress {
  text: string;
  lat?: number | null;
  lng?: number | null;
  /** Building name/number (e.g. "Edif. 4", "Torre B"). */
  building?: string | null;
  /** House / door number (e.g. "24"). Shown first in the route summary. */
  houseNumber?: string | null;
  /** Apartment, floor or unit inside a building (e.g. "Apto 3B", "Piso 2"). */
  unit?: string | null;
  /** Visible landmark to find the drop-off ("frente al colmado"). */
  reference?: string | null;
  /**
   * Código postal de 5 dígitos. Snapshot: se congela con la orden igual que el
   * resto de la dirección. Opcional y nullable porque las órdenes viejas
   * (JSONB, sin migración) nacieron sin él y siguen siendo válidas.
   */
  postalCode?: string | null;
  /**
   * Ciudad / estado (sigla de 2 letras) / condado del destino, DERIVADOS POR EL
   * SERVIDOR con geocodificación inversa de la lat/lng (ver modules/geocoding).
   *
   * Viajan dentro del snapshot y no se leen de la libreta a propósito: la
   * dirección de un pedido se congela, y el impuesto que se le cobró tiene que
   * poder explicarse años después aunque el cliente haya borrado o editado esa
   * dirección. El ZIP solo no alcanza — decide mal en los bordes de estado.
   *
   * Opcionales: los pedidos viejos (JSONB, sin migración) nacieron sin ellos.
   */
  city?: string | null;
  state?: string | null;
  county?: string | null;
}
