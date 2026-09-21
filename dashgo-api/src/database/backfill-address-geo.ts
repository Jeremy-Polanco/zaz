import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { DataSource, IsNull } from 'typeorm';
import { AppModule } from '../app.module';
import { UserAddress } from '../entities/user-address.entity';
import { DeliveryZone } from '../entities/delivery-zone.entity';
import { GeocodingService } from '../modules/geocoding/geocoding.service';
import { resolveZoneId } from '../modules/addresses/resolve-zone';

/**
 * Backfill de una sola vez — le pone ciudad, estado y condado a las direcciones
 * que se guardaron ANTES de que el servidor geocodificara (migración 1809).
 *
 * Por qué importa: el estado es lo que decide la tasa de impuesto (New Jersey
 * 6.625%, New York City 8.875%). Una dirección sin estado resuelve por el ZIP,
 * que alcanza en el 95% de los casos pero falla justo donde duele — en los
 * bordes, donde dos jurisdicciones comparten prefijo.
 *
 * SEGURO POR DEFECTO: corre en DRY RUN (imprime lo que haría, no escribe nada).
 * Hay que pasar APPLY=1 explícitamente para que toque la base.
 *
 * VA LENTO A PROPÓSITO: la política de uso de Nominatim permite 1 request por
 * segundo y un solo hilo. Este script duerme 1100 ms entre filas. Mil
 * direcciones son ~18 minutos: dejalo correr, no lo paralelices — que te
 * bloqueen la IP es mucho más caro que esperar.
 *
 * Correr en la consola de DigitalOcean (la imagen de producción no tiene
 * ts-node ni devDependencies, así que `npm run` NO sirve ahí):
 *
 *   node dist/database/backfill-address-geo.js              # ensayo, no escribe
 *   APPLY=1 node dist/database/backfill-address-geo.js      # escribe
 *   APPLY=1 LIMIT=50 node dist/database/backfill-address-geo.js   # de a tandas
 *
 * Es idempotente: sólo mira las filas con `state IS NULL AND geocoded_at IS
 * NULL` —las que NUNCA se geocodificaron— así que volver a correrlo retoma
 * donde quedó.
 *
 * Las DOS condiciones importan. Con `state IS NULL` sola, una dirección que
 * Nominatim ubica FUERA de New Jersey y New York (Pennsylvania, Connecticut,
 * un punto en el agua) se queda sin estado —no está en el mapa de siglas— y
 * volvería a la cola en cada vuelta, para siempre, gastando la cuota de 1
 * request/segundo en una respuesta que ya sabemos. `geocoded_at` es el sello de
 * "acá ya miramos": se pone cuando el geocoder CONTESTÓ, aunque el estado no se
 * haya podido mapear.
 *
 * Un FALLO del geocoder no sella nada: esa dirección queda para la próxima
 * vuelta, que es justo lo que se quiere.
 */

/** La pausa que pide la política de Nominatim, con un margen. */
const RATE_LIMIT_MS = 1100;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function run(): Promise<void> {
  const logger = new Logger('BackfillAddressGeo');
  const apply = process.env.APPLY === '1';
  const limit = parseInt(process.env.LIMIT ?? '', 10);

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const dataSource = app.get(DataSource);
    const geocoding = app.get(GeocodingService);
    const addresses = dataSource.getRepository(UserAddress);
    const zones = dataSource.getRepository(DeliveryZone);

    if (process.env.GEOCODING_ENABLED === 'false') {
      logger.error(
        'GEOCODING_ENABLED=false — el geocoder no va a contestar y no se completaría ni una fila. Abortando.',
      );
      return;
    }

    logger.log(
      apply
        ? 'APPLY — se va a ESCRIBIR en user_addresses.'
        : 'DRY RUN — no se escribe nada. Revisá la salida y re-corré con APPLY=1.',
    );

    // Las zonas activas se leen UNA vez: son un puñado de filas y el "prefijo
    // más largo que matchea" se resuelve en memoria (ver resolve-zone.ts).
    const activeZones = await zones.find({ where: { isActive: true } });

    const pending = await addresses.find({
      // Lo que nunca se geocodificó. Ver el encabezado: las dos condiciones.
      where: { state: IsNull(), geocodedAt: IsNull() },
      // Por fecha de alta: si el proceso se corta, la próxima vuelta retoma en
      // un orden estable en vez de saltar de acá para allá.
      order: { createdAt: 'ASC' },
      ...(Number.isFinite(limit) && limit > 0 ? { take: limit } : {}),
    });

    logger.log(
      `${pending.length} dirección(es) sin geocodificar para completar.`,
    );

    let geocoded = 0;
    let written = 0;
    let failed = 0;

    for (const [index, address] of pending.entries()) {
      // La pausa va ANTES de cada request menos el primero: así el ritmo real
      // es de 1 request cada 1.1 s aunque la respuesta tarde 0 ms.
      if (index > 0) await sleep(RATE_LIMIT_MS);

      const place = await geocoding.reverse(address.lat, address.lng);
      if (!place) {
        failed++;
        logger.warn(
          `${address.id} → sin respuesta del geocoder (lat ${address.lat}, lng ${address.lng}); queda para la próxima vuelta`,
        );
        continue;
      }
      geocoded++;

      // Ciudad, estado y condado son hechos del servidor: se escriben siempre.
      // El ZIP y el número de puerta SÓLO si están vacíos — lo que escribió el
      // cliente alguna vez no se pisa con lo que dice un polígono.
      const postalCode = address.postalCode ?? place.postalCode ?? null;
      const houseNumber = address.houseNumber ?? place.houseNumber ?? null;
      const zoneId = postalCode
        ? resolveZoneId(postalCode, activeZones)
        : address.zoneId ?? null;

      logger.log(
        `${address.id} → ${place.state ?? '??'} / ${place.city ?? '??'} / ${
          place.county ?? '??'
        } / ZIP ${postalCode ?? '—'}${zoneId ? ` / zona ${zoneId}` : ''}${
          place.state ? '' : ' (fuera de NJ/NY: se sella y sale de la cola)'
        }`,
      );

      if (!apply) continue;

      await addresses.update(address.id, {
        city: place.city,
        state: place.state,
        county: place.county,
        postalCode,
        houseNumber,
        zoneId,
        // El sello va en TODA fila que el geocoder contestó, tenga estado o no:
        // es lo que la saca de la cola. Sin esto, una dirección de fuera de
        // NJ/NY se re-procesa en cada vuelta hasta el fin de los tiempos.
        geocodedAt: new Date(),
      });
      written++;
    }

    logger.log(
      `Resumen — ${pending.length} candidata(s), ${geocoded} geocodificada(s), ${failed} sin respuesta, ${written} escrita(s).`,
    );
    if (!apply && pending.length > 0) {
      logger.log(
        'Nada se escribió. Para aplicar: APPLY=1 node dist/database/backfill-address-geo.js',
      );
    }
  } finally {
    await app.close();
  }
}

run().catch((err) => {
  console.error('Backfill de geocodificación de direcciones falló:', err);
  process.exit(1);
});
