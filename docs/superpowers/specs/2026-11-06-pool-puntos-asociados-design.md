# Pool de puntos para asociados — diseño

Fecha: 2026-11-06 · Proyectos: `dashgo-api`, `dashgo-web`, `dashgo` (mobile)

## Intención

El dueño de Udash quiere cambiar el programa de puntos. Hoy cada cliente gana
puntos por sus compras (un % por producto, `products.points_pct`), maduran a los
90 días, vencen a los 180 y los canjea en el checkout.

Lo nuevo: **el cliente deja de ver puntos por completo**. Los puntos que generan
las compras de todos los clientes van a un **pool común**. Cada 3 meses el pool
se reparte **en partes iguales** entre los usuarios que el admin marcó como
**Asociados**, y a cada uno le queda como **saldo para comprar en la app**.

El porqué comercial no se discutió; no inventarlo en copy ni en comentarios.

## Decidido por el dueño

Estas decisiones las tomó el dueño. No se cambian sin consultarlo:

1. **El cliente no ve nada de puntos**: ni toggle en el checkout, ni pantalla
   "Mis puntos", ni accesos en cuenta/perfil/nav (web y mobile).
2. **Rol nuevo "Asociado"** (`associate`). El admin se lo asigna a cualquier
   usuario desde la gestión de usuarios, **en web y en mobile**. El asociado
   entra con el login normal (teléfono + OTP), como cualquier usuario.
3. **Los asociados ven el pool acumulado.**
4. **Cada 3 meses el pool se reparte** y lo que le toca a cada asociado queda
   como saldo para compras.
5. **Reparto en partes iguales** entre todos los asociados que haya.
6. **Trimestres de calendario**: cierres el 1 de enero, 1 de abril, 1 de julio y
   1 de octubre.
7. **El pool se alimenta de las compras de todos los clientes**, con el % que ya
   tiene cada producto.
8. **Un usuario tiene un solo rol** (como hoy): un asociado no es a la vez
   vendedor ni promotor.
9. **Los puntos que los clientes tienen hoy sin usar** (en espera y ya
   liberados; los vencidos y canjeados no) **pasan al pool del trimestre abierto
   al momento del deploy** y se reparten en su cierre (si sale en este
   trimestre: 1 de enero de 2027).
10. **El saldo del asociado no vence nunca.**

## Decisiones del diseñador (no confirmadas una por una)

Se le presentaron al dueño y no las objetó, pero solo confirmó explícitamente la
del vencimiento. Se pueden ajustar si el builder encuentra una razón técnica.
Si una cambia el comportamiento visible, hay que avisar.

- **Cómo gasta el asociado**: en el checkout ve "Usar mi saldo de asociado"
  (reemplaza el toggle de puntos). Descuenta del **subtotal, no del envío**, y el
  impuesto se calcula sobre lo que queda: es la matemática de `pointsRedeemed`
  que ya existe (`computeTaxableBase`, prorrateo por porción gravable, y
  `lib/tax.ts` en web y mobile).
- **Uso parcial**: si el saldo supera el subtotal, se usa lo necesario y **el
  resto le queda**. Ver la trampa de `redeemAllClaimable` en Restricciones.
- **Quién ve el toggle**: cualquier usuario con saldo > 0. En la práctica son los
  asociados, y también los ex-asociados que conservan saldo.
- **Si le sacan el rol**: conserva el saldo que ya recibió y lo puede gastar,
  pero no entra en los repartos siguientes.
- **Quién cobra en un reparto**: los usuarios con rol `associate` en el momento
  en que corre el cierre.
- **Centavos que no se dividen parejo** (ej. $100.01 entre 3): pasan al pool del
  trimestre siguiente.
- **Sin asociados el día del cierre**: el pool entero pasa al trimestre
  siguiente.
- **Cuándo aporta una orden**: cuando pasa a DELIVERED (el mismo momento en que
  hoy corre `creditForOrder`). Cuenta para el trimestre de su fecha de entrega,
  en hora de Nueva York. Ya no hay maduración de 90 días: la reemplaza el cierre
  trimestral.
- **Aportan todas las órdenes entregadas**, incluidas las de los propios
  asociados, con la regla de hoy: `priceAtOrder × cantidad × points_pct`.
- **Bordes del trimestre en `America/New_York`**, como el resto del sistema
  (día de reparto, buckets de despacho).
- **El cierre es un cron al inicio del trimestre, con recuperación al
  arrancar**: si el servidor estaba caído el 1°, el reparto pendiente corre
  cuando vuelve. Es idempotente: **un único reparto por trimestre**, garantizado
  en la base de datos y no solo en el código.
- **Qué ve el asociado** (pantalla nueva en web y mobile):
  - el pool acumulado del trimestre en curso;
  - la fecha del próximo reparto;
  - cuántos asociados hay y una estimación de su parte (pool ÷ asociados de
    hoy), marcada como estimación;
  - su saldo disponible;
  - el historial de lo que recibió y lo que gastó.
