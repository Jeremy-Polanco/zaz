import { Order } from '../../entities';
import { OrderStatus } from '../../entities/enums';
import { haversineMiles } from '../shipping/shipping.service';

/**
 * Estados de un pedido que TODAVÍA hay que repartir. Son los únicos que le
 * sirven al repartidor para armar la ruta; el resto es histórico.
 */
const ACTIVE_STATUSES: ReadonlySet<OrderStatus> = new Set([
  OrderStatus.PENDING_QUOTE,
  OrderStatus.QUOTED,
  OrderStatus.PENDING_VALIDATION,
  OrderStatus.CONFIRMED_BY_COLMADO,
  OrderStatus.IN_DELIVERY_ROUTE,
]);

/** Lo mínimo que necesita el orden de despacho de un pedido. */
export type DispatchSortable = Pick<
  Order,
  'status' | 'deliveryAddress' | 'createdAt' | 'scheduledDeliveryDate'
>;

/**
 * Dónde cae un pedido en la lista del repartidor:
 *  - `due`: hay que repartirlo HOY (sin día asignado, con día de hoy, o con un
 *    día que ya pasó y sigue sin entregarse).
 *  - `scheduled`: vivo pero con un día FUTURO; todavía no le toca a la ruta.
 *  - `history`: ya no hay nada que repartir (entregado / cancelado).
 */
export type DispatchBucket = 'due' | 'scheduled' | 'history';

export type WithDistance<T> = T & { distanceMiles: number | null };

export type WithDispatch<T> = WithDistance<T> & {
  dispatchBucket: DispatchBucket;
};

/**
 * Ordena la lista del admin como se reparte, no como se recibió.
 *
 * Los pedidos VIVOS van primero, del más cerca al más lejos respecto del
 * origen del repartidor; el histórico (entregado / cancelado) queda al final
 * por fecha. "Por más reciente" servía para leer novedades, no para salir a
 * repartir: obligaba a recorrer toda la lista para armar el recorrido.
 *
 * Regla del dueño (2026-09-29): un pedido al que el admin le asignó un día
 * FUTURO tiene que salir de la ruta de hoy y volver solo el día que le toca.
 * Antes seguía mezclado con la ruta porque el orden ignoraba el día. Ahora los
 * vivos se parten en dos: `due` (hay que repartirlos ya) y `scheduled`
 * (programados a futuro). El resultado es: due, scheduled, history.
 *  - Un pedido programado para HOY o con el día ya vencido es `due`: si el día
 *    pasó y no se entregó, es de los que más urgen y no puede esconderse.
 *  - Los `scheduled` van por día ascendente (el próximo primero) y, dentro del
 *    mismo día, con la misma regla de cercanía que la ruta.
 *
 * `todayIsoDay` es el día calendario de HOY en la zona del negocio
 * ('YYYY-MM-DD'; ver `todayIsoDay()` en common/delivery-day). Llega por
 * parámetro para que la función siga siendo pura y testeable sin reloj. Los
 * días ISO se comparan como texto: el orden lexicográfico coincide con el
 * cronológico, y así no se pasa por `new Date('YYYY-MM-DD')` (medianoche UTC,
 * que en Nueva York cae en el día anterior).
 *
 * `distanceMiles` es `null` cuando falta el origen o el pedido no tiene pin.
 * Esos van ÚLTIMOS entre los vivos a propósito: tratarlos como distancia 0 los
 * mandaría al final de la ruta, y son justo los que hay que llamar.
 *
 * Pura: no toca la lista que recibe ni los pedidos que hay adentro.
 */
export function sortOrdersForDispatch<T extends DispatchSortable>(
  orders: T[],
  origin: { lat: number; lng: number } | null,
  todayIsoDay: string,
): Array<WithDispatch<T>> {
  const bucketOf = (order: DispatchSortable): DispatchBucket => {
    if (!ACTIVE_STATUSES.has(order.status)) return 'history';
    const day = order.scheduledDeliveryDate;
    return day != null && day > todayIsoDay ? 'scheduled' : 'due';
  };

  const decorated: Array<WithDispatch<T>> = orders.map((order) => {
    const lat = order.deliveryAddress?.lat;
    const lng = order.deliveryAddress?.lng;
    const distanceMiles =
      origin && typeof lat === 'number' && typeof lng === 'number'
        ? Math.round(haversineMiles(origin, { lat, lng }) * 10) / 10
        : null;
    return { ...order, distanceMiles, dispatchBucket: bucketOf(order) };
  });

  const newestFirst = (a: DispatchSortable, b: DispatchSortable): number =>
    b.createdAt.getTime() - a.createdAt.getTime();

  const nearestFirst = (
    a: WithDistance<DispatchSortable>,
    b: WithDistance<DispatchSortable>,
  ): number => {
    if (a.distanceMiles === null && b.distanceMiles === null) {
      return newestFirst(a, b);
    }
    if (a.distanceMiles === null) return 1;
    if (b.distanceMiles === null) return -1;
    if (a.distanceMiles !== b.distanceMiles) {
      return a.distanceMiles - b.distanceMiles;
    }
    return newestFirst(a, b);
  };

  const due = decorated
    .filter((o) => o.dispatchBucket === 'due')
    .sort(nearestFirst);

  const scheduled = decorated
    .filter((o) => o.dispatchBucket === 'scheduled')
    .sort((a, b) => {
      // El filtro garantiza que ambos tienen día; el `?? ''` es sólo para el
      // tipo (`string | null`).
      const dayA = a.scheduledDeliveryDate ?? '';
      const dayB = b.scheduledDeliveryDate ?? '';
      if (dayA !== dayB) return dayA < dayB ? -1 : 1;
      return nearestFirst(a, b);
    });

  const history = decorated
    .filter((o) => o.dispatchBucket === 'history')
    .sort(newestFirst);

  return [...due, ...scheduled, ...history];
}
