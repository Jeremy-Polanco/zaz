import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../entities';
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

  async getOrigin(): Promise<{ lat: number; lng: number } | null> {
    const superAdmin = await this.users.findOne({
      where: { role: UserRole.SUPER_ADMIN_DELIVERY },
      order: { createdAt: 'ASC' },
    });
    const addr = superAdmin?.addressDefault;
    if (!addr || typeof addr.lat !== 'number' || typeof addr.lng !== 'number') {
      return null;
    }
    return { lat: addr.lat, lng: addr.lng };
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