- **Qué ve el admin** (web super y mobile super):
  - el pool en curso;
  - el historial de repartos: trimestre, total, cantidad de asociados, parte por
    asociado y centavos arrastrados.
- **Navegación del asociado**: usa el layout de cliente (`(tabs)` en mobile y la
  nav de cliente en web) y compra como cualquier cliente. Se le suma el acceso a
  la pantalla del pool.
- **Para todas las reglas de compra, el asociado es un CLIENTE.** Hoy
  `OrdersService` filtra por rol, y en cada uno de estos puntos `associate` tiene
  que tratarse exactamente como `CLIENT`:
  - `create` (~l. 282) tira `ForbiddenException('Solo clientes pueden crear
    pedidos')` salvo para `CLIENT`/`PROMOTER`;
  - la guarda "un pedido activo a la vez" (~l. 304) es solo `CLIENT`;
  - el fiado (`useCredit`, ~l. 665) es solo `CLIENT`;
  - la cancelación por el cliente (~l. 2152) es solo `CLIENT`/`PROMOTER`.

  Lo mismo vale para los chequeos de UI con `role === 'client'`:
  - web: el banner de mantenimiento en `__root.tsx`, `cuenta.tsx` y
    `checkout.tsx`;
  - mobile: `checkout.tsx`, `(tabs)/_layout.tsx` y `(tabs)/profile.tsx`.

  Conviene centralizarlo en un helper "compra como cliente" en vez de sumar
  `|| associate` en cada `if`.
- **Etiqueta del descuento** en facturas, detalle de orden, `QuoteDrawer` y
  `QuoteBottomSheet`: pasa a decir **"Saldo aplicado"**. Cubre las órdenes
  históricas pagadas con puntos y las nuevas pagadas con saldo de asociado. La
  columna `pointsRedeemed` se conserva.
- **Form de productos del admin**: "Puntos cliente (%)" pasa a **"Aporte al pool
  de asociados (%)"**, con su texto de ayuda. El % sigue siendo por producto.
- **Cancelaciones que devuelven saldo** (`reverseRedemptionForOrder`): si quien
  gastó es asociado o ex-asociado, el saldo vuelve a su cuenta. Si es una orden
  vieja de un cliente que había canjeado puntos, lo devuelto va al pool del
  trimestre abierto. Devolvérselo al cliente sería plata muerta, porque ya no
  puede gastarla.

## Objetivos

- El cliente compra igual que siempre y no se cruza con nada de puntos en las
  versiones nuevas de web y mobile.
- El admin asigna y quita el rol Asociado desde web y mobile.
- El pool se acumula solo, se reparte solo cada trimestre y el reparto es
  auditable al centavo.
- El asociado ve el pool y gasta su saldo en el checkout.

## No-objetivos

- Pagarle plata a los asociados (efectivo, Stripe, transferencias). El saldo es
  solo para compras en la app.
- Ponderar el reparto por ventas, antigüedad o actividad. Es en partes iguales.
- Roles múltiples por usuario.
- Cambiar cómo se configura el % por producto.
- Notificaciones push del reparto. Se pueden sumar después; no son parte de v1.
- Internacionalizar la web (sigue siendo solo en español).

## Anti-objetivos: falla aunque "funcione"

- **Un cliente sigue viendo puntos** en alguna pantalla de las versiones nuevas:
  checkout, nav, cuenta, perfil del promotor, detalle de orden.
- **Plata que desaparece**:
  - el sobrante del asociado se quema al comprar;
  - el pool baja cuando se borra un cliente;
  - el total repartido no cuadra con el pool (centavos perdidos);
  - el reparto corre dos veces, o se saltea porque el servidor estaba caído el
    día del cierre.
- **La app mobile vieja se rompe.** La mobile sale por EAS y la versión actual
  va a seguir instalada en teléfonos durante semanas.
- **La migración de saldos no deja rastro.** La base de producción es una Dev
  Database de DigitalOcean **sin backups**: si algo sale mal, tiene que poder
  reconstruirse qué se movió y de quién.

## Restricciones

- **Trampa existente en `PointsService.redeemAllClaimable`**: marca como
  canjeadas TODAS las entradas `CLAIMABLE` del usuario, aunque
  `orders.service.create` y `payments.createIntentForItems` hayan topeado el
  descuento al subtotal (`Math.min(balance.claimableCents, subtotalCents)`).
  Hoy, si el saldo supera el subtotal, el excedente se pierde. Con saldos
  trimestrales que no vencen, esto se come la plata del asociado. **El canje
  tiene que consumir exactamente lo aplicado.**
- **Borrado de usuarios**: hoy `points_ledger_entries.user_id` es
  `ON DELETE CASCADE` y `deleteAccount` documenta que borra los puntos. Borrar un
  cliente **no puede** cambiar el pool. Borrar un asociado sí puede llevarse su
  saldo, igual que hoy con los puntos.
