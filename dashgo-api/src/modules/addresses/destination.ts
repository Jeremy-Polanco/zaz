import { Logger } from '@nestjs/common';
import type { Repository } from 'typeorm';
import type { UserAddress } from '../../entities/user-address.entity';
import type { GeocodingService } from '../geocoding/geocoding.service';
import type { GeocodedPlace } from '../geocoding/nominatim';
import type { TaxRateQuery } from './tax-jurisdiction.service';

/**
 * "¿A dónde se entrega esto?", contestado UNA sola vez para todos los caminos
 * que cobran: la orden (`OrdersService.create`) y el intent de Stripe
 * (`PaymentsService.createIntentForItems`).
 *
 * Vive acá y no adentro de un servicio porque los dos caminos tienen que
 * resolver IDÉNTICO. Si el intent cobra 8.887% y la orden cotiza 6.625%, el
 * cliente ve un precio y paga otro — y la diferencia la pone la caja.
 *
 * El orden de confianza, de más a menos:
 *   1. La FILA GUARDADA del cliente (`deliveryAddressId`, leída con el userId
 *      adentro del where: ese where ES el chequeo de propiedad). Sus campos
 *      derivados —estado, ciudad, condado— los escribió el servidor el día que
 *      se guardó la dirección.
 *   2. La GEOCODIFICACIÓN de la chincheta posteada, cuando no hay fila propia.
 *      Es una cuenta del servidor sobre un punto que sí manda el cliente.
 *   3. El ZIP POSTEADO, que lo escribe el cliente. Último, siempre.
 *
 * Un id que no es del cliente (o que ya no existe) se comporta EXACTAMENTE
 * como no mandar ninguno — incluida la geocodificación. Si no, mandar basura
 * en ese campo sería la forma de apagar la verificación del servidor y quedarse
 * con la tasa del ZIP que uno mismo eligió.
 */

/** Lo que el cliente postea del destino, recortado a lo que decide la plata. */
export interface PostedDestination {
  lat?: number | null;
  lng?: number | null;
  postalCode?: string | null;
}

export interface DestinationDeps {
  addresses: Repository<UserAddress>;
  geocoding: GeocodingService;
  /** Para dejar rastro del id que no era del cliente. Opcional. */
  logger?: Logger;
}

export interface DestinationInput {
  userId: string;
  deliveryAddressId?: string | null;
  posted?: PostedDestination | null;
}

export interface ResolvedDestination {
  /** La fila propia, o null (no mandó id, o el id no era suyo). */
  bookAddress: UserAddress | null;
  /** Lo que contestó el geocoder, o null (no se llamó, o no contestó). */
  place: GeocodedPlace | null;
  /** Lo que se le pregunta a `TaxJurisdictionService`. */
  taxQuery: TaxRateQuery;
}

/**
 * Resuelve el destino. NUNCA lanza por culpa del geocoder: `GeocodingService`
 * ya devuelve null ante cualquier error, y una caída de Nominatim no puede
 * impedir una compra.
 *
 * OJO: esto hace una lectura a la base y (a veces) una llamada de red. Se llama
 * AFUERA de la transacción que crea el pedido — una transacción abierta
 * esperando el DNS de un tercero bloquea filas de `orders` y `products`.
 */
export async function resolveDestination(
  deps: DestinationDeps,
  input: DestinationInput,
): Promise<ResolvedDestination> {
  let bookAddress: UserAddress | null = null;
  if (input.deliveryAddressId) {
    bookAddress = await deps.addresses.findOne({
      where: { id: input.deliveryAddressId, userId: input.userId },
    });
    if (!bookAddress) {
      deps.logger?.warn(
        `deliveryAddressId ${input.deliveryAddressId} no pertenece al usuario ${input.userId} — se resuelve como si no lo hubiera mandado`,
      );
    }
  }

  // Sin fila propia, la chincheta posteada es lo único que el servidor puede
  // verificar por su cuenta. Con fila propia NO se geocodifica: esa fila ya se
  // geocodificó el día que se guardó y repetirlo en cada pedido gasta la cuota
  // de 1 request/segundo de la política de uso de Nominatim.
  const place =
    !bookAddress && hasPin(input.posted)
      ? await deps.geocoding.reverse(
          input.posted.lat as number,
          input.posted.lng as number,
        )
      : null;

  return {
    bookAddress,
    place,
    taxQuery: bookAddress
      ? {
          ...bookAddressTaxQuery(bookAddress),
          // Si la fila todavía no tiene ZIP (libreta vieja, chincheta del admin
          // sin código), se usa el posteado: es el único ZIP que existe, y sin
          // él no hay zona que resolver. El ESTADO de la fila —que es lo que
          // decide la ley— sigue mandando igual.
          postalCode:
            bookAddress.postalCode ?? trimmed(input.posted?.postalCode) ?? null,
        }
      : {
          zoneId: null,
          // El ZIP que ESCRIBIÓ el cliente manda sobre el geocodificado: en el
          // borde de dos polígonos el geocoder devuelve el de al lado, y el
          // cliente sabe por qué código postal le entra el correo. El estado
          // —que es lo que decide la ley— sigue siendo del servidor.
          postalCode: trimmed(input.posted?.postalCode) ?? place?.postalCode ?? null,
          state: place?.state ?? null,
          city: place?.city ?? null,
          county: place?.county ?? null,
        },
  };
}

/**
 * Lo que la fila guardada le dice al resolutor de impuesto. `zoneId` viaja
 * porque la libreta SÍ cachea la zona resuelta; el pedido no la guarda.
 */
export function bookAddressTaxQuery(address: UserAddress): TaxRateQuery {
  return {
    zoneId: address.zoneId ?? null,
    postalCode: address.postalCode ?? null,
    state: address.state ?? null,
    city: address.city ?? null,
    county: address.county ?? null,
  };
}

function hasPin(
  posted: PostedDestination | null | undefined,
): posted is PostedDestination & { lat: number; lng: number } {
  return (
    !!posted &&
    typeof posted.lat === 'number' &&
    typeof posted.lng === 'number' &&
    Number.isFinite(posted.lat) &&
    Number.isFinite(posted.lng)
  );
}

function trimmed(value: string | null | undefined): string | null {
  return (value ?? '').trim() || null;
}
