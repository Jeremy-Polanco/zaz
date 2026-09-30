/**
 * Unit specs para sortOrdersForDispatch — el orden de despacho del admin.
 *
 * El repartidor arma la ruta: los pedidos VIVOS salen primero, del más cerca
 * al más lejos. El histórico (entregado / cancelado) va después y ahí sí manda
 * la cronología.
 *
 * Regla del dueño (2026-09-29): un pedido programado para un día FUTURO sale de
 * la ruta de hoy y vuelve solo el día que le toca. Los días son texto ISO
 * ('YYYY-MM-DD') y "hoy" se le pasa a la función, así que ningún test depende
 * del reloj ni de la zona horaria de la máquina.
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

/** El "hoy" de los tests: un día fijo, sin tocar el reloj real. */
const TODAY = '2026-09-14';

type SortableOrder = Pick<
  Order,
  'status' | 'deliveryAddress' | 'createdAt' | 'scheduledDeliveryDate'
> & {
  id: string;
};

function order(
  id: string,
  status: OrderStatus,
  deliveryAddress: GeoAddress | null,
  createdAt: string,
  scheduledDeliveryDate: string | null = null,
): SortableOrder {
  return {
    id,
    status,
    deliveryAddress,
    createdAt: new Date(createdAt),
    scheduledDeliveryDate,
  };
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

    const sorted = sortOrdersForDispatch([far, near, mid], ORIGIN, TODAY);

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

    const sorted = sortOrdersForDispatch(
      [noCoords, nullAddress, far],
      ORIGIN,
      TODAY,
    );

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
      TODAY,
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

    const sorted = sortOrdersForDispatch([older, newer], ORIGIN, TODAY);

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

    const sorted = sortOrdersForDispatch([b, c, a], null, TODAY);

    expect(sorted.map((o) => o.id)).toEqual(['a', 'b', 'c']);
    expect(sorted.every((o) => o.distanceMiles === null)).toBe(true);
  });

  it('no muta la lista que recibe', () => {
    const a = order('a', OrderStatus.QUOTED, at(0.2), '2026-09-14T10:00:00Z');
    const b = order('b', OrderStatus.QUOTED, at(0.01), '2026-09-13T10:00:00Z');
    const input = [a, b];

    sortOrdersForDispatch(input, ORIGIN, TODAY);

    expect(input.map((o) => o.id)).toEqual(['a', 'b']);
    expect(a).not.toHaveProperty('distanceMiles');
    expect(a).not.toHaveProperty('dispatchBucket');
  });
});

