/**
 * Envío fijo POR DEFECTO de toda orden de cliente, en centavos.
 *
 * Ojo con el nombre: esto ya NO es la tarifa vigente, es el valor de arranque.
 * Pedido del dueño (2026-09-14): "sería bueno que el super admin pueda
 * modificar la tasa general del delivery". La tarifa que se cobra de verdad la
 * fija el admin con `PUT /shipping/rate` y queda guardada en
 * `app_settings.flat_shipping_cents`; esta constante es lo que se usa mientras
 * esa fila no exista (o tenga basura adentro). Quien necesite el número real
 * tiene que pedírselo a `ShippingRateService.getFlatShippingCents()`, nunca
 * importar esta constante y cobrarla.
 *
 * No hace falta migración que siembre la fila: "sin fila" ES "el admin todavía
 * no tocó nada", y eso significa los $5 de siempre.
 *
 * Regla de negocio que sigue igual: el envío lo paga TODA orden de cliente —
 * no hay exención por suscripción ("los suscriptores tampoco van a tener el
 * envío gratis, simplemente va a ser para que tengan el bebedero"). La
 * suscripción paga el bebedero, el precio de suscriptor y el mantenimiento,
 * nunca el viaje. La única orden sin envío es la que provisiona el SISTEMA
 * para entregar un beneficio (bebedero gratis, instalación premium): esas
 * nacen en $0 porque nadie las pidió y `deliverProvisionedOrder` no acepta
 * otra cosa. Lo marca `opts.provisioned` en OrdersService.create.
 *
 * Esta API es la fuente de verdad. Los espejos del frontend
 * (dashgo-web/src/lib/tax.ts y dashgo/src/lib/tax.ts) son sólo un FALLBACK
 * para pintar algo antes de que responda `GET /shipping/rate` — el número que
 * se cobra sale siempre de acá.
 *
 * OJO: esto NO es el recargo por distancia (`orders.delivery_surcharge`), que
 * vive en su propia columna, lo fija el admin al cotizar y el suscriptor SÍ
 * paga.
 */
export const DEFAULT_FLAT_SHIPPING_CENTS = 500;
