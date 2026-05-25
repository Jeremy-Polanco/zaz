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

export interface GeoAddress {
  text: string;
  lat?: number;
  lng?: number;
}
