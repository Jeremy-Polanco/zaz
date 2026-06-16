import { UserRole } from '../../entities/enums';

export interface GeoAddress {
  text: string;
  lat?: number;
  lng?: number;
}

export interface AuthenticatedUser {
  id: string;
  email: string | null;
  role: UserRole;
  // Populated by JwtStrategy.validate() — kept optional for test fixtures that
  // only need {id, email, role} for permission checks.
  fullName?: string;
  phone?: string | null;
  addressDefault?: GeoAddress | null;
  /** Active operating location (UserAddress id) — drives the repartidor's shipping origin. */
  activeLocationId?: string | null;
  referralCode?: string | null;
  referredById?: string | null;
  stripeCustomerId?: string | null;
  createdAt?: string;
}
