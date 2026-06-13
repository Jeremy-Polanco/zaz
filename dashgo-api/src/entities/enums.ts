export enum UserRole {
  CLIENT = 'client',
  PROMOTER = 'promoter',
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
}
