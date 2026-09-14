/**
 * Lo mínimo que la resolución necesita saber de una zona. Se tipa así y no como
 * `DeliveryZone` para que la función sea pura y testeable sin arrastrar TypeORM
 * a un spec que sólo compara strings.
 */
export interface ZoneForResolution {
  id: string;
  zipPrefixes: string[];
  isActive: boolean;
}

/**
 * Elige la zona de reparto a la que pertenece un código postal.
 *
 * Gana el prefijo MÁS LARGO que matchea: así el admin puede meter una zona fina
 * ("1045" = un barrio del Bronx) encima de una gruesa ("104" = todo el Bronx)
 * sin tener que inventar un campo de prioridad que después nadie mantiene.
 *
 * Las zonas apagadas (`isActive: false`) no clasifican: se apagan justamente
 * para dejar de usarse, pero no se borran porque las órdenes viejas todavía las
 * referencian para explicar el recargo que se cobró.
 *
 * Sin ZIP (dirección vieja, o chincheta del admin sin código) no hay zona —
 * `null` es un resultado válido, no un error.
 */
export function resolveZoneId(
  postalCode: string | null,
  zones: Array<ZoneForResolution>,
): string | null {
  const zip = (postalCode ?? '').trim();
  if (!zip) return null;

  let bestId: string | null = null;
  let bestLength = 0;

  for (const zone of zones) {
    if (!zone.isActive) continue;
    for (const prefix of zone.zipPrefixes ?? []) {
      // Un prefijo vacío es prefijo de TODO: una zona mal cargada se llevaría
      // puestos a todos los clientes. Se descarta antes de comparar.
      if (!prefix) continue;
      if (!zip.startsWith(prefix)) continue;
      if (prefix.length > bestLength) {
        bestLength = prefix.length;
        bestId = zone.id;
      }
    }
  }

  return bestId;
}
