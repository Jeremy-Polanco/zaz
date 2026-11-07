# Pool de puntos para asociados — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Los puntos de todas las compras dejan de ir al cliente y alimentan un pool trimestral. El pool se reparte en partes iguales entre los usuarios con rol `associate`, que lo gastan como saldo en el checkout.

**Architecture:** Un módulo nuevo `dashgo-api/src/modules/pool` reemplaza a `modules/points`. Tiene tres tablas:
- `pool_contributions`: aportes al pool, rastreables a la orden;
- `pool_distributions`: un reparto por trimestre, con unicidad en la base;
- `associate_balance_entries`: libro de saldo del asociado, con montos firmados.

El reparto es un cron diario más una corrida al arrancar, ambos idempotentes. El checkout conserva el campo `usePoints` y la columna `orders.points_redeemed` para no romper la app mobile vieja; solo cambia de dónde sale el saldo. Web y mobile quitan toda superficie de puntos del cliente, suman la pantalla del pool para asociados y admin, y el rol "Asociado" en la gestión de usuarios.

**Tech Stack:** NestJS 11 + TypeORM + Postgres (`@nestjs/schedule`), React + TanStack Router + Vitest (web), Expo Router + Jest + i18next (mobile).

**Spec:** `docs/superpowers/specs/2026-11-06-pool-puntos-asociados-design.md`. Leelo antes de empezar: este plan argumenta desde ahí.

## Global Constraints

- Valor del rol: `associate`. Etiqueta en la UI: `Asociado`.
- Trimestres de calendario en `America/New_York`. La clave tiene formato `YYYY-Qn` (ej. `2026-Q4`). Los cierres son el 1 de enero, 1 de abril, 1 de julio y 1 de octubre.
- Reparto: `share = floor(total / n)`. `remainder = total − share × n` va al pool del trimestre siguiente. Con `n = 0`, el total entero va al siguiente. Nunca se insertan asignaciones de 0.
- El saldo del asociado **no vence nunca**. El canje consume **exactamente** lo aplicado y el resto queda.
- El descuento sale del subtotal, no del envío. El impuesto se calcula sobre lo que queda, reusando la matemática actual de `pointsRedeemed` (`computeTaxableBase`, `lib/tax.ts`).
- Copy fijo:
  - `Usar mi saldo de asociado`
  - `Saldo de asociado`
  - `Saldo aplicado`
  - `Aporte al pool de asociados (%)`
  - `Pool de asociados`
  - `Asociado`
- Plata en centavos enteros. Se convierte a `numeric` solo en el borde de persistencia.
- Enums de Postgres: baile de renombrar el tipo, como en `1801000000000-AddSellerRole.ts`. **Nunca `ALTER TYPE ... ADD VALUE`.**
- Compatibilidad con la app mobile vieja:
  - `GET /points/balance` y `GET /points/history` responden 200 a cualquier usuario logueado;
  - el campo `usePoints` del DTO de orden y del intent **no se renombra**.
- api:
  - **no correr `npm run lint`**: hace `eslint --fix` y reformatea más de 100 archivos;
  - se verifica con `npm test`, `npm run test:integration` y `npm run build`;
  - el código con fechas se prueba con `TZ=UTC`;
  - cada spec de integración mockea `stripe` y limpia sus filas en `afterAll`.
- web: se verifica con `npm test` y `npm run build`, no con `tsc --noEmit`. Si se agrega o borra una ruta, `src/routeTree.gen.ts` se regenera (lo hace el build de vite) y se commitea.
- mobile:
  - el copy de pantallas de cliente va en `src/i18n/locales/es` **y** `en`, y los tests afirman el español;
  - las pantallas `(super)` usan texto en español hardcodeado, como sus hermanas.
- Modo TDD estricto: ningún código de producción sin un test que falle primero.

## Review Focus

1. **Dos instancias del api arrancan juntas** (deploy solapado en DO) y las dos corren el reparto. Tiene que quedar exactamente un reparto. Test en la Task 6.
2. **El asociado confirma dos pedidos en paralelo** usando el saldo (doble tap, o web y mobile a la vez). El segundo no puede dejar el saldo en negativo. Test en la Task 4.
3. **Una orden entregada a las 23:59 del 31 de diciembre** (hora de NY) cuenta para Q4 aunque el servidor esté en UTC (ya es 1 de enero). A las 00:01 cuenta para Q1. Tests en las Tasks 1 y 5.
4. **Un cliente con la app vieja manda `usePoints: true`**. El pedido sale normal con descuento 0. Tests en las Tasks 7 y 9.
5. **Al asociado le sacan el rol justo antes del cierre**. No entra en el reparto, pero conserva su saldo y sigue viendo el toggle en el checkout. Tests en las Tasks 6 y 9.

---

## Setup (antes de la Task 1)

El checkout actual (`fix/mantenimiento-no-reaparece`) tiene trabajo ajeno sin commitear. Se trabaja en un worktree aparte, con su propio índice de CodeGraph:

```bash
cd /Users/jeremypolanco/Documents/work/Colmapp
git fetch origin
git worktree add -b feat/pool-puntos-asociados ../Colmapp-worktrees/pool-asociados origin/main
mkdir -p ../Colmapp-worktrees/pool-asociados/docs/superpowers/{specs,plans}
cp docs/superpowers/specs/2026-11-06-pool-puntos-asociados-design.md ../Colmapp-worktrees/pool-asociados/docs/superpowers/specs/
cp docs/superpowers/plans/2026-11-06-pool-puntos-asociados.md ../Colmapp-worktrees/pool-asociados/docs/superpowers/plans/
cd ../Colmapp-worktrees/pool-asociados
(cd dashgo-api && npm ci) && (cd dashgo-web && npm ci) && (cd dashgo && npm ci)
gentle-ai codegraph init --cwd "$(pwd)"
git add docs && git commit -m "docs: diseño y plan del pool de puntos para asociados"
```

La migración nueva es la `1814000000000`. La `1813` está en la rama del fix de mantenimiento, que todavía no está en `main`.

---

### Task 1: Helpers de trimestre

**Files:**
- Create: `dashgo-api/src/modules/pool/quarter.ts`
- Test: `dashgo-api/src/modules/pool/quarter.spec.ts`

**Interfaces:**
- Produces:
  - `quarterOf(date: Date): string` devuelve `'YYYY-Qn'` en hora de NY;
  - `nextQuarter(quarter: string): string`;
  - `quarterStart(quarter: string): Date` devuelve el instante en que arranca ese trimestre en NY;
  - `nextDistributionAt(now: Date): Date`, equivalente a `quarterStart(nextQuarter(quarterOf(now)))`.
  - Las claves `'YYYY-Qn'` se comparan bien como strings.

