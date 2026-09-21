import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GeocodedPlace, parseNominatimPlace } from './nominatim';

/** Instancia pública de Nominatim. Se puede apuntar a una propia por env. */
const DEFAULT_BASE_URL = 'https://nominatim.openstreetmap.org';

/**
 * 2.5 s. La geocodificación es un ADORNO de un camino que mueve plata (guardar
 * una dirección, crear un pedido): si Nominatim tarda, se sigue sin él. Esperar
 * más sería hacerle pagar al cliente la lentitud de un tercero.
 */
const TIMEOUT_MS = 2500;

/**
 * La política de uso de Nominatim EXIGE un User-Agent que identifique a la
 * aplicación. Sin esto la instancia pública bloquea por IP — y el bloqueo se
 * vería acá como "todas las direcciones quedan sin estado".
 */
const USER_AGENT = 'Udash/1.0 (+https://www.dashgo.dev)';

/**
 * Tope del caché. La misma política pide cachear los resultados. 500 entradas
 * son unos pocos cientos de KB y cubren de sobra la libreta entera; el tope
 * existe para que el backfill (miles de filas en un solo proceso) no se coma la
 * memoria del contenedor.
 */
const CACHE_MAX = 500;

/**
 * Geocodificación inversa: de una chincheta en el mapa a "quién cobra impuesto
 * acá".
 *
 * Por qué en el SERVIDOR y no en la app: el estado y el condado deciden la tasa
 * (NJ 6.625%, NYC 8.875%). Si los mandara el cliente, el cliente elegiría
 * cuánto impuesto paga. La lat/lng sí llega del cliente, pero convertirla en
 * jurisdicción es una cuenta nuestra.
 *
 * NUNCA lanza. Cualquier error, timeout o respuesta rara devuelve `null` y deja
 * un warn: la dirección se guarda igual y el pedido se crea igual, sólo que sin
 * los campos derivados (la tasa cae en el fallback histórico, ver common/tax.ts).
 */
@Injectable()
export class GeocodingService {
  private readonly logger = new Logger(GeocodingService.name);
  private readonly baseUrl: string;
  private readonly enabled: boolean;
  /**
   * Clave = lat/lng redondeadas a 5 decimales (~1 m): dos chinchetas del mismo
   * portal son la misma consulta. Map y no un objeto porque el orden de
   * inserción es lo que permite desalojar la entrada más vieja.
   */
  private readonly cache = new Map<string, GeocodedPlace | null>();

  constructor(private readonly config: ConfigService) {
    this.baseUrl = (
      this.config.get<string>('NOMINATIM_BASE_URL') ?? DEFAULT_BASE_URL
    ).replace(/\/+$/, '');
    // Apagado explícito = ni un byte a la red. Es lo que usan los tests de
    // integración: la suite NO puede depender de un servicio de terceros.
    this.enabled =
      (this.config.get<string>('GEOCODING_ENABLED') ?? 'true') !== 'false';
  }

  /** Sólo para tests: que el tope del caché sea observable sin exponer el Map. */
  get cacheSize(): number {
    return this.cache.size;
  }

  async reverse(lat: number, lng: number): Promise<GeocodedPlace | null> {
    if (!this.enabled) return null;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
    if (this.cache.has(key)) return this.cache.get(key) ?? null;

    const url =
      `${this.baseUrl}/reverse?lat=${encodeURIComponent(lat)}` +
      `&lon=${encodeURIComponent(lng)}&format=jsonv2&addressdetails=1`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!res.ok) {
        this.logger.warn(
          `Nominatim respondió ${res.status} para ${key} — la dirección se guarda sin jurisdicción`,
        );
        return null;
      }
      const place = parseNominatimPlace(await res.json());
      // Sólo se cachea lo que contestó de verdad. Un error NO se cachea: sería
      // convertir un hipo de red en una dirección sin estado para siempre.
      this.remember(key, place);
      return place;
    } catch (err) {
      this.logger.warn(
        `Geocodificación inversa fallida para ${key}: ${(err as Error).message}`,
      );
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private remember(key: string, place: GeocodedPlace | null): void {
    if (this.cache.size >= CACHE_MAX) {
      // FIFO: la entrada más vieja es la primera del Map.
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, place);
  }
}
