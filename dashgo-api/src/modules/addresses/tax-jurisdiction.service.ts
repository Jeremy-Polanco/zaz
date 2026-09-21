import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DeliveryZone } from '../../entities/delivery-zone.entity';
import {
  TaxJurisdiction,
  TaxJurisdictionCode,
} from '../../entities/tax-jurisdiction.entity';
import { TAX_RATE } from '../../common/tax';
import { resolveZoneId, type ZoneForResolution } from './resolve-zone';

/**
 * Todo lo que se puede saber del destino a la hora de preguntar "¿qué impuesto
 * le corresponde?". Ninguno es obligatorio: las direcciones viejas no tienen
 * estado, los pedidos viejos sólo tienen el ZIP del snapshot.
 */
export interface TaxRateQuery {
  /** Zona de reparto ya resuelta (cache de la libreta). */
  zoneId?: string | null;
  /** ZIP de 5 dígitos: el dato que más viaja (vive dentro del JSONB del pedido). */
  postalCode?: string | null;
  /** Sigla de dos letras, derivada por el servidor vía geocodificación. */
  state?: string | null;
  city?: string | null;
  county?: string | null;
  /**
   * La chincheta. Se aceptan para que quien llama pueda pasar la dirección
   * entera sin recortarla, pero la resolución NO geocodifica acá: la
   * geocodificación es una llamada de red y esto corre adentro de la
   * transacción que crea el pedido. Quien tenga sólo lat/lng llama primero a
   * `GeocodingService.reverse` y pasa el `state`/`city`/`county` que salga.
   */
  lat?: number | null;
  lng?: number | null;
}

export interface ResolvedTaxRate {
  /**
   * Zona de reparto a la que cae la dirección; `null` si ninguna. Que haya zona
   * NO significa que la zona haya fijado la tasa — sólo la fija si tiene un
   * override cargado (ver `jurisdiction`).
   */
  zoneId: string | null;
  /** Ley que fijó la tasa; `null` = ninguna, se cobró el fallback histórico. */
  jurisdiction: TaxJurisdictionCode | null;
  taxRate: number;
}

/**
 * Los cinco condados de New York City. Fuera de ellos el estado de New York
 * cobra otra cosa (cada condado tiene su tasa local), y como todavía no
 * repartimos ahí preferimos no inventar un número: sin jurisdicción se cae al
 * fallback histórico.
 */
const NYC_COUNTIES = new Set([
  'new york county',
  'kings county',
  'queens county',
  'bronx county',
  'richmond county',
]);

/**
 * Prefijos de ZIP de los cinco condados. Sirven para dos cosas: confirmar NYC
 * cuando Nominatim devuelve un condado con otro nombre, y resolver la
 * jurisdicción de una fila VIEJA que todavía no tiene estado (el backfill
 * tarda; mientras tanto el impuesto tiene que salir bien igual).
 *   Manhattan 100-102, Roosevelt Island/varios 103, Bronx 104,
 *   Staten Island 103, Queens 110/111/113/114/116, Brooklyn 112.
 */
const NYC_ZIP3 = new Set([
  '100', '101', '102', '103', '104',
  '110', '111', '112', '113', '114', '116',
]);

/** New Jersey ocupa los prefijos 070 a 089 completos. */
const NJ_ZIP3_MIN = 70;
const NJ_ZIP3_MAX = 89;

type ZoneWithRate = ZoneForResolution & { taxRate: number | null };

