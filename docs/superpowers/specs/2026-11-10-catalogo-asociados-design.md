# Catálogo mayorista para asociados — diseño

Fecha: 2026-11-10 · Proyectos: `dashgo-api`, `dashgo-web`, `dashgo` (mobile)
Construye sobre: `2026-11-06-pool-puntos-asociados-design.md` (rol `associate`,
ya en producción desde `2752515`).

## Intención

Los asociados son **revendedores** (por ejemplo, bodegas): le compran a Udash
**al por mayor** para revender. El dueño quiere elegir **qué productos** puede
comprar un asociado y **a qué precio**, y que el asociado **no vea el resto del
catálogo**. En particular, no quiere venderles bebederos ni nada que no sea
para reventa; hoy eso es agua, pero la lista es la que el admin arme: pueden ser
varios productos, los que él decida.

## Decidido por el dueño

1. El admin arma una **lista de productos para asociados**, cada uno con un
   **precio fijo mayorista**. Puede tener tantos productos como quiera.
2. El asociado ve **solo** los productos de esa lista, a ese precio. Nada más
   del catálogo.
3. **Una sola lista y un solo precio para todos los asociados** (no hay tratos
   por asociado).
4. Los productos salen del **catálogo existente** (el mismo "Botellón 5 gal"),
   no son productos aparte. El stock es el mismo.
5. **Sin cantidad mínima.**
6. El asociado tampoco ve las ofertas de bebedero: suscripción y alquileres.
7. Lo que compra un asociado **no alimenta el pool**.
8. Para el cliente no cambia nada. El asociado sigue teniendo su saldo del pool
   y lo puede usar en estas compras. Envío ($5 fijo), entrega y formas de pago,
   como hoy.
9. Web y mobile, las dos (asociado y admin).

## Objetivos

- Que el admin pueda poner y quitar productos de la lista y cambiar su precio,
  desde web y desde mobile.
- Que el asociado vea y pague exactamente el precio mayorista, y que el cobro
  (orden y PaymentIntent de Stripe) coincida.
- Que un asociado no pueda comprar un producto fuera de la lista, ni siquiera
  armando el request a mano o desde una versión vieja de la app.

## No-objetivos

- Precios distintos por asociado, escalas por cantidad, mínimos de compra.
- Productos exclusivos de asociados que el cliente no vea. Todo producto de la
  lista sigue visible para el público a su precio normal.
- Marcar los pedidos de asociados en la ruta de reparto.
- Cambios en comisiones de vendedores o promotores (ver "Lo que no cambia").

## Anti-objetivos (si pasa esto, falló aunque "funcione")

- Que un cliente o un invitado vea el precio mayorista en cualquier respuesta
  de la API o pantalla.
- Que un asociado compre algo que el admin no puso en la lista, o a un precio
  que no es el de la lista.
- Que una compra de asociado sume al pool.
- Que la orden y el PaymentIntent calculen montos distintos.

## Cómo se construye (decisiones tomadas)

### Datos

- **Columna nueva `products.associate_price_cents`** (entero, nullable,
  `CHECK (associate_price_cents > 0)`). `NULL` = el producto no se ofrece a
  asociados; un valor = está en la lista a ese precio. *Decisión mía:* una
  columna en vez de una tabla tipo `seller_products`, porque hay una sola lista
  y un solo precio; sigue el patrón de `subscriber_price_cents`.
- *Decisión mía:* el precio tiene que ser **mayor a 0**. Un mayorista gratis es
  casi seguro un error de tipeo del admin.
- *Decisión mía:* solo productos de pago único pueden tener precio de asociado.
  La API rechaza el precio en productos de alquiler (`pricingMode = 'rental'`),
  en el servicio de mantenimiento y en los bebederos de suscriptor
  (`isMaintenanceService`, `isDefaultSubscriberBebedero`,
  `isPremiumSubscriberProduct`). Es lo que el dueño no quiere venderles, y el
  precio de alquiler es mensual, no cabe en un precio fijo.
- **Columna nueva `orders.associate_pricing`** (boolean, not null, default
  false). Se fija en `true` al crear la orden cuando el comprador es asociado.
  Es lo que decide que esa orden no aporte al pool (ver abajo). Se congela en la
  orden porque el rol puede cambiar entre la compra y la entrega, y lo que manda
  es a qué precio se vendió, no el rol de hoy.
- Migración con `up` y `down`.

### Precio

- `getEffectivePrice` (`dashgo-api/src/modules/products/pricing.ts`) suma una
  opción `isAssociate`. Si es asociado y el producto tiene
  `associatePriceCents`, el precio es **ese, fijo**: no aplican ofertas ni
  precio de suscriptor, ni para arriba ni para abajo. *Decisión mía:* el dueño
  dijo "precio fijo"; si un día una oferta pública queda por debajo, el asociado
  no la ve porque no ve el catálogo público.
- Los **dos caminos de cobro** (`orders.service.create` y
  `payments.service.createIntentForItems`) resuelven `isAssociate` del lado del
  servidor con el rol actual del usuario (el JWT ya recarga el usuario en cada
  request) y lo pasan a `getEffectivePrice`.

### Qué puede comprar el asociado (se valida en el servidor)

- En los dos caminos de cobro: si el comprador es asociado y algún producto del
  carrito no tiene `associatePriceCents` (o no está disponible), se rechaza con
  400, código `PRODUCT_NOT_AVAILABLE_FOR_ASSOCIATES` y mensaje en español
  ("Este producto no está disponible para asociados"). Se valida **antes** de
  crear nada.