- **Compatibilidad con la app vieja**:
  - `GET /points/balance` y `GET /points/history` tienen que seguir respondiendo
    200 para cualquier usuario logueado (con saldo propio o en cero). Nunca 404
    ni 500.
  - `usePoints: true` de un usuario sin saldo es inocuo: descuento 0.
  - La app vieja calcula el descuento con `claimableCents` de
    `GET /points/balance`. Si ese campo devuelve el saldo gastable del usuario,
    los asociados que todavía tengan la versión vieja pueden gastar su saldo
    igual. La app vieja manda a `/(tabs)` cualquier rol que no conoce, así que
    un `associate` no la rompe.
  - El backend se deploya solo al hacer push a `main`. La mobile no.
- **Paridad web ↔ mobile**: todo lo visible se replica en las dos. La matemática
  compartida vive en ambos `lib/tax.ts`.
- **i18n mobile**: el copy nuevo de mobile va en `es` y `en`. Los tests afirman
  el texto en español. La web es solo en español.
- **Enum de rol en Postgres**: agregar `associate` con el baile de renombrar el
  tipo, igual que `1801000000000-AddSellerRole.ts`. **Nunca `ALTER TYPE ... ADD
  VALUE`**: rompe dentro de la transacción de TypeORM y no tiene `down()`.
- **Migraciones** corren solas en el deploy. La de saldos existentes tiene que
  ser idempotente y tener `down()` o, como mínimo, asientos que permitan
  revertirla a mano.
- **Plata en centavos enteros** en todo el cálculo; convertir solo en el borde de
  persistencia, como hoy.
- **Tests**: modo TDD estricto. Los specs de integración comparten una sola base
  de Postgres: cada spec limpia lo suyo, y conviene correr la suite 2–3 veces
  antes de confiar en el verde. Cualquier spec que levante el `AppModule` mockea
  `stripe`. El código con fechas se prueba con `TZ=UTC npm test` y fija
  `timeZone` en las llamadas `Intl` (dentro de Jest, `process.env.TZ` no hace
  efecto).
- **Verificación**:
  - api: `npm test` + `npm run build`. **No correr `npm run lint`**: hace
    `eslint --fix` y reformatea más de 100 archivos.
  - web: `npm run build`, que no es lo mismo que `tsc --noEmit`. Si se agrega una
    ruta, hay que regenerar `routeTree.gen.ts`, que está commiteado.
- **Strings SQL crudos**: si se renombran columnas o tablas, buscar los
  `.where()` crudos y los scripts de `src/database/*.ts`. `user` es palabra
  reservada en Postgres dentro de subqueries.

## Superficies conocidas a tocar (no exhaustivo)

- **Cliente, quitar**:
  - web: toggle en `routes/checkout.tsx`; `routes/points.tsx` y los links "Mis
    puntos" de `__root.tsx` y `cuenta.tsx`;
  - mobile: toggle en `app/checkout.tsx`; `app/(tabs)/points.tsx`, la entrada en
    `(tabs)/_layout.tsx` (sheet "Más") y en `(tabs)/profile.tsx`;
  - promotor: `app/(promoter)/points.tsx`, `(promoter)/_layout.tsx` y
    `(promoter)/profile.tsx`.
- **Rol**:
  - api: `UserRole` en `entities/enums.ts` y `update-user-admin.dto.ts`;
  - web: `lib/roles.ts` (`roleLabel` → "Asociado") y el selector de rol de
    `routes/super.users.tsx`;
  - mobile: el equivalente en `lib/roles.ts` y `app/(super)/users.tsx`;
  - ruteo por rol en `dashgo/src/app/index.tsx`.
- **Pool y saldo**: `modules/points/*`, `entities/points-ledger-entry.entity.ts`,
  `orders.service.ts` (crear, entregar y cancelar), `payments.service.ts`
  (`createIntentForItems`).
- **Etiquetas**: factura (web y mobile), detalle de orden, `QuoteDrawer.tsx`,
  `QuoteBottomSheet.tsx`, y el form de productos (`super.products.tsx` y
  `(super)/products.tsx`).

## Lo que queda en manos del builder

- **El modelo de datos**: tablas nuevas o extender `points_ledger_entries`. Lo
  que no es negociable:
  - cada aporte al pool se puede rastrear hasta su orden;
  - cada reparto queda registrado (trimestre, total, cantidad de asociados,
    parte, centavos arrastrados) con unicidad por trimestre;
  - el saldo del asociado es un libro de asientos auditable, no un número suelto
    en `users`.
- La forma de los endpoints nuevos y la hora exacta del cron.
- Qué hacer con `runVestingTick` y con los estados `PENDING`/`EXPIRED` una vez
  que no queden puntos de clientes.
- El diseño visual de las pantallas nuevas, siguiendo el sistema visual que ya
  usan web y mobile. Cuidado con la trampa de contraste: `text-brand` es negro.
- Cómo se comporta un cambio de rol desde vendedor o promotor hacia asociado. La
  limpieza que ya existe para esos roles se mantiene.
- Si una orden ya entregada se cancela con el trimestre abierto, su aporte sale
  del pool. Con el trimestre ya cerrado, no se toca el reparto hecho.