- [ ] **Step 1: Escribir el test que falla**

```ts
describe('quarter helpers', () => {
  it('usa la hora de NY, no la del servidor', () => {
    expect(quarterOf(new Date('2027-01-01T04:59:00Z'))).toBe('2026-Q4'); // 23:59 NY
    expect(quarterOf(new Date('2027-01-01T05:00:00Z'))).toBe('2027-Q1'); // 00:00 NY
    expect(quarterOf(new Date('2026-07-01T03:59:00Z'))).toBe('2026-Q2'); // EDT
    expect(quarterOf(new Date('2026-07-01T04:00:00Z'))).toBe('2026-Q3');
  });
  it('avanza de trimestre y de año', () => {
    expect(nextQuarter('2026-Q4')).toBe('2027-Q1');
    expect(nextQuarter('2027-Q1')).toBe('2027-Q2');
  });
  it('calcula el inicio del trimestre con el offset correcto (EST/EDT)', () => {
    expect(quarterStart('2027-Q1').toISOString()).toBe('2027-01-01T05:00:00.000Z');
    expect(quarterStart('2027-Q2').toISOString()).toBe('2027-04-01T04:00:00.000Z');
    expect(nextDistributionAt(new Date('2026-11-06T15:00:00Z')).toISOString())
      .toBe('2027-01-01T05:00:00.000Z');
  });
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `cd dashgo-api && TZ=UTC npx jest --selectProjects unit src/modules/pool/quarter.spec.ts`
Expected: FAIL (`Cannot find module './quarter'`).

- [ ] **Step 3: Implementar `quarter.ts`**

Usar `Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: 'numeric' })` para el año y el mes en NY. `quarterStart` resuelve el offset de NY de ese día (`timeZoneName: 'shortOffset'`) en lugar de hardcodear −5. `process.env.TZ` no tiene efecto dentro de Jest.

- [ ] **Step 4: Correr y ver que pasa**

Run: `cd dashgo-api && TZ=UTC npx jest --selectProjects unit src/modules/pool/quarter.spec.ts && npx jest --selectProjects unit src/modules/pool/quarter.spec.ts`
Expected: PASS en las dos corridas (UTC y la zona de la Mac).

- [ ] **Step 5: Commit**

```bash
git add dashgo-api/src/modules/pool/quarter.ts dashgo-api/src/modules/pool/quarter.spec.ts
git commit -m "feat(pool): helpers de trimestre en hora de Nueva York"
```

---

### Task 2: Rol `associate`, tablas del pool y migración de los puntos existentes

**Files:**
- Modify: `dashgo-api/src/entities/enums.ts` (agregar `ASSOCIATE = 'associate'` a `UserRole`)
- Modify: `dashgo-api/src/entities/points-ledger-entry.entity.ts` (agregar `POOLED = 'pooled'` a `PointsEntryStatus`)
- Create: `dashgo-api/src/entities/pool-contribution.entity.ts`
- Create: `dashgo-api/src/entities/pool-distribution.entity.ts`
- Create: `dashgo-api/src/entities/associate-balance-entry.entity.ts`
- Modify: `dashgo-api/src/entities/index.ts`, `src/config/database.config.ts`, `src/database/data-source.ts`, `src/test-utils/db.ts` (registrar las 3 entidades nuevas)
- Create: `dashgo-api/src/database/migrations/1814000000000-AssociatePointsPool.ts`
- Test: `dashgo-api/test/integration/associate-pool-migration.integration-spec.ts`

**Interfaces:**
- Produces (entidades):
  - `PoolContribution` (tabla `pool_contributions`):
    - campos: `id uuid`, `quarter varchar(7)`, `amountCents int` (> 0), `source varchar(20)`, `orderId uuid|null` (FK `orders`, ON DELETE SET NULL), `sourceUserId uuid|null` (FK `users`, **ON DELETE SET NULL**), `legacyPointsEntryId uuid|null` (sin FK), `createdAt`;
    - `source` toma valores de `PoolContributionSource`: `ORDER='order'`, `LEGACY_MIGRATION='legacy_migration'`, `LEGACY_REVERSAL='legacy_reversal'`, `CARRYOVER='carryover'`;
    - índices: sobre `quarter`, y UNIQUE parcial sobre `order_id` `WHERE source = 'order'`.
  - `PoolDistribution` (tabla `pool_distributions`): `id`, `quarter varchar(7)` **UNIQUE**, `totalCents`, `associateCount`, `shareCents`, `remainderCents` (todos `int`), `createdAt`.
  - `AssociateBalanceEntry` (tabla `associate_balance_entries`):
    - campos: `id`, `userId` (FK `users`, ON DELETE CASCADE), `type varchar(20)`, `amountCents int` firmado, `distributionId uuid|null` (FK `pool_distributions`), `orderId uuid|null` (FK `orders`, ON DELETE SET NULL), `createdAt`;
    - `type` toma valores de `AssociateBalanceEntryType`: `ALLOCATION='allocation'` (+), `REDEMPTION='redemption'` (−), `REVERSAL='reversal'` (+);
    - UNIQUE parciales: `(distribution_id, user_id) WHERE type='allocation'`, `(order_id) WHERE type='redemption'` y `(order_id) WHERE type='reversal'`.
- Produces (migración): `export async function moveLegacyPointsToPool(runner: { query: (sql: string, params?: unknown[]) => Promise<unknown> }): Promise<void>`, exportada desde el archivo de la migración y llamada en `up()`.

- [ ] **Step 1: Escribir el test que falla**

Insertar entradas en `points_ledger_entries` para un usuario de prueba: EARNED/PENDING 100, EARNED/CLAIMABLE 250, EARNED/CLAIMABLE 70 con `expires_at` vencido, EARNED/REDEEMED 30 y EXPIRED −40. Después, con `dataSource.createQueryRunner()`:

```ts
await moveLegacyPointsToPool(runner);
const rows = await ds.query(
  `SELECT amount_cents, source, source_user_id, legacy_points_entry_id, quarter
     FROM pool_contributions WHERE source_user_id = $1 ORDER BY amount_cents`, [user.id]);
expect(rows.map((r) => r.amount_cents)).toEqual([100, 250]);           // ni vencidos ni canjeados
expect(rows.every((r) => r.source === 'legacy_migration')).toBe(true);
expect(rows[0].quarter).toBe(quarterOf(new Date()));
const statuses = await ds.query(
  `SELECT amount_cents, status FROM points_ledger_entries WHERE user_id = $1 ORDER BY amount_cents`, [user.id]);
