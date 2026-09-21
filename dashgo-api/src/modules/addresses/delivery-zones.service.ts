import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DeliveryZone } from '../../entities/delivery-zone.entity';
import { TAX_RATE } from '../../common/tax';
import { resolveZoneId, type ZoneForResolution } from './resolve-zone';

/**
 * De dónde sale la tasa: el ZIP, y sólo como respaldo la zona guardada.
 *
 * El código postal es el DATO PRIMARIO: es lo que el cliente (o el admin al
 * pinchar el mapa) escribió, y es lo único que viaja dentro del snapshot JSONB
 * de una orden. `user_addresses.zone_id` es un CACHE — se resolvió el día que
 * se guardó la dirección y nadie lo refresca cuando el admin le cambia los
 * prefijos a una zona. Preguntar primero por el cache haría que la libreta
 * contestara una cosa y la orden otra sobre la misma dirección.
 *
 * El cache sigue sirviendo cuando no hay ZIP (dirección vieja) o cuando el ZIP
 * no cae en ningún prefijo: ahí es el único dato que queda.
 */
export interface TaxRateQuery {
  zoneId?: string | null;
  postalCode?: string | null;
}

export interface ResolvedTaxRate {
  /** Zona que fijó la tasa; `null` = ninguna, se cobró el fallback. */
  zoneId: string | null;
  taxRate: number;
}

/** Lo que la resolución necesita de una zona: su id y su tasa. */
type ZoneWithRate = ZoneForResolution & { taxRate: number };

const FALLBACK: ResolvedTaxRate = { zoneId: null, taxRate: TAX_RATE };

/**
 * Una tasa sólo se usa si es un número sano. Un `numeric` corrupto, un NULL que
 * se coló o un valor fuera de rango caen en la constante histórica y NO en 0:
 * cobrar de más se devuelve, cobrar de menos se paga de la caja propia.
 *
 * Un 0 explícito SÍ se respeta — una zona configurada en 0% es un dato, no un
 * faltante (el CHECK de la migración ya acota el rango a [0, 1)).
 */
function sanitizeRate(rate: number | null | undefined): number {
  const value = typeof rate === 'number' ? rate : parseFloat(String(rate ?? ''));
  if (!Number.isFinite(value) || value < 0 || value >= 1) return TAX_RATE;
  return value;
}

/**
 * Resolución pura: prefijo de ZIP, si no la zona cacheada, si no el fallback.
 * UN solo orden para todo el sistema — la libreta, la orden al crearse, la
 * cotización y la chincheta del admin tienen que contestar lo mismo sobre la
 * misma dirección. Pura para poder resolver un lote entero con una sola
 * lectura de la tabla.
 */
function resolveFromZones(
  query: TaxRateQuery,
  zones: ZoneWithRate[],
): ResolvedTaxRate {
  const matchedId = resolveZoneId(query.postalCode ?? null, zones);
  if (matchedId) {
    const matched = zones.find((z) => z.id === matchedId);
    if (matched) {
      return { zoneId: matched.id, taxRate: sanitizeRate(matched.taxRate) };
    }
  }

  // Sin ZIP (o con un ZIP que no cae en ningún prefijo) queda el cache de la
  // libreta. La lista viene filtrada por `is_active`: buscar el id acá ya
  // contesta "existe Y está encendida" sin una segunda consulta, y una zona
  // apagada simplemente no aparece.
  if (query.zoneId) {
    const byId = zones.find((z) => z.id === query.zoneId);
    if (byId) return { zoneId: byId.id, taxRate: sanitizeRate(byId.taxRate) };
  }

  return { ...FALLBACK };
}

/**
 * La ÚNICA puerta para preguntar "¿qué impuesto le corresponde a esta
 * dirección?". La usan las órdenes (al crearse), el intent de Stripe (para que
 * el monto que cobra coincida con la orden que se crea después) y la libreta de
 * direcciones (para poder mostrarle al cliente qué tasa le toca).
 *
 * Tenerla una sola vez no es prolijidad: si el intent cobra 8.887% y la orden
 * cotiza 6.625%, el cliente ve un precio y paga otro.
 */
@Injectable()
export class DeliveryZonesService {
  constructor(
    @InjectRepository(DeliveryZone)
    private readonly zones: Repository<DeliveryZone>,
  ) {}

  async resolveTaxRate(query: TaxRateQuery): Promise<ResolvedTaxRate> {
    // Sin zona y sin ZIP no hay nada que resolver: no se le pega a la tabla.
    if (!query.zoneId && !query.postalCode) return { ...FALLBACK };
    return resolveFromZones(query, await this.activeZones());
  }

  /**
   * Versión en lote — una sola lectura de zonas para toda una lista. La usa el
   * listado de direcciones: diez direcciones no pueden ser diez consultas.
   */
  async resolveTaxRates(queries: TaxRateQuery[]): Promise<ResolvedTaxRate[]> {
    if (!queries.length) return [];
    if (queries.every((q) => !q.zoneId && !q.postalCode)) {
      return queries.map(() => ({ ...FALLBACK }));
    }
    const zones = await this.activeZones();
    return queries.map((query) => resolveFromZones(query, zones));
  }

  /**
   * Todas las zonas encendidas, resueltas en memoria: son un puñado de filas y
   * el "prefijo más largo que matchea" no se puede pedir en SQL sin un LIKE por
   * fila. Misma lectura que hace AddressesService al guardar una dirección.
   */
  private async activeZones(): Promise<ZoneWithRate[]> {
    return this.zones.find({ where: { isActive: true } });
  }
}