function norm(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

/**
 * Una tasa sólo se usa si es un número sano. Un `numeric` corrupto, un NULL que
 * se coló o un valor fuera de rango caen en la constante histórica y NO en 0:
 * cobrar de más se devuelve, cobrar de menos se paga de la caja propia.
 *
 * Un 0 explícito SÍ se respeta — una jurisdicción sin impuesto es un dato.
 */
function sanitizeRate(rate: number | null | undefined): number {
  const value = typeof rate === 'number' ? rate : parseFloat(String(rate ?? ''));
  if (!Number.isFinite(value) || value < 0 || value >= 1) return TAX_RATE;
  return value;
}

/** ¿El destino cae dentro de los cinco condados de New York City? */
export function isNyc(query: TaxRateQuery): boolean {
  if (norm(query.state) !== 'ny') return false;
  if (norm(query.city) === 'new york') return true;
  if (NYC_COUNTIES.has(norm(query.county))) return true;
  const zip3 = (query.postalCode ?? '').trim().slice(0, 3);
  return NYC_ZIP3.has(zip3);
}

/**
 * Qué ley le toca a este destino.
 *
 * El ESTADO manda cuando está: es un hecho del servidor (sale de la
 * geocodificación inversa), mientras que el ZIP lo escribe el cliente. Sin
 * estado se cae al ZIP, porque media libreta todavía no está backfilleada y
 * esas direcciones tienen que seguir pagando bien.
 *
 * New York fuera de la ciudad devuelve `null` a propósito: no sabemos la tasa
 * de Albany y no la vamos a inventar.
 */
export function resolveJurisdictionCode(
  query: TaxRateQuery,
): TaxJurisdictionCode | null {
  const state = norm(query.state);
  if (state === 'ny') return isNyc(query) ? 'NYC' : null;
  if (state === 'nj') return 'NJ';
  if (state) return null;

  const zip3 = (query.postalCode ?? '').trim().slice(0, 3);
  if (!/^\d{3}$/.test(zip3)) return null;
  if (NYC_ZIP3.has(zip3)) return 'NYC';
  const n = parseInt(zip3, 10);
  if (n >= NJ_ZIP3_MIN && n <= NJ_ZIP3_MAX) return 'NJ';
  return null;
}

/**
 * Resolución pura — ver el orden en el JSDoc del servicio. Pura para poder
 * resolver un lote entero con una sola lectura de cada tabla.
 */
function resolve(
  query: TaxRateQuery,
  zones: ZoneWithRate[],
  jurisdictions: TaxJurisdiction[],
): ResolvedTaxRate {
  // Zona: primero por ZIP (el dato primario), después por el id cacheado en la
  // libreta. La lista viene filtrada por `is_active`, así que encontrar el id
  // acá ya contesta "existe Y está encendida".
  const matchedId =
    resolveZoneId(query.postalCode ?? null, zones) ??
    (query.zoneId && zones.some((z) => z.id === query.zoneId)
      ? query.zoneId
      : null);
  const zone = matchedId ? zones.find((z) => z.id === matchedId) : undefined;

  const code = resolveJurisdictionCode(query);

  // (1) Override de zona: sólo cuando alguien lo cargó DELIBERADAMENTE.
  if (zone && zone.taxRate !== null && zone.taxRate !== undefined) {
    return {
      zoneId: zone.id,
      jurisdiction: code,
      taxRate: sanitizeRate(zone.taxRate),
    };
  }

  // (2) La ley.
  if (code) {
    const row = jurisdictions.find((j) => j.code === code);
    if (row) {
      return {
        zoneId: zone?.id ?? null,
        jurisdiction: code,
        taxRate: sanitizeRate(row.taxRate),
      };
    }
  }

  // (3) Fallback histórico. Se devuelve el `code` igual (si se dedujo) para
  // que la orden congele QUÉ ley creímos que era aunque no hubiera fila.
  return { zoneId: zone?.id ?? null, jurisdiction: code, taxRate: TAX_RATE };
}

/**
 * La ÚNICA puerta para preguntar "¿qué impuesto le corresponde a este
 * destino?". La usan la libreta de direcciones, la orden (al crearse, al
 * fijarle la dirección y al cotizarla) y el intent de Stripe.
 *
 * Tenerla una sola vez no es prolijidad: si el intent cobra 8.887% y la orden
 * cotiza 6.625%, el cliente ve un precio y paga otro.
 *
 * Orden de resolución, de más específico a más general:
 *   1. OVERRIDE de zona — una `delivery_zones.tax_rate` NO NULA. Es la salida
 *      de emergencia: alguien decidió a mano que esa zona cobra otra cosa.
 *   2. JURISDICCIÓN — la ley, buscada por estado/ciudad/condado (y por ZIP
 *      cuando la fila todavía no tiene estado).
 *   3. FALLBACK — la constante histórica (8.887%). Nunca 0.
 */
@Injectable()
export class TaxJurisdictionService {
  constructor(
    @InjectRepository(DeliveryZone)
    private readonly zones: Repository<DeliveryZone>,
    @InjectRepository(TaxJurisdiction)
    private readonly jurisdictions: Repository<TaxJurisdiction>,
  ) {}

  async resolveTaxRate(query: TaxRateQuery): Promise<ResolvedTaxRate> {
    const [resolved] = await this.resolveTaxRates([query]);
    return resolved;
  }

  /**
   * Versión en lote — una sola lectura de cada tabla para toda una lista. La
   * usa el listado de direcciones: diez direcciones no pueden ser veinte
   * consultas.
   */
  async resolveTaxRates(queries: TaxRateQuery[]): Promise<ResolvedTaxRate[]> {
    if (!queries.length) return [];
    // Sin un solo dato utilizable no se le pega a ninguna tabla.
    if (queries.every((q) => !hasSignal(q))) {
      return queries.map(() => ({
        zoneId: null,
        jurisdiction: null,
        taxRate: TAX_RATE,
      }));
    }
    const [zones, jurisdictions] = await Promise.all([
      this.zones.find({ where: { isActive: true } }) as Promise<ZoneWithRate[]>,
      this.jurisdictions.find({ where: { isActive: true } }),
    ]);
    return queries.map((query) => resolve(query, zones, jurisdictions));
  }
}

/** ¿Hay algo con lo que resolver? Sin esto, la respuesta es el fallback. */
function hasSignal(q: TaxRateQuery): boolean {
  return Boolean(q.zoneId || q.postalCode || q.state || q.city || q.county);
}
