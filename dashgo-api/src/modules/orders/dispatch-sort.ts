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
  'status' | 'deliveryAddress' | 'createdAt'
>;

export type WithDistance<T> = T & { distanceMiles: number | null };

/**
 * Ordena la lista del admin como se reparte, no como se recibió.
 *
 * Los pedidos VIVOS van primero, del más cerca al más lejos respecto del
 * origen del repartidor; el histórico (entregado / cancelado) queda al final
 * por fecha. "Por más reciente" servía para leer novedades, no para salir a
 * repartir: obligaba a recorrer toda la lista para armar el recorrido.
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
): Array<WithDistance<T>> {
  const decorated: Array<WithDistance<T>> = orders.map((order) => {
    const lat = order.deliveryAddress?.lat;
    const lng = order.deliveryAddress?.lng;
    const distanceMiles =
      origin && typeof lat === 'number' && typeof lng === 'number'
        ? Math.round(haversineMiles(origin, { lat, lng }) * 10) / 10
        : null;
    return { ...order, distanceMiles };
  });

  const newestFirst = (a: DispatchSortable, b: DispatchSortable): number =>
    b.createdAt.getTime() - a.createdAt.getTime();

  const active = decorated
    .filter((o) => ACTIVE_STATUSES.has(o.status))
    .sort((a, b) => {
      if (a.distanceMiles === null && b.distanceMiles === null) {
        return newestFirst(a, b);
      }
      if (a.distanceMiles === null) return 1;
      if (b.distanceMiles === null) return -1;
      if (a.distanceMiles !== b.distanceMiles) {
        return a.distanceMiles - b.distanceMiles;
      }
      return newestFirst(a, b);
    });

  const history = decorated
    .filter((o) => !ACTIVE_STATUSES.has(o.status))
    .sort(newestFirst);

  return [...active, ...history];
}