describe('sortOrdersForDispatch — pedidos programados', () => {
  it('un pedido programado a futuro va DESPUÉS de todos los de hoy, aunque esté más cerca', () => {
    // Regla del dueño: lo programado sale de la ruta de hoy. Que esté a la
    // vuelta de la esquina no cambia nada — todavía no le toca.
    const futureNear = order(
      'future-near',
      OrderStatus.QUOTED,
      at(0.001),
      '2026-09-14T08:00:00Z',
      '2026-09-16',
    );
    const dueFar = order(
      'due-far',
      OrderStatus.QUOTED,
      at(0.2),
      '2026-09-14T09:00:00Z',
    );
    const dueMid = order(
      'due-mid',
      OrderStatus.PENDING_VALIDATION,
      at(0.05),
      '2026-09-14T10:00:00Z',
    );

    const sorted = sortOrdersForDispatch(
      [futureNear, dueFar, dueMid],
      ORIGIN,
      TODAY,
    );

    expect(sorted.map((o) => o.id)).toEqual([
      'due-mid',
      'due-far',
      'future-near',
    ]);
  });

  it('un pedido programado para HOY sigue en la ruta (bucket due)', () => {
    const today = order(
      'today',
      OrderStatus.QUOTED,
      at(0.01),
      '2026-09-14T08:00:00Z',
      TODAY,
    );

    const [only] = sortOrdersForDispatch([today], ORIGIN, TODAY);

    expect(only.dispatchBucket).toBe('due');
  });

  it('un pedido programado que ya se venció y no se entregó sigue en la ruta (bucket due)', () => {
    // Si el día pasó y no se entregó, es el que más urge: nunca puede quedar
    // escondido en "Programados".
    const overdue = order(
      'overdue',
      OrderStatus.CONFIRMED_BY_COLMADO,
      at(0.01),
      '2026-09-10T08:00:00Z',
      '2026-09-12',
    );

    const [only] = sortOrdersForDispatch([overdue], ORIGIN, TODAY);

    expect(only.dispatchBucket).toBe('due');
  });

  it('los programados se ordenan por día y, dentro del mismo día, por cercanía', () => {
    const laterNear = order(
      'later-near',
      OrderStatus.QUOTED,
      at(0.001),
      '2026-09-14T08:00:00Z',
      '2026-09-20',
    );
    const soonFar = order(
      'soon-far',
      OrderStatus.QUOTED,
      at(0.2),
      '2026-09-14T09:00:00Z',
      '2026-09-16',
    );
    const soonNear = order(
      'soon-near',
      OrderStatus.QUOTED,
      at(0.01),
      '2026-09-14T10:00:00Z',
      '2026-09-16',
    );
    const soonNoPin = order(
      'soon-no-pin',
      OrderStatus.QUOTED,
      null,
      '2026-09-14T11:00:00Z',
      '2026-09-16',
    );

    const sorted = sortOrdersForDispatch(
      [laterNear, soonNoPin, soonFar, soonNear],
      ORIGIN,
      TODAY,
    );

    expect(sorted.map((o) => o.id)).toEqual([
      'soon-near',
      'soon-far',
      'soon-no-pin',
      'later-near',
    ]);
  });

  it('empate de día y de distancia entre programados → desempata el más reciente', () => {
    const older = order(
      'older',
      OrderStatus.QUOTED,
      at(0.05),
      '2026-09-10T10:00:00Z',
      '2026-09-16',
    );
    const newer = order(
      'newer',
      OrderStatus.QUOTED,
      at(0.05),
      '2026-09-13T10:00:00Z',
      '2026-09-16',
    );

    const sorted = sortOrdersForDispatch([older, newer], ORIGIN, TODAY);

    expect(sorted.map((o) => o.id)).toEqual(['newer', 'older']);
  });

  it('el orden completo es: de hoy, programados, histórico', () => {
    const history = order(
      'history',
      OrderStatus.DELIVERED,
      at(0.001),
      '2026-09-14T23:00:00Z',
    );
    const scheduled = order(
      'scheduled',
      OrderStatus.QUOTED,
      at(0.001),
      '2026-09-14T08:00:00Z',
      '2026-09-15',
    );
    const due = order('due', OrderStatus.QUOTED, at(0.2), '2026-09-01T08:00:00Z');

    const sorted = sortOrdersForDispatch(
      [history, scheduled, due],
      ORIGIN,
      TODAY,
    );

    expect(sorted.map((o) => o.id)).toEqual(['due', 'scheduled', 'history']);
    expect(sorted.map((o) => o.dispatchBucket)).toEqual([
      'due',
      'scheduled',
      'history',
    ]);
  });

  it('un pedido ya entregado o cancelado nunca es "programado", aunque conserve su fecha', () => {
    // El día de reparto queda guardado después de entregar: sin este filtro un
    // entregado con fecha futura (fecha corregida a mano) reaparecería como
    // programado.
    const delivered = order(
      'delivered',
      OrderStatus.DELIVERED,
      at(0.001),
      '2026-09-14T08:00:00Z',
      '2026-09-20',
    );
    const cancelled = order(
      'cancelled',
      OrderStatus.CANCELLED,
      at(0.001),
      '2026-09-13T08:00:00Z',
      '2026-09-20',
    );

    const sorted = sortOrdersForDispatch([delivered, cancelled], ORIGIN, TODAY);

    expect(sorted.map((o) => o.dispatchBucket)).toEqual(['history', 'history']);
  });

  it('la comparación es por día ISO: mañana es programado, hoy no', () => {
    const tomorrow = order(
      'tomorrow',
      OrderStatus.QUOTED,
      at(0.01),
      '2026-09-14T08:00:00Z',
      '2026-09-15',
    );
    const sameDay = order(
      'same-day',
      OrderStatus.QUOTED,
      at(0.01),
      '2026-09-14T08:00:00Z',
      '2026-09-14',
    );

    const sorted = sortOrdersForDispatch([tomorrow, sameDay], ORIGIN, TODAY);

    expect(sorted.map((o) => [o.id, o.dispatchBucket])).toEqual([
      ['same-day', 'due'],
      ['tomorrow', 'scheduled'],
    ]);
  });

  it('el cambio de "hoy" devuelve el pedido a la ruta sin tocar el pedido', () => {
    // El pedido vuelve solo al llegar su día: lo único que cambia es el `hoy`
    // que se le pasa a la función.
    const scheduled = order(
      'scheduled',
      OrderStatus.QUOTED,
      at(0.01),
      '2026-09-14T08:00:00Z',
      '2026-09-16',
    );

    const before = sortOrdersForDispatch([scheduled], ORIGIN, '2026-09-15');
    const onItsDay = sortOrdersForDispatch([scheduled], ORIGIN, '2026-09-16');

    expect(before[0].dispatchBucket).toBe('scheduled');
    expect(onItsDay[0].dispatchBucket).toBe('due');
  });
});
