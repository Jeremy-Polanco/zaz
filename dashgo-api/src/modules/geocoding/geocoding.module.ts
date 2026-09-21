import { Module } from '@nestjs/common';
import { GeocodingService } from './geocoding.service';

/**
 * Módulo sin entidades ni controladores: es un cliente HTTP con caché.
 * Lo importan AddressesModule (para completar la dirección al guardarla) y
 * OrdersModule (para el snapshot de un pedido que llega sin dirección guardada).
 * No importa nada de la app, así que nunca arma un ciclo.
 */
@Module({
  providers: [GeocodingService],
  exports: [GeocodingService],
})
export class GeocodingModule {}