- Las órdenes del sistema (`opts.provisioned`, p. ej. mantenimiento de un
  bebedero que el usuario ya tenía) quedan fuera de esta regla.
- La regla mira al **comprador** de la orden, no a quien hace el request (si
  existe algún camino donde el admin crea pedidos a nombre de otro).
- `POST /subscription/checkout-session` responde 403 a un asociado ("Los
  asociados no pueden contratar la suscripción"). Lo que un asociado ya tuviera
  de antes (suscripción, alquiler) no se toca: portal, cancelación y
  reactivación siguen funcionando.

### Catálogo que ve cada uno (`GET /products`, público)

- **Asociado:** solo productos disponibles con `associatePriceCents` no nulo.
  Cada producto sale con `effectivePriceCents` y `basePriceCents` iguales al
  precio de asociado, `offerActive = false`, sin datos de oferta y
  `subscriberPriceCents = null`. Así web y mobile, **incluidas las versiones
  viejas de la app que ya están en la calle**, muestran el precio mayorista sin
  saber nada de asociados, y no aparece ni oferta ni gancho de suscriptor.
- La lista del vendedor (`seller_products`) **no aplica** a asociados: manda la
  lista de asociados.
- *Decisión mía:* **lista vacía = catálogo vacío** para el asociado (con un
  mensaje tipo "Todavía no hay productos disponibles para asociados"). Es lo
  contrario de la lista del vendedor, que vacía muestra todo; acá mostrar todo
  es justo lo que el dueño no quiere.
- **Cliente e invitado:** como hoy, pero **sin** el campo `associatePriceCents`
  en la respuesta (se quita igual que hoy se quitan `pointsPct` y
  `promoterCommissionPct`). Esto vale para toda respuesta pública de productos.
- El catálogo de admin (`GET /products/admin`) sí devuelve el campo.

### Pool

- `PoolService.contributeForOrder` no aporta nada si la orden tiene
  `associate_pricing = true`.

### Pantallas

- **Admin (web `super.products` y mobile `(super)/products`):** campo nuevo
  "Precio para asociados" en el formulario del producto; vacío = no se ofrece.
  En la lista de productos, una marca visible con el precio ("Asociados $X")
  para saber de un vistazo qué está en la lista. Validaciones en español y el
  formulario respeta lo que ya hay (`noValidate`, errores propios).
- **Asociado (web y mobile):** el catálogo y el inicio muestran lo que devuelve
  la API, sin lógica nueva de precio en el cliente. Se ocultan para asociados
  los accesos y promociones de suscripción y bebederos (nav, "Más", inicio,
  perfil). *Decisión mía:* si el asociado ya tiene una suscripción o un alquiler
  de antes, sigue viendo esas pantallas para poder gestionarlos.
- Los helpers de precio del cliente (`lib/pricing.ts` en web y mobile) **no**
  cambian: el servidor ya entrega el precio correcto.
- *Decisión mía:* la caché del catálogo en web y mobile (hoy la clave
  `['products']` no depende del usuario) se refresca al iniciar o cerrar sesión
  y al cambiar el rol. Si no, un asociado cuyo token venció ve el catálogo
  público cacheado como invitado, o un cliente recién ascendido sigue viendo el
  catálogo público. El precio mayorista nunca llega a un invitado: el riesgo es
  solo en la otra dirección.

## Salida a producción (decidido por el dueño)

Con la regla "lista vacía = catálogo vacío", al desplegar la API los asociados
que ya existan ven el catálogo vacío hasta que el admin cargue la lista. Se
acepta así, **sin datos precargados en la migración y sin excepción temporal**:
el admin web sale en el mismo deploy que la API, y el dueño carga los productos
y precios mayoristas desde la web apenas termine el deploy. Conviene desplegar
cuando el dueño esté disponible para hacerlo, y avisarle antes. El admin mobile
llega después con la versión nueva de la app (EAS); hasta entonces la lista se
maneja desde la web.

## Lo que no cambia

- Impuestos: siguen por `tax_category` del producto y jurisdicción.
- Envío fijo de $5.
- Saldo del pool y fiado: el asociado los puede usar en estas compras.
- Comisiones de vendedor/promotor: se siguen calculando sobre `priceAtOrder`
  (lo que se cobró de verdad), sin regla nueva.
- Stock compartido con el producto público.

## Casos a cubrir con tests

- Asociado con un producto fuera de la lista en el carrito → rechazado en orden
  **y** en PaymentIntent, sin escribir nada.
- El admin quita un producto de la lista mientras el asociado lo tiene en el
  carrito → rechazado con el mensaje claro.
- Cliente que pasa a asociado con carrito público → rechazado; asociado que
  vuelve a cliente → paga precio público.
- Producto con oferta vigente y precio de asociado → el asociado paga el precio
  de asociado; el cliente, la oferta.
- Orden de asociado entregada → no aporta al pool; orden de cliente sí.
- `GET /products` como invitado y como cliente no incluye `associatePriceCents`.
- Orden y PaymentIntent calculan el mismo total para un asociado.

## Qué queda en manos de quien lo construya

- Nombres internos, forma exacta de los DTOs y del endpoint de admin (puede ir
  dentro del `PATCH /products/:id` existente).
- Cómo se ve la marca "Asociados $X" y el mensaje de catálogo vacío.
- Qué superficies exactas de suscripción/bebedero hay que ocultar: buscar todas
  en web y mobile.
- Textos nuevos de mobile en los dos idiomas (es/en), como el resto.
