/**
 * Lectura PURA de una respuesta de Nominatim (OpenStreetMap).
 *
 * Vive separada del servicio por dos razones concretas:
 *  1. El script de backfill (`src/database/backfill-address-geo.ts`) tiene que
 *     interpretar EXACTAMENTE igual que la API: si el backfill leyera el estado
 *     de otra forma, media libreta quedaría con una jurisdicción y media con
 *     otra, y eso es plata.
 *  2. Se puede testear contra payloads reales sin levantar Nest ni tocar la red.
 */

/** Lo único que nos importa de un punto del mapa: quién cobra impuesto ahí. */
export interface GeocodedPlace {
  houseNumber: string | null;
  road: string | null;
  city: string | null;
  county: string | null;
  /** Dos letras ('NJ', 'NY'). Es la clave con la que se busca la jurisdicción. */
  state: string | null;
  /** Primeros 5 dígitos: Nominatim a veces devuelve ZIP+4. */
  postalCode: string | null;
  countryCode: string | null;
}

/**
 * Nombre completo → sigla, SÓLO para el caso en que Nominatim no mande
 * `ISO3166-2-lvl4` (pasa con algunos puntos rurales y con instancias self-hosted
 * viejas). Deliberadamente corto: los dos estados donde repartimos. Un estado
 * que no esté acá devuelve `state: null`, y sin estado la tasa cae en el
 * fallback histórico — que es la regla de la casa, nunca 0.
 */
const STATE_NAME_TO_CODE: Record<string, string> = {
  'new jersey': 'NJ',
  'new york': 'NY',
};

interface NominatimAddress {
  house_number?: string | null;
  road?: string | null;
  city?: string | null;
  town?: string | null;
  village?: string | null;
  hamlet?: string | null;
  municipality?: string | null;
  county?: string | null;
  state?: string | null;
  'ISO3166-2-lvl4'?: string | null;
  postcode?: string | null;
  country_code?: string | null;
}

export interface NominatimReverseResponse {
  address?: NominatimAddress;
  error?: string;
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

/**
 * El ZIP se guarda como los 5 dígitos de siempre: la resolución de zona y de
 * jurisdicción compara PREFIJOS ('0720', '104'), y un "07201-1234" matchearía
 * igual pero se vería distinto de lo que escribe el cliente en el formulario.
 */
function fiveDigitZip(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  return digits.length >= 5 ? digits.slice(0, 5) : null;
}

/**
 * Sigla del estado. SIEMPRE gana el código ISO ('US-NJ' → 'NJ'): es el dato
 * estructurado que Nominatim garantiza en Estados Unidos, mientras que
 * `address.state` es texto libre de OSM que en el borde de dos estados puede
 * venir con el nombre de al lado. El mapa de nombres es sólo el respaldo para
 * cuando el ISO no viene.
 *
 * Se acepta la sigla pelada ('NJ') además de 'US-NJ' porque algunas instancias
 * self-hosted la devuelven así. Un ISO de OTRO país ('CA-ON' es Ontario, no
 * California) NO se lee como sigla de estado: devolver 'ON' inventaría una
 * jurisdicción. Sin estado, la tasa cae en el fallback histórico — la regla de
 * la casa, nunca 0.
 */
function stateCode(address: NominatimAddress): string | null {
  const iso = text(address['ISO3166-2-lvl4']);
  if (iso) {
    // Sólo 'US-XX' o la sigla pelada 'XX'. 'CA-ON' no matchea a propósito, y
    // un ISO presente pero ilegible NO cae al nombre: si Nominatim ya dijo
    // dónde está, el texto libre no lo va a contradecir mejor.
    const match = /^(?:US-)?([A-Za-z]{2})$/.exec(iso);
    return match ? match[1].toUpperCase() : null;
  }
  const name = text(address.state);
  if (!name) return null;
  return STATE_NAME_TO_CODE[name.toLowerCase()] ?? null;
}

/**
 * Traduce un payload de Nominatim a `GeocodedPlace`.
 *
 * `null` cuando no hay nada utilizable (respuesta de error, sin `address`,
 * basura). NO lanza: quien llama está guardando una dirección o creando un
 * pedido, y que el geocoder no conteste no puede tumbar ninguna de las dos
 * cosas.
 */
export function parseNominatimPlace(payload: unknown): GeocodedPlace | null {
  if (!payload || typeof payload !== 'object') return null;
  const body = payload as NominatimReverseResponse;
  if (body.error) return null;
  const address = body.address;
  if (!address || typeof address !== 'object') return null;

  return {
    houseNumber: text(address.house_number),
    road: text(address.road),
    // Nominatim nombra el municipio distinto según el tamaño del lugar: NYC y
    // Elizabeth caen en `city`, pero un pueblo de NJ puede venir como `town` o
    // `village`. Sin esta cascada media libreta quedaría sin ciudad.
    city:
      text(address.city) ??
      text(address.town) ??
      text(address.village) ??
      text(address.hamlet) ??
      text(address.municipality),
    county: text(address.county),
    state: stateCode(address),
    postalCode: fiveDigitZip(address.postcode),
    countryCode: text(address.country_code)?.toLowerCase() ?? null,
  };
}