// 100 y 250 → 'pooled'; 70 (vencido), 30 (redeemed) y −40 quedan como estaban
await moveLegacyPointsToPool(runner);                                    // idempotente
expect((await ds.query(`SELECT 1 FROM pool_contributions WHERE source_user_id = $1`, [user.id])).length).toBe(2);
```

También probar que `UPDATE users SET role = 'associate'` funciona: el enum tiene que tener el valor nuevo.

- [ ] **Step 2: Correr y ver que falla**

Run: `cd dashgo-api && npx jest --selectProjects integration --runInBand test/integration/associate-pool-migration.integration-spec.ts`
Expected: FAIL (no existe `moveLegacyPointsToPool` ni la tabla).

- [ ] **Step 3: Implementar las entidades y la migración**

`up()` hace, en este orden:
1. El baile de `users_role_enum` agregando `'associate'`.
2. El baile de `points_ledger_entries_status_enum` agregando `'pooled'`.
3. `CREATE TABLE` de las 3 tablas, con sus índices y FKs.
4. `moveLegacyPointsToPool`, que a su vez:
   - hace un `INSERT … SELECT` de las EARNED con estado `pending`/`claimable` y `(expires_at IS NULL OR expires_at > now())`;
   - usa como trimestre `to_char(now() AT TIME ZONE 'America/New_York', 'YYYY-"Q"Q')`;
   - después hace el `UPDATE … SET status='pooled'` con el mismo filtro. Así, una segunda corrida no encuentra nada.

`down()` hace lo inverso:
1. Restaura `pending` o `claimable` (según `claimable_at <= now()`) en las filas que aparecen en `legacy_points_entry_id` de los aportes `legacy_migration`.
2. Pasa a `client` los usuarios con rol `associate`.
3. Dropea las tablas y deshace los dos bailes.

- [ ] **Step 4: Correr y ver que pasa**

Run: el mismo comando del Step 2, dos veces seguidas.
Expected: PASS las dos veces (el spec limpia sus filas en `afterAll`).

- [ ] **Step 5: Commit**

```bash
git add dashgo-api/src/entities dashgo-api/src/config/database.config.ts dashgo-api/src/database dashgo-api/src/test-utils/db.ts dashgo-api/test/integration/associate-pool-migration.integration-spec.ts
git commit -m "feat(pool): rol asociado, tablas del pool y migración de los puntos sin usar"
```

---

### Task 3: El asociado compra como un cliente

**Files:**
- Create: `dashgo-api/src/common/roles.ts`
- Test: `dashgo-api/src/common/roles.spec.ts`
- Modify: `dashgo-api/src/modules/orders/orders.service.ts` (líneas ~282, ~304, ~665, ~2152; SQL crudo ~951 y ~968)
- Modify: `dashgo-api/src/modules/orders/win-back.cron.ts:56`, `dashgo-api/src/modules/notifications/birthday.cron.ts:57,119`
- Test: `dashgo-api/src/modules/orders/orders.service.spec.ts`, `dashgo-api/src/modules/users/users.service.spec.ts`

**Interfaces:**
- Produces: `buysAsClient(role: UserRole): boolean`, que es `true` para `CLIENT` y `ASSOCIATE`.

- [ ] **Step 1: Escribir los tests que fallan**

- `roles.spec.ts`: `buysAsClient(UserRole.ASSOCIATE)` y `buysAsClient(UserRole.CLIENT)` son `true`. `PROMOTER`, `SELLER` y `SUPER_ADMIN_DELIVERY` son `false`.
- `orders.service.spec.ts`:
  - `create` con un usuario `role: UserRole.ASSOCIATE` **no** tira `ForbiddenException`;
  - con un pedido activo previo tira el mismo error de "un pedido activo a la vez" que a un cliente;
  - `useCredit: true` aplica el fiado igual que a un cliente;
  - un asociado puede cancelar su pedido en `PENDING_QUOTE`.
- `users.service.spec.ts`: el super admin cambia el rol de un cliente a `UserRole.ASSOCIATE` y queda guardado.

- [ ] **Step 2: Correr y ver que falla**

Run: `cd dashgo-api && npx jest --selectProjects unit src/common/roles.spec.ts src/modules/orders/orders.service.spec.ts src/modules/users/users.service.spec.ts`
Expected: FAIL en los casos nuevos (`Solo clientes pueden crear pedidos`).

- [ ] **Step 3: Implementar**

Reemplazar cada chequeo `=== UserRole.CLIENT` de las líneas listadas por `buysAsClient(user.role)`. En ~282 y ~2152 el chequeo queda como `buysAsClient(role) || role === PROMOTER`. En el SQL crudo, `u.role = 'client'` y `role = 'client'` pasan a `IN ('client', 'associate')`, manteniendo cada condición en una sola línea. `users.service` no requiere cambios si el test ya pasa con el enum nuevo.

- [ ] **Step 4: Verificar**

Run: `cd dashgo-api && npx jest --selectProjects unit src/common src/modules/orders src/modules/users && grep -rn "role = 'client'" src --include='*.ts' | grep -v migrations`
Expected: PASS, y el `grep` no imprime nada.

- [ ] **Step 5: Commit**

```bash
git add dashgo-api/src/common/roles.ts dashgo-api/src/common/roles.spec.ts dashgo-api/src/modules
git commit -m "feat(roles): el asociado compra con las mismas reglas que un cliente"
```

---

### Task 4: Libro de saldo del asociado

**Files:**
- Create: `dashgo-api/src/modules/pool/associate-balance.service.ts`
- Create: `dashgo-api/src/modules/pool/pool.module.ts`. Registra las entidades nuevas más `PointsLedgerEntry`, `Order`, `OrderItem` y `User`, y exporta los servicios.
- Test: `dashgo-api/test/integration/associate-balance.integration-spec.ts`

**Interfaces:**
- Produces (`AssociateBalanceService`):
  - `getBalanceCents(userId: string, mgr?: EntityManager): Promise<number>`: la suma de `amount_cents`;
  - `getHistory(userId: string): Promise<AssociateBalanceEntry[]>`: en orden descendente, con la relación `distribution` cargada (para el trimestre);
  - `redeem(userId: string, orderId: string, amountCents: number, tx: EntityManager): Promise<void>`:
    - con `amountCents <= 0` no hace nada;
    - bloquea la fila del usuario (`SELECT id FROM users WHERE id = $1 FOR UPDATE`) y recalcula el saldo dentro del lock;
    - si no alcanza, tira `BadRequestException({ code: 'INSUFFICIENT_BALANCE', message: 'Tu saldo de asociado no alcanza para este pedido' })`;
    - inserta una `REDEMPTION` de `−amountCents`;
  - `reverseForOrder(orderId: string, tx: EntityManager): Promise<number>`:
    - si hay una `REDEMPTION` para la orden y todavía no hay `REVERSAL`, inserta la `REVERSAL` (+) y devuelve el monto;
    - si no, devuelve 0.

- [ ] **Step 1: Escribir los tests que fallan** (asociado de prueba con una `ALLOCATION` de 1000)

```ts
it('el canje consume solo lo aplicado y el resto queda', async () => {
  await ds.transaction((tx) => svc.redeem(assoc.id, orderA.id, 300, tx));
  expect(await svc.getBalanceCents(assoc.id)).toBe(700);
});
it('no deja canjear más que el saldo', async () => {
  await expect(ds.transaction((tx) => svc.redeem(assoc.id, orderB.id, 701, tx)))
    .rejects.toMatchObject({ response: { code: 'INSUFFICIENT_BALANCE' } });
});
it('dos canjes en paralelo no dejan el saldo negativo', async () => {   // Review Focus 2
  const results = await Promise.allSettled([
    ds.transaction((tx) => svc.redeem(assoc.id, orderC.id, 500, tx)),
    ds.transaction((tx) => svc.redeem(assoc.id, orderD.id, 500, tx)),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(await svc.getBalanceCents(assoc.id)).toBe(200);
});
it('revertir devuelve el saldo una sola vez', async () => {
  await ds.transaction((tx) => svc.reverseForOrder(orderA.id, tx));
  await ds.transaction((tx) => svc.reverseForOrder(orderA.id, tx));
  expect(await svc.getBalanceCents(assoc.id)).toBe(500);
});
it('borrar al asociado borra su libro', async () => { /* DELETE user → 0 filas para su user_id */ });
```

- [ ] **Step 2: Correr y ver que falla**

Run: `cd dashgo-api && npx jest --selectProjects integration --runInBand test/integration/associate-balance.integration-spec.ts`
Expected: FAIL (no existe el servicio).

- [ ] **Step 3: Implementar `AssociateBalanceService` y `PoolModule`** con las firmas de arriba.

- [ ] **Step 4: Correr y ver que pasa**, dos veces seguidas.

- [ ] **Step 5: Commit**

```bash
git add dashgo-api/src/modules/pool dashgo-api/test/integration/associate-balance.integration-spec.ts
git commit -m "feat(pool): libro de saldo del asociado con canje parcial y a prueba de carreras"
```

---

### Task 5: Aportes al pool en la entrega y reverso de los canjes viejos

**Files:**
- Create: `dashgo-api/src/modules/pool/pool.service.ts`
- Modify: `dashgo-api/src/modules/orders/orders.service.ts`:
  - en la entrega (~2043) cambiar `points.creditForOrder` por `pool.contributeForOrder`;
  - en `cancelOrderWithReversals` (~1815) cambiar `points.reverseRedemptionForOrder` por `associateBalance.reverseForOrder` **y** `pool.reverseLegacyRedemption`.
- Modify: `dashgo-api/src/modules/orders/orders.module.ts` (importar `PoolModule`)
- Test: `dashgo-api/test/integration/pool-contributions.integration-spec.ts`
- Modify: `dashgo-api/test/integration/cancel-reversal.integration-spec.ts` (el caso de puntos ahora espera `pooled` y un aporte `legacy_reversal`)

**Interfaces:**
- Consumes: `quarterOf` (Task 1), `AssociateBalanceService.reverseForOrder` (Task 4).
- Produces (`PoolService`):
  - `contributeForOrder(orderId: string, tx: EntityManager, now?: Date): Promise<number>`:
    - inserta una sola fila `ORDER` con la suma de `round(priceAtOrder×100 × qty × pointsPct / 100)` por línea, que es la regla de hoy;
    - el trimestre es `quarterOf(now ?? new Date())`;
    - con total 0 no inserta nada;
    - es idempotente por orden;
  - `reverseLegacyRedemption(orderId: string, tx: EntityManager): Promise<number>`:
    - las EARNED/REDEEMED de esa orden pasan a `POOLED`;
    - se borra la entrada negativa `REDEEMED`;
    - se inserta un aporte `LEGACY_REVERSAL` por el total (`sourceUserId` = el cliente, trimestre actual);
    - devuelve el total;
  - `getPoolCents(quarter: string, mgr?: EntityManager): Promise<number>`.

- [ ] **Step 1: Escribir los tests que fallan**

- Una orden con una línea de $20.00 × 1 y `pointsPct` 10, entregada vía `OrdersService`, deja 200 en `getPoolCents(quarterOf(new Date()))`. Volver a llamar `contributeForOrder` no duplica.
- `contributeForOrder(order.id, tx, new Date('2027-01-01T04:59:00Z'))` aporta a `'2026-Q4'`, y con `'2027-01-01T05:01:00Z'` aporta a `'2027-Q1'`. (Review Focus 3.)
- Borrar al cliente con `AuthService.deleteAccount` deja el aporte intacto con `source_user_id = null`, y el pool sigue en 200.
- Un pedido viejo que había canjeado 250 en puntos (fixtures de `points_ledger_entries`), al cancelarse:
  - deja esas EARNED en `pooled`;
  - borra la entrada negativa;
  - deja un aporte `legacy_reversal` de 250.
- Un pedido de asociado que usó saldo, al cancelarse, devuelve el saldo (vía `reverseForOrder`).

- [ ] **Step 2: Correr y ver que falla**

Run: `cd dashgo-api && npx jest --selectProjects integration --runInBand test/integration/pool-contributions.integration-spec.ts test/integration/cancel-reversal.integration-spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar `PoolService` y cablear `OrdersService`** (inyectar `PoolService` y `AssociateBalanceService`).

- [ ] **Step 4: Correr y ver que pasa** (dos veces), y además correr `npx jest --selectProjects unit src/modules/orders`.

- [ ] **Step 5: Commit**

```bash
git add dashgo-api/src/modules dashgo-api/test/integration
git commit -m "feat(pool): las órdenes entregadas aportan al pool del trimestre"
```

---

### Task 6: Reparto trimestral

**Files:**
- Modify: `dashgo-api/src/modules/pool/pool.service.ts`
- Create: `dashgo-api/src/modules/pool/pool.cron.ts`
- Test: `dashgo-api/test/integration/pool-distribution.integration-spec.ts`

**Interfaces:**
- Produces (`PoolService`):
  - `distributeQuarter(quarter: string): Promise<PoolDistribution | null>`:
    - corre en una transacción;
    - total = `getPoolCents(quarter)`; asociados = usuarios con `role = 'associate'` en ese momento;
    - inserta el `PoolDistribution`, después una `ALLOCATION` de `shareCents` por asociado (si `shareCents > 0`), y un aporte `CARRYOVER` de `remainderCents` en `nextQuarter(quarter)` (si es > 0);
    - si el trimestre ya tiene reparto (por la unicidad de `quarter`, incluida una violación concurrente), devuelve `null` sin tirar error.
  - `distributeDueQuarters(now?: Date): Promise<string[]>`:
    - en un loop: busca el trimestre **más viejo** con aportes, `< quarterOf(now)` y sin reparto; lo reparte; repite;
    - de esta forma el arrastre de Q3 entra en Q4 antes de que se reparta Q4;
    - devuelve los trimestres repartidos.
  - `listDistributions(): Promise<PoolDistribution[]>`: en orden descendente por trimestre.
- Produces (`PoolCron`):
  - `@Cron('10 0 * * *', { timeZone: 'America/New_York' })`, que llama a `distributeDueQuarters()`;
  - `onApplicationBootstrap` con `setTimeout(…, 20_000)` y `unref()`, igual que `subscription-reconcile.cron.ts`;
  - los errores se loguean, nunca se propagan.

Los tests usan trimestres de 1999 y `now` explícito para no chocar con datos de otros specs.

- [ ] **Step 1: Escribir los tests que fallan**

```ts
it('reparte en partes iguales y arrastra los centavos', async () => {
  // 3 asociados de prueba; aportes 10001 en '1999-Q3'
  const d = await pool.distributeQuarter('1999-Q3');
  expect(d).toMatchObject({ totalCents: 10001, associateCount: 3, shareCents: 3333, remainderCents: 2 });
  for (const a of associates) expect(await balance.getBalanceCents(a.id)).toBe(3333);
  expect(await pool.getPoolCents('1999-Q4')).toBe(2);
});
it('un cliente, un vendedor y un ex-asociado no cobran', async () => { /* balance 0 para ellos; el ex-asociado conserva lo previo */ }); // Review Focus 5
it('menos centavos que asociados: no hay asignaciones de 0, todo se arrastra', async () => { /* total 2, 3 asociados → share 0, ALLOCATION ausentes, carryover 2 */ });
it('sin asociados el pool entero pasa al trimestre siguiente', async () => { /* associateCount 0, remainder = total */ });
it('es un único reparto aunque corra dos veces a la vez', async () => {  // Review Focus 1
  const [a, b] = await Promise.all([pool.distributeQuarter('1998-Q1'), pool.distributeQuarter('1998-Q1')]);
  expect([a, b].filter(Boolean)).toHaveLength(1);
  // las asignaciones de 1998-Q1 existen una sola vez por asociado
});
it('recupera trimestres atrasados en orden e incluye el arrastre', async () => {
  // aportes en 1997-Q3 (10001) y 1997-Q4 (500); 3 asociados
  expect(await pool.distributeDueQuarters(quarterStart('1998-Q1'))).toEqual(['1997-Q3', '1997-Q4']);
  // 1997-Q4 repartió 502 → share 167, remainder 1 → 1998-Q1
});
it('no reparte el trimestre en curso', async () => { /* aportes en quarterOf(now) → distributeDueQuarters(now) no lo incluye */ });
```

- [ ] **Step 2: Correr y ver que falla**

Run: `cd dashgo-api && TZ=UTC npx jest --selectProjects integration --runInBand test/integration/pool-distribution.integration-spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar `distributeQuarter`, `distributeDueQuarters`, `listDistributions` y `PoolCron`**, y registrar `PoolCron` en `PoolModule`.

- [ ] **Step 4: Correr y ver que pasa** (dos veces, con `TZ=UTC`).

- [ ] **Step 5: Commit**

```bash
git add dashgo-api/src/modules/pool dashgo-api/test/integration/pool-distribution.integration-spec.ts
git commit -m "feat(pool): reparto trimestral en partes iguales, idempotente y con recuperación"
```

---

### Task 7: El checkout gasta saldo de asociado; adiós `PointsService`

**Files:**
- Modify: `dashgo-api/src/modules/orders/orders.service.ts`. En `create` (~654-660 y ~840), con `usePoints`, el saldo sale de `associateBalance.getBalanceCents(user.id)`. El canje pasa a `associateBalance.redeem(user.id, persisted.id, pointsRedeemedCents, tx)`.
- Modify: `dashgo-api/src/modules/payments/payments.service.ts` (~157-163) y `payments.module.ts`, que importa `PoolModule`.
- Create: `dashgo-api/src/modules/pool/legacy-points.controller.ts`, que se registra en `PoolModule`.
- Delete: `dashgo-api/src/modules/points/` (los 3 archivos). Sacar `PointsModule` de `app.module.ts` y de cualquier otro `imports`.
- Modify: `dashgo-api/src/database/seed.ts`: truncar las 3 tablas nuevas y dejar de sembrar puntos al cliente demo.
- Modify: `dashgo-api/src/modules/orders/orders.service.spec.ts`, `src/modules/payments/payments.service.spec.ts`: reemplazar los mocks de `PointsService`.
- Test: `dashgo-api/test/integration/associate-checkout.integration-spec.ts`

**Interfaces:**
- Consumes: `AssociateBalanceService.getBalanceCents` y `.redeem` (Task 4).
- Produces (compatibilidad con la app vieja):
  - `GET /points/balance` devuelve `{ pendingCents: 0, claimableCents: <saldo>, redeemedCents: 0, expiredCents: 0 }`;
  - `GET /points/history` devuelve `[]`;
  - los dos solo con `JwtAuthGuard`.

- [ ] **Step 1: Escribir los tests que fallan**

- `orders.service.spec.ts`:
  - `usePoints: true` con saldo 1000 y subtotal 600 da `pointsRedeemed === '6.00'` y `redeem` se llama con `600`;
  - con saldo 0, `pointsRedeemed === '0.00'` y `redeem` no se llama. (Review Focus 4.)
- `payments.service.spec.ts`: con saldo 1000 y subtotal 600, el `amount` del intent descuenta 600.
- Integration:
  - un asociado con `ALLOCATION` 1000 crea una orden de subtotal $6.00 con `usePoints` y después tiene **400** (regresión del bug que quemaba el sobrante);
  - con supertest y token, igual que en `account-deletion.integration-spec.ts`: `GET /points/balance` a un cliente responde 200 con todo en 0; al asociado le devuelve `claimableCents: 400`; `GET /points/history` responde 200 con `[]`.

- [ ] **Step 2: Correr y ver que falla**

Run: `cd dashgo-api && npx jest --selectProjects unit src/modules/orders src/modules/payments && npx jest --selectProjects integration --runInBand test/integration/associate-checkout.integration-spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar.** Borrar `modules/points` y seguir los errores de `npm run build` hasta que no quede ninguna referencia a `PointsService`.

- [ ] **Step 4: Verificar**

Run: `cd dashgo-api && npm test && npm run build && grep -rn "PointsService\|creditForOrder\|redeemAllClaimable" src test`
Expected: PASS, build limpio y el `grep` sin resultados.

- [ ] **Step 5: Commit**

```bash
git add -A dashgo-api
git commit -m "feat(pool): el checkout gasta saldo de asociado y deja el resto; se retira PointsService"
```

---

### Task 8: API del pool

**Files:**
- Create: `dashgo-api/src/modules/pool/pool.controller.ts`
- Modify: `dashgo-api/src/modules/pool/pool.service.ts` (`getSummary`)
- Test: `dashgo-api/test/integration/pool-api.integration-spec.ts`

**Interfaces:**
- Produces:
  - `PoolService.getSummary(now?: Date): Promise<PoolSummary>`, donde `PoolSummary = { quarter: string; poolCents: number; nextDistributionAt: string /* ISO */; associateCount: number; estimatedShareCents: number /* floor(pool / n), 0 si n = 0 */ }`.
  - `GET /pool/summary`, con `@Roles(UserRole.ASSOCIATE, UserRole.SUPER_ADMIN_DELIVERY)`, devuelve un `PoolSummary`.
  - `GET /pool/me`, solo con `JwtAuthGuard`, devuelve `{ balanceCents: number; entries: { id: string; type: 'allocation' | 'redemption' | 'reversal'; amountCents: number; orderId: string | null; quarter: string | null; createdAt: string }[] }`.
  - `GET /pool/distributions`, con `@Roles(UserRole.SUPER_ADMIN_DELIVERY)`, devuelve `{ id; quarter; totalCents; associateCount; shareCents; remainderCents; createdAt }[]`.

- [ ] **Step 1: Escribir los tests que fallan** (supertest + token)

- `GET /pool/summary` como asociado: 200 y `res.body.nextDistributionAt` igual a la función `nextDistributionAt(new Date()).toISOString()` de la Task 1. Como cliente: 403.
- `GET /pool/me` como cliente: 200 con `{ balanceCents: 0, entries: [] }`. Como asociado con una asignación de 1999-Q3: la entrada trae `quarter: '1999-Q3'`.
- `GET /pool/distributions` como asociado: 403. Como super admin: 200 con la lista.

- [ ] **Step 2: Correr y ver que falla**

Run: `cd dashgo-api && npx jest --selectProjects integration --runInBand test/integration/pool-api.integration-spec.ts`
Expected: FAIL (404).

- [ ] **Step 3: Implementar** el controller con `@UseGuards(JwtAuthGuard, RolesGuard)`, igual que `sellers.controller.ts`. Las respuestas se mapean a objetos planos, nunca entidades crudas.

- [ ] **Step 4: Correr y ver que pasa**, y además `npm run build`.

- [ ] **Step 5: Commit**

```bash
git add dashgo-api/src/modules/pool dashgo-api/test/integration/pool-api.integration-spec.ts
git commit -m "feat(pool): endpoints de resumen, saldo propio y repartos"
```

---

### Task 9: Web — el cliente deja de ver puntos y el checkout usa el saldo de asociado

**Files:**
- Modify: `dashgo-web/src/lib/types.ts`: sumar `'associate'` a `UserRole`; agregar `PoolSummary`, `AssociateBalance` y `PoolDistribution` con las formas de la Task 8; quitar `PointsBalance`.
- Modify: `dashgo-web/src/lib/roles.ts`: agregar `buysAsClient(role)` e `isAssociate(role)`; `roleLabel('associate')` devuelve `'Asociado'`.
- Modify: `dashgo-web/src/lib/queries.ts`: reemplazar `usePointsBalance`/`usePointsHistory` por `useMyAssociateBalance(enabled: boolean)` (`GET /pool/me`), `usePoolSummary(enabled: boolean)` (`GET /pool/summary`) y `usePoolDistributions()` (`GET /pool/distributions`).
- Modify: `dashgo-web/src/routes/checkout.tsx`:
  - la sección de puntos (~574-604) se reemplaza por "Saldo de asociado", que se muestra **solo** si `balanceCents > 0`, con el toggle "Usar mi saldo de asociado";
  - la línea de totales (~723) pasa a "Saldo aplicado";
  - se mantiene el campo `usePoints` del form y del payload;
  - el chequeo de cliente (~150) pasa a `buysAsClient`.
- Modify: `dashgo-web/src/components/CheckoutCreditStep.tsx:31`, `src/routes/__root.tsx:467` y `src/routes/cuenta.tsx:64`: usar `buysAsClient`.
- Modify: `dashgo-web/src/routes/__root.tsx:164-182` y `cuenta.tsx:189`: quitar los links "Mis puntos".
- Delete: `dashgo-web/src/routes/points.tsx`
- Modify: `dashgo-web/src/components/QuoteDrawer.tsx:155`, `src/routes/orders.$orderId.index.tsx` y `src/routes/orders.$orderId.invoice.tsx`: la etiqueta del descuento pasa a "Saldo aplicado".
- Modify: `dashgo-web/src/routes/super.users.tsx:137`: el texto "créditos y puntos" pasa a "créditos y saldo".
- Test: `dashgo-web/src/routes/checkout.test.tsx`, `dashgo-web/src/lib/roles.test.ts`

- [ ] **Step 1: Escribir los tests que fallan**

- `checkout.test.tsx` (mockear `useMyAssociateBalance` en el `vi.mock('../lib/queries')` existente):
  - cliente con `balanceCents: 0`: `queryByText(/puntos/i)` y `queryByText(/saldo de asociado/i)` dan `null`;
  - asociado con `balanceCents: 1500`: aparece "Usar mi saldo de asociado"; al activarlo, aparece "Saldo aplicado" y el payload de `useCreateOrder` lleva `usePoints: true`;
  - **cliente** (ex-asociado) con `balanceCents: 800`: también ve el toggle (Review Focus 5).
- `roles.test.ts`: `buysAsClient('associate')` es `true` y `roleLabel('associate')` es `'Asociado'`.

- [ ] **Step 2: Correr y ver que falla**

Run: `cd dashgo-web && npx vitest run src/routes/checkout.test.tsx src/lib/roles.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar** los cambios de la lista.

- [ ] **Step 4: Verificar**

Run: `cd dashgo-web && npm test && npm run build && grep -rni "puntos" src --include='*.tsx' --include='*.ts' | grep -v "\.test\."`
Expected: PASS y build limpio, con `routeTree.gen.ts` regenerado sin `/points`. El `grep` no encuentra la palabra en ningún texto visible; si queda alguna coincidencia, es un comentario de código.

- [ ] **Step 5: Commit**

```bash
git add -A dashgo-web
git commit -m "feat(web): el cliente ya no ve puntos; el checkout usa el saldo de asociado"
```

---

### Task 10: Web — pantalla del pool, panel del admin y rol Asociado

**Files:**
- Create: `dashgo-web/src/lib/pool.ts`, con `quarterLabel(quarter: string): string` (`'2026-Q4'` → `'4.º trimestre 2026'`) y `formatDistributionDate(iso: string): string` (`Intl.DateTimeFormat('es-US', { timeZone: 'America/New_York', day: 'numeric', month: 'long', year: 'numeric' })`).
- Create: `dashgo-web/src/routes/pool.tsx` (`/pool`):
  - requiere login, con el mismo patrón `beforeLoad` que `seller.earnings.tsx`;
  - si el usuario es asociado: bloque con el pool del trimestre, el próximo reparto, cuántos asociados hay y "Tu parte estimada";
  - siempre: "Tu saldo" y el historial (asignaciones con su trimestre, canjes con su orden).
- Create: `dashgo-web/src/routes/super.pool.tsx` (`/super/pool`): solo super admin. Muestra el resumen y la tabla Trimestre | Total | Asociados | Parte c/u | Arrastre.
- Modify: `dashgo-web/src/routes/__root.tsx`: link "Pool de asociados" (`/pool`) en la nav de cliente, solo si `isAssociate`; link "Pool" (`/super/pool`) en la nav del super admin, no en la del vendedor.
- Modify: `dashgo-web/src/routes/cuenta.tsx`: para asociados, link a `/pool` en lugar del de puntos que se quitó.
- Modify: `dashgo-web/src/routes/super.users.tsx:175`: agregar `{ value: 'associate', label: 'Asociado' }` a `ASSIGNABLE_ROLES`, y la opción en el filtro de rol si la página tiene uno.
- Modify: `dashgo-web/src/routes/super.products.tsx:1263-1278`: el label pasa a "Aporte al pool de asociados (%)"; la ayuda pasa a "Porcentaje del precio efectivo que suma al pool que se reparte entre los asociados cada trimestre."; el hint de ~1134 cambia "qué puntos gana el cliente" por "cuánto aporta al pool de asociados".
- Test: `dashgo-web/src/routes/pool.test.tsx`, `src/routes/super.pool.test.tsx`, `src/routes/super.users.test.tsx`, `src/lib/pool.test.ts`

- [ ] **Step 1: Escribir los tests que fallan**

- `pool.test.ts`: `quarterLabel('2026-Q4') === '4.º trimestre 2026'` y `formatDistributionDate('2027-01-01T05:00:00.000Z') === '1 de enero de 2027'`.
- `pool.test.tsx`:
  - asociado con resumen `{ quarter: '2026-Q4', poolCents: 12345, associateCount: 3, estimatedShareCents: 4115, nextDistributionAt: '2027-01-01T05:00:00.000Z' }` y saldo 500: se ven `$123.45`, `1 de enero de 2027`, `3 asociados`, `$41.15` y `$5.00`;
  - cliente con saldo 800: se ve el saldo y **no** se pide el resumen (`usePoolSummary` llamado con `enabled: false`).
- `super.pool.test.tsx`: una fila con `1999-Q3`, `$100.01`, `3`, `$33.33`, `$0.02`.
- `super.users.test.tsx`: el select de rol ofrece "Asociado" y elegirlo llama a `updateUser.mutate({ id, role: 'associate' })`.

- [ ] **Step 2: Correr y ver que falla**

Run: `cd dashgo-web && npx vitest run src/routes/pool.test.tsx src/routes/super.pool.test.tsx src/routes/super.users.test.tsx src/lib/pool.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar.** Seguir el sistema visual existente (`SectionHeading`, `formatCents`, tokens `ink`/`paper`/`accent`). `text-brand` es negro: nunca va sobre fondos oscuros.

- [ ] **Step 4: Verificar**

Run: `cd dashgo-web && npm test && npm run build`
Expected: PASS y build limpio, con `routeTree.gen.ts` incluyendo `/pool` y `/super/pool`.

- [ ] **Step 5: Commit**

```bash
git add -A dashgo-web
git commit -m "feat(web): pantalla del pool para asociados, panel de repartos y rol Asociado"
```

---

### Task 11: Mobile — el cliente deja de ver puntos y el checkout usa el saldo de asociado

**Files:**
- Modify: `dashgo/src/lib/types.ts`, `src/lib/roles.ts` y `src/lib/queries.ts`: los mismos cambios y nombres que la Task 9.
- Modify: `dashgo/src/app/checkout.tsx`:
  - el bloque de puntos (~755-800) pasa a usar `useMyAssociateBalance` y se muestra solo si `balanceCents > 0`;
  - la línea de totales (~831) cambia;
  - el chequeo de cliente (~165) pasa a `buysAsClient`;
  - se mantiene `usePoints` en el payload.
- Modify (i18n, `es` y `en`):
  - `checkout.ts`: `points` pasa a `associateBalance: { title: 'Saldo de asociado' | 'Associate balance', use: 'Usar mi saldo de asociado' | 'Use my associate balance', available: 'Disponible: {{amount}}' | 'Available: {{amount}}' }`, y `totals.pointsDiscount` pasa a `totals.balanceApplied: 'Saldo aplicado' | 'Balance applied'`;
  - `orders.ts`: la clave del descuento pasa a `balanceApplied` con los mismos valores;
  - `nav.ts` y `profile.ts`: se borran las claves `points`.
- Modify: `dashgo/src/app/(tabs)/_layout.tsx`:
  - sacar el ítem `more.points` (~27) y el `Tabs.Screen name="points"` (~104);
  - el chequeo de cliente (~43) pasa a `buysAsClient`.
- Modify: `dashgo/src/app/(tabs)/profile.tsx`: sacar el link de puntos (~266) y cambiar el chequeo de cliente (~160) por `buysAsClient`.
- Delete: `dashgo/src/app/(tabs)/points.tsx`, `src/app/(promoter)/points.tsx`, `src/i18n/locales/{es,en}/points.ts` y su registro en los dos `index.ts`.
- Modify: `dashgo/src/app/(promoter)/_layout.tsx`:
  - sacar el ítem "Puntos" (~24) y el `Tabs.Screen` (~93);
  - en ~41, la redirección de `role === 'client'` pasa a `buysAsClient`.
- Modify: `dashgo/src/app/(promoter)/profile.tsx:165`: sacar el link de puntos.
- Modify: `dashgo/src/app/(auth)/login.tsx:330`: `buysAsClient(role) && next`.
- Modify: `dashgo/src/components/QuoteBottomSheet.tsx:192-201`, `src/app/orders/[orderId]/index.tsx` y `src/app/orders/[orderId]/invoice.tsx`: usar la etiqueta "Saldo aplicado".
- Modify: `dashgo/src/app/(super)/users.tsx:493`: el texto "créditos y puntos" pasa a "créditos y saldo".
- Test: `dashgo/src/app/checkout.test.tsx`, `dashgo/src/app/_layout.test.tsx` o el test del layout de tabs si existe, y `dashgo/src/lib/roles.test.ts`

- [ ] **Step 1: Escribir los tests que fallan**

- `checkout.test.tsx` (reemplazar `mockUsePointsBalance` por `mockUseMyAssociateBalance`):
  - cliente con saldo 0: no aparece `/puntos/i` ni `/saldo de asociado/i`;
  - asociado con 1500: aparece "Usar mi saldo de asociado"; tocarlo muestra "Saldo aplicado" y el pedido sale con `usePoints: true`;
  - cliente con saldo 800: ve el toggle.
- Test del layout de tabs: la hoja "Más" de un cliente no tiene "Puntos".
- `roles.test.ts`: lo mismo que en web.

- [ ] **Step 2: Correr y ver que falla**

Run: `cd dashgo && npx jest src/app/checkout.test.tsx src/lib/roles.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar** los cambios de la lista.

- [ ] **Step 4: Verificar**

Run: `cd dashgo && npm test && npx tsc --noEmit && grep -rni "puntos" src/app src/components src/i18n | grep -v "\.test\." ; grep -rn "usePointsBalance\|/(tabs)/points\|/(promoter)/points\|t('points" src`
Expected: PASS y sin errores de tipos. El primer `grep` no encuentra la palabra en ningún texto visible (solo puede quedar en comentarios) y el segundo no imprime nada.

- [ ] **Step 5: Commit**

```bash
git add -A dashgo
git commit -m "feat(mobile): el cliente ya no ve puntos; el checkout usa el saldo de asociado"
```

---

### Task 12: Mobile — pantalla del pool, panel del admin y rol Asociado

**Files:**
- Create: `dashgo/src/lib/pool.ts`, con `formatDistributionDate(iso: string, locale: 'es' | 'en'): string` (siempre con `timeZone: 'America/New_York'`).
- Create: `dashgo/src/i18n/locales/{es,en}/pool.ts`, registrado en los dos `index.ts`. Claves:
  - `title`: 'Pool de asociados' | 'Associate pool';
  - `quarterLabel`: '{{n}}.º trimestre {{year}}' | 'Q{{n}} {{year}}';
  - `nextDistribution`: 'Próximo reparto: {{date}}' | 'Next distribution: {{date}}';
  - `associates`: '{{count}} asociados' | '{{count}} associates';
  - `estimatedShare`: 'Tu parte estimada' | 'Your estimated share';
  - `balance`: 'Tu saldo' | 'Your balance';
  - `history`: 'Movimientos' | 'Activity';
  - `allocation`: 'Reparto {{quarter}}' | '{{quarter}} distribution';
  - `redemption`: 'Usado en un pedido' | 'Used on an order';
  - `reversal`: 'Devuelto por cancelación' | 'Refunded (cancelled order)'.
  - Sumar también `nav.more.pool` y `profile.pool` con 'Pool de asociados' | 'Associate pool'.
- Create: `dashgo/src/app/(tabs)/pool.tsx`, con el mismo contenido que la `/pool` web. Se registra como `<Tabs.Screen name="pool" options={{ href: null }} />`. Se llega desde la hoja "Más" y desde el perfil, **solo para asociados**: la lista de la hoja se filtra por rol al renderizar.
- Create: `dashgo/src/app/(super)/pool.tsx`, con el resumen y la lista de repartos en español hardcodeado. Va como ítem `{ label: 'Pool', icon: { ios: 'chart.pie.fill', android: 'pie_chart' }, route: '/(super)/pool' }` en la lista del super admin de `(super)/_layout.tsx` (no en la del vendedor), más su `Tabs.Screen` con `href: null`.
- Modify: `dashgo/src/app/(super)/users.tsx:77`: `ASSIGNABLE_ROLES` pasa a `['client', 'seller', 'promoter', 'associate']`, y la etiqueta sale de `roleLabel`.
- Modify: `dashgo/src/app/(super)/products.tsx`: el label y la ayuda del % cambian igual que en la web (Task 10).
- Test: `dashgo/src/app/(tabs)/pool.test.tsx`, `src/app/(super)/users.test.tsx`, `src/app/(super)/pool.test.tsx`

- [ ] **Step 1: Escribir los tests que fallan**

- `(tabs)/pool.test.tsx`: con el mismo resumen y saldo que en la Task 10 aparecen `$123.45`, `Próximo reparto: 1 de enero de 2027`, `3 asociados` y `$5.00`.
- `(super)/users.test.tsx`: elegir "Asociado" llama a la mutación con `role: 'associate'`.
- `(super)/pool.test.tsx`: la fila `1999-Q3` muestra `$100.01`, `3`, `$33.33` y `$0.02`.

- [ ] **Step 2: Correr y ver que falla**

Run: `cd dashgo && npx jest "src/app/\(tabs\)/pool.test.tsx" "src/app/\(super\)/users.test.tsx" "src/app/\(super\)/pool.test.tsx"`
Expected: FAIL.

- [ ] **Step 3: Implementar.**

- [ ] **Step 4: Verificar**

Run: `cd dashgo && npm test && npx tsc --noEmit`
Expected: PASS, sin errores de tipos.

- [ ] **Step 5: Commit**

```bash
git add -A dashgo
git commit -m "feat(mobile): pantalla del pool para asociados, panel de repartos y rol Asociado"
```

---

### Task 13: Verificación final y PR

- [ ] **Step 1: api completo**

Run: `cd dashgo-api && TZ=UTC npm test && npm test && npm run build`
Expected: todo en verde y el build limpio.

- [ ] **Step 2: Integración, tres corridas**

Run: `cd dashgo-api && for i in 1 2 3; do npm run test:integration || break; done`
Expected: las 3 corridas en verde. Si falla un spec que no se tocó y que ya fallaba en `main`, se reporta con su salida; no se "arregla" de pasada.

- [ ] **Step 3: web y mobile**

Run: `(cd dashgo-web && npm test && npm run build) && (cd dashgo && npm test && npx tsc --noEmit)`
Expected: todo en verde.

- [ ] **Step 4: Push, PR y CI**

Push de `feat/pool-puntos-asociados` y PR contra `main`. Para el PR, usar el token del dueño, tal como dice la memoria `gh-cli-account-mismatch`. Después correr `gh pr checks` hasta que estén verdes.

En el cuerpo del PR, avisar:
- que el merge deploya solo el api y la web, y corre la migración que mueve los puntos de los clientes al pool;
- que la mobile sale por EAS: hay que subir `version`/`buildNumber` a mano, y mientras tanto la app vieja sigue andando gracias a la compatibilidad de `/points/*`;
- que el primer reparto es el 1 de enero de 2027.
