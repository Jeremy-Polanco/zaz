/**
 * Unit specs para sortOrdersForDispatch — el orden de despacho del admin.
 *
 * El repartidor arma la ruta: los pedidos VIVOS salen primero, del más cerca
 * al más lejos. El histórico (entregado / cancelado) va después y ahí sí manda
 * la cronología.
 */

import { Order } from '../../entities';
import { OrderStatus, type GeoAddress } from '../../entities/enums';
import { sortOrdersForDispatch } from './dispatch-sort';

const ORIGIN = { lat: 40, lng: -74 };

/** 1 grado de latitud ≈ 69.09 millas con el radio que usa haversineMiles. */
const at = (degreesNorth: number): GeoAddress => ({
  text: 'x',
  lat: 40 + degreesNorth,
  lng: -74,
});

type SortableOrder = Pick<Order, 'status' | 'deliveryAddress' | 'createdAt'> & {
  id: string;
};

function order(
  id: string,
  status: OrderStatus,
  deliveryAddress: GeoAddress | null,
  createdAt: string,
): SortableOrder {
  return { id, status, deliveryAddress, createdAt: new Date(createdAt) };
}

describe('sortOrdersForDispatch', () => {
  it('pone los pedidos vivos primero, del más cerca al más lejos', () => {
    const far = order(
      'far',
      OrderStatus.QUOTED,
      at(0.2),
      '2026-09-14T10:00:00Z',
    );
    const near = order(
      'near',
      OrderStatus.PENDING_QUOTE,
      at(0.01),
      '2026-09-14T08:00:00Z',
    );
    const mid = order(
      'mid',
      OrderStatus.IN_DELIVERY_ROUTE,
      at(0.05),
      '2026-09-14T09:00:00Z',
    );

    const sorted = sortOrdersForDispatch([far, near, mid], ORIGIN);

    expect(sorted.map((o) => o.id)).toEqual(['near', 'mid', 'far']);
    // Redondeada a 1 decimal — es una ayuda de ruta, no una medición.
    expect(sorted[0].distanceMiles).toBe(0.7);
    expect(sorted[1].distanceMiles).toBe(3.5);
    expect(sorted[2].distanceMiles).toBe(13.8);
  });

  it('el pedido sin coordenadas va último entre los vivos, no primero', () => {
    // Un `null` que ordenara como 0 mandaría al final de la ruta el pedido que
    // el repartidor no puede ubicar — justo el que tiene que llamar.
    const noCoords = order(
      'no-coords',
      OrderStatus.CONFIRMED_BY_COLMADO,
      { text: 'Sin pin' },
      '2026-09-14T11:00:00Z',
    );
    const nullAddress = order(
      'null-address',
      OrderStatus.QUOTED,
      null,
      '2026-09-14T12:00:00Z',
    );
    const far = order(
      'far',
      OrderStatus.QUOTED,
      at(0.2),
      '2026-09-14T07:00:00Z',
    );

    const sorted = sortOrdersForDispatch([noCoords, nullAddress, far], ORIGIN);

    expect(sorted.map((o) => o.id)).toEqual([
      'far',
      'null-address',
      'no-coords',
    ]);
    expect(sorted[1].distanceMiles).toBeNull();
    expect(sorted[2].distanceMiles).toBeNull();
  });

  it('el histórico va después de los vivos y ahí manda la cronología', () => {
    const deliveredNew = order(
      'delivered-new',
      OrderStatus.DELIVERED,
      at(0.001),
      '2026-09-14T23:00:00Z',
    );
    const cancelledOld = order(
      'cancelled-old',
      OrderStatus.CANCELLED,
      at(0.001),
      '2026-09-10T10:00:00Z',
    );
    const activeFarAndOld = order(
      'active',
      OrderStatus.PENDING_VALIDATION,
      at(0.2),
      '2026-09-01T10:00:00Z',
    );

    const sorted = sortOrdersForDispatch(
      [deliveredNew, cancelledOld, activeFarAndOld],
      ORIGIN,
    );

    // El vivo va primero aunque sea el más viejo y el más lejos.
    expect(sorted.map((o) => o.id)).toEqual([
      'active',
      'delivered-new',
      'cancelled-old',
    ]);
  });

  it('empate de distancia entre vivos → desempata el más reciente', () => {
    const older = order(
      'older',
      OrderStatus.QUOTED,
      at(0.05),
      '2026-09-10T10:00:00Z',
    );
    const newer = order(
      'newer',
      OrderStatus.QUOTED,
      at(0.05),
      '2026-09-14T10:00:00Z',
    );

    const sorted = sortOrdersForDispatch([older, newer], ORIGIN);

    expect(sorted.map((o) => o.id)).toEqual(['newer', 'older']);
  });

  it('sin origen (repartidor sin ubicación) → todo cronológico y sin distancias', () => {
    const a = order('a', OrderStatus.QUOTED, at(0.2), '2026-09-14T10:00:00Z');
    const b = order(
      'b',
      OrderStatus.PENDING_QUOTE,
      at(0.01),
      '2026-09-13T10:00:00Z',
    );
    const c = order(
      'c',
      OrderStatus.DELIVERED,
      at(0.01),
      '2026-09-12T10:00:00Z',
    );

    const sorted = sortOrdersForDispatch([b, c, a], null);

    expect(sorted.map((o) => o.id)).toEqual(['a', 'b', 'c']);
    expect(sorted.every((o) => o.distanceMiles === null)).toBe(true);
  });

  it('no muta la lista que recibe', () => {
    const a = order('a', OrderStatus.QUOTED, at(0.2), '2026-09-14T10:00:00Z');
    const b = order('b', OrderStatus.QUOTED, at(0.01), '2026-09-13T10:00:00Z');
    const input = [a, b];

    sortOrdersForDispatch(input, ORIGIN);

    expect(input.map((o) => o.id)).toEqual(['a', 'b']);
    expect(a).not.toHaveProperty('distanceMiles');
  });
});
