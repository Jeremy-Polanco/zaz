import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../entities';
import { UserAddress } from '../../entities/user-address.entity';
import { UserRole } from '../../entities/enums';

export interface ShippingQuote {
  shippingCents: number;
  miles: number | null;
}

const EARTH_RADIUS_MILES = 3958.8;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function haversineMiles(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_MILES * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

@Injectable()
export class ShippingService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(UserAddress)
    private readonly addresses: Repository<UserAddress>,
    private readonly config: ConfigService,
  ) {}

  private baseCents(): number {
    return parseInt(this.config.get<string>('SHIPPING_BASE_CENTS', '300'), 10);
  }

  private perMileCents(): number {
    return parseInt(
      this.config.get<string>('SHIPPING_PER_MILE_CENTS', '50'),
      10,
    );
  }

  /**
   * Shipping origin = the primary repartidor's currently-active location.
   *
   * Resolution order, most-specific first:
   *   1) The repartidor's explicitly selected location (`active_location_id`).
   *   2) Their default saved address (`UserAddress.isDefault`).
   *   3) Legacy `addressDefault` JSONB (deprecated, pre-multi-location data).
   *   4) null → caller falls back to the flat base shipping rate.
   *
   * "Primary" repartidor = the first SUPER_ADMIN_DELIVERY by createdAt; the
   * delivery operation has a single dispatch origin at any given time, and the
   * driver switches it by selecting a different active location.
   */
  async getOrigin(): Promise<{ lat: number; lng: number } | null> {
    const superAdmin = await this.users.findOne({
      where: { role: UserRole.SUPER_ADMIN_DELIVERY },
      order: { createdAt: 'ASC' },
    });
    if (!superAdmin) return null;

    // 1) Explicitly selected active location.
    if (superAdmin.activeLocationId) {
      const active = await this.addresses.findOne({
        where: { id: superAdmin.activeLocationId, userId: superAdmin.id },
      });
      if (active && typeof active.lat === 'number' && typeof active.lng === 'number') {
        return { lat: active.lat, lng: active.lng };
      }
    }

    // 2) Default saved address.
    const fallback = await this.addresses.findOne({
      where: { userId: superAdmin.id, isDefault: true },
    });
    if (fallback && typeof fallback.lat === 'number' && typeof fallback.lng === 'number') {
      return { lat: fallback.lat, lng: fallback.lng };
    }

    // 3) Legacy single-address JSONB.
    const addr = superAdmin.addressDefault;
    if (addr && typeof addr.lat === 'number' && typeof addr.lng === 'number') {
      return { lat: addr.lat, lng: addr.lng };
    }

    return null;
  }

  async computeQuote(dest: {
    lat?: number | null;
    lng?: number | null;
  }): Promise<ShippingQuote> {
    const base = this.baseCents();
    const perMile = this.perMileCents();

    if (typeof dest.lat !== 'number' || typeof dest.lng !== 'number') {
      return { shippingCents: base, miles: null };
    }

    const origin = await this.getOrigin();
    if (!origin) {
      return { shippingCents: base, miles: null };
    }

    const miles = haversineMiles(origin, { lat: dest.lat, lng: dest.lng });
    const shippingCents = base + Math.ceil(miles) * perMile;
    return { shippingCents, miles };
  }
}
