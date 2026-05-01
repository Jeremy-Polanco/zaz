# Zaz — Water Delivery Platform

SaaS para pedidos de agua a domicilio en New York. Tres roles:

- **cliente (CLIENT)** — pide agua, acumula puntos, puede llegar vía referral, puede usar crédito y suscribirse a envío gratis
- **promotor (PROMOTER)** — referidor con código único; gana comisión sobre pedidos de sus referidos
- **super-admin (SUPER_ADMIN_DELIVERY)** — único con inventario físico. Confirma, entrega, cobra, paga comisiones, y gestiona crédito de clientes

> ⚠️ **READ FIRST** — sección [Pending User Actions](#-pending-user-actions-before-deploy) abajo. Hay 5 cosas que vos tenés que hacer antes de poder deployar prod o correr tests de integración.

## Stack

| Paquete | Tech | Tests |
|---|---|---|
| [zaz-api/](./zaz-api) | NestJS 11 · TypeORM 0.3 · Postgres 16 · JWT · Twilio (OTP) · Stripe v22 | Jest (unit + integration + E2E) |
| [zaz-web/](./zaz-web) | Vite 8 (Rolldown) · React 19 · TanStack Query/Router/Table · RHF · Zod 4 · Tailwind v4 · Sentry | Vitest + RTL + jsdom |
| [zaz/](./zaz) | Expo SDK 55 · React Native · NativeWind 4 · TanStack Query · RHF · Zod 3 · expo-secure-store | jest-expo + RNTL |
| Postgres dev | Postgres 16 (puerto host **5433** en compose) | Postgres 16 Docker para integration tests |
| Adminer | Puerto **8082** | — |

Sistema de diseño: **Inter Tight** single-font, paleta Planeta Azul, editorial minimalista (eyebrows, hairlines, tabular nums).

## Arranque rápido

```bash
cp env.example .env            # ajustá secrets (JWT, Twilio, Stripe)
docker compose up -d           # postgres + adminer + api + web
docker compose logs -f api
```

Servicios:
- API: http://localhost:3002/api
- Web: http://localhost:5173
- Adminer: http://localhost:8082 (server: `postgres`, user: `zaz`, pass: `zaz_dev`, db: `zaz_db`)
- Postgres: `localhost:5433`

### Seed

```bash
docker compose exec api npm run seed
```

Crea (todos los teléfonos son reservados US `+1 555-555-xxxx` — bypassean Twilio y loguean el OTP a consola):

- **Super admin** — `+15555550001`
- **Promotor demo** — `+15555550005` con `referralCode = DEMO123A`, 500¢ de comisión CLAIMABLE
- **Cliente demo** — `+15555550004` referido por el promotor, 250¢ de puntos CLAIMABLE
- **4 categorías** — Agua 💧, Bebidas 🥤, Hielo 🧊, Accesorios 📦
- **5 productos** — incluye "Botellón 5L" con offer activo (-15% por 30 días)

> ⚠️ Cambiar enums de Postgres con `synchronize: true` falla si hay filas viejas. Fix: `docker compose down -v` y reseed.

### Mobile (Expo)

```bash
cd zaz
npm install
cp env.example .env
npm run ios                  # o npm run android
```

En device físico usá la IP LAN en `EXPO_PUBLIC_API_URL` (ej. `http://192.168.1.20:3002/api`) — `localhost` apunta al device.

---

## 🚨 Pending User Actions (BEFORE DEPLOY)

Estas cosas **no las podés saltear** y nadie las hizo automáticamente. Sin esto, prod no funciona o tus datos se rompen.

### 1. Generar la migración inicial (BLOQUEA todo)

`DB_SYNCHRONIZE=true` está deshabilitado en producción. Necesitás generar la migración base contra una DB con el schema actual:

```bash
cd zaz-api
# Asegurate de que la DB de dev tenga el schema correcto, después:
npm run migration:generate -- src/database/migrations/InitialSchema
git add . && git commit -m "chore: initial schema migration"
```

Sin esto:
- Las migraciones de cards / credit / subscription no se pueden correr
- Los integration tests del backend fallan con error explícito

### 2. Correr las migraciones del schema en orden

Ya están commiteadas. Después del paso 1:

```bash
cd zaz-api && npm run migration:run
# Aplica en orden:
#   InitialSchema
#   1745800000000-AddCategoryImage
#   1745900000000-AddCreditAccounts
#   1746000000000-AddSubscriptions
```

### 3. Stripe Dashboard (sin esto Subscription NO funciona)

3.1. **Crear Product + Price**:
- Stripe Dashboard → Products → "Zaz Plus" → Recurring → $10 USD/mes
- Copiar el `price_xxx` ID

3.2. **Setear env var** en prod:
```
STRIPE_SUBSCRIPTION_PRICE_ID=price_xxx
```

3.3. **Configurar Customer Portal**:
- Stripe Dashboard → Settings → Billing → Customer Portal
- Allow: cancel subscription, update payment method, view invoices

3.4. **Crear webhook endpoint**:
- Stripe Dashboard → Developers → Webhooks → Add endpoint
- URL: `https://tu-api.com/api/payments/webhook`
- Events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_succeeded`, `invoice.payment_failed`, plus los existentes de payment_intent
- Copiar signing secret → `STRIPE_WEBHOOK_SECRET`

### 4. Mobile — confirmar bundle ID y EAS secrets

```bash
# Confirmar bundle ID es lo que querés (default: com.zaz.app)
cat zaz/app.config.ts | grep bundleIdentifier

# Setear secrets EAS para builds de prod
cd zaz
eas secret:create --scope project --name EXPO_PUBLIC_API_URL --value https://api.zaz.com/api
eas secret:create --scope project --name EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY --value pk_live_xxx
```

Y fixear los 2 errores de TS pre-existentes:
- `zaz/src/app/checkout.tsx:142` — route type `/orders/[orderId]` invalid
- `zaz/src/app/orders/[orderId]/index.tsx:93` — Button variant "secondary" invalid

### 5. Smoke tests sobre DB real

Después de los pasos 1-3, validar end-to-end:

```bash
# Backend
cd zaz-api
docker compose -f test/docker-compose.test.yml up -d
npm run test:integration   # usa Postgres test de Docker
npm run test:e2e

# Money paths críticos a verificar manualmente:
#  - Cliente con $30 crédito hace order de $50 → Stripe charges $20 (NO double charge)
#  - Cliente con due_date pasado intenta comprar → 402 CREDIT_OVERDUE
#  - Suscriptor hace order → shipping = $0 + badge "Suscriptor" visible al promotor
#  - Cancelación de order con creditApplied > 0 → balance restaurado
```

---

## Features

### Catálogo
Productos globales, categorías con slug/emoji/orden + **imagen opcional** (bytea), offers con ventana `[startsAt, endsAt]` y `discountPct`. Precio efectivo calculado server-side via `getEffectivePrice(product)`.

### Category cards (home)
Web `/home` y mobile `(tabs)/index` muestran categorías como cards grandes con foto de fondo + emoji fallback. Click → catálogo filtrado por slug. Solo clientes ven esto; promotores tienen su flujo aparte.

### Puntos (1pt = 1¢)
Se acreditan al entregar con `status = PENDING`, vencen a `CLAIMABLE` a 90 días y expiran a 180. Redención **all-or-nothing** en checkout.

### Crédito / Fiado
Sistema de cuenta corriente gestionado por super-admin:
- Super grants/adjusts/payment via `/super/credit/$userId`
- `credit_limit_cents` define cuánto puede deber el cliente
- `due_date` define plazo de pago
- En checkout, cliente puede aplicar crédito + Stripe combinados (crédito primero, Stripe el remainder)
- Si `due_date` pasó y balance < 0 → **bloqueo TOTAL** de compras (incluso con tarjeta) hasta saldar
- Webhook fail / cancelación de order → reversal idempotente del cargo de crédito
- Solo CLIENT role puede usar crédito (PROMOTER/SUPER lo ignora silenciosamente)

### Suscripción ($10/mes — Stripe)
Plan único mensual que da envío gratis en todos los pedidos:
- Subscribe via Stripe Checkout (hosted)
- Manage / cancel / update payment-method via Stripe Customer Portal
- Webhooks mantienen DB sincronizada (idempotente, never 500)
- Cancela = sigue activo hasta fin del período (no pro-rated refund)
- Sin trial
- Promotor absorbe el costo del envío gratis (no compensación de plataforma)
- Forward-compat con Stripe API ≥ 2025-04-30 (period_end fallback a items[0])

### Impuesto NY
8.887% sobre `(subtotal − pointsRedeemed − creditApplied)`.

### Facturas inmutables
`INV-YYYY-NNNNNN` generadas automáticamente al entregar. Numeración vía tabla `counters` + `pessimistic_write` lock.

### Promotores
referralCode 8-char alfanumérico (sin 0/O/1/I), landing `/r/:code`, dashboard con stats, ledger de comisiones con vesting de 90 días.

### Payouts
Manual por ahora — super admin ve promotor, presiona "Pagar ahora", se registra en `Payout` con notes. (Stripe Connect deferred).

---

## Auth — Phone + OTP only

No hay email/password. El flow único es:

1. `POST /api/auth/otp/send { phone }` → Twilio manda SMS 6 dígitos, TTL 5 min, cooldown 30s
2. `POST /api/auth/otp/verify { phone, code, fullName?, referralCode? }` → si es primer login, crea user; devuelve access (1h) + refresh (7d)
3. `POST /api/auth/refresh { refreshToken }`

**OTP generation**: `crypto.randomInt` (CSPRNG, no `Math.random`).

**Dev bypass**: teléfonos que matcheen `^\+1555555\d{4}$` no tocan Twilio — el OTP se imprime en los logs. Útil para seed y pruebas.

**Costo Twilio US**: ~$0.008 por SMS. 1k logins semanales ≈ $32/mes.

---

## Seguridad

Hardening aplicado en MVP sweep:

| Item | Status |
|---|---|
| Joi env validation al startup (DB_SYNCHRONIZE forbidden en prod, JWT_SECRET min 32 chars) | ✅ |
| Helmet (security headers) | ✅ |
| @nestjs/throttler (100/60s global, 5/60s en auth) | ✅ |
| AllExceptionsFilter (no stack trace leak en prod) | ✅ |
| RequestLoggerMiddleware | ✅ |
| `synchronize: false` hardcoded en data-source.ts; bloqueado por env también | ✅ |
| Stripe `idempotencyKey` en paymentIntents.create | ✅ |
| Connection pool (max=20, timeout 10s) | ✅ |
| `select: false` en columnas sensibles (image_bytes) | ✅ |
| Webhook signature verification | ✅ |
| Tokens en SecureStore (mobile, migrado de AsyncStorage) | ✅ |
| Sentry hooks (web + mobile, condicional con DSN) | ✅ |
| ErrorBoundary + 404 page (web + mobile) | ✅ |

Aislamiento por rol — sin RLS de Postgres, vive en NestJS:

- `JwtAuthGuard` extrae usuario autenticado
- `RolesGuard` + `@Roles()` restringen por rol
- Services filtran queries por `user.id` (cliente), `referredById` / `promoterId` (promotor), o sin filtro (super admin)

### Verificación rápida

```bash
# Un cliente no puede leer la orden de otro → 404
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "Authorization: Bearer $OTRO_TOKEN" \
  http://localhost:3002/api/orders/$ORDER_ID
```

---

## Flow end-to-end

1. Cliente elige productos → pasa checkout → opcionalmente aplica puntos / crédito → `status: pending_quote`
2. Super admin cotiza shipping (si suscriptor → shipping=0) → `quoted`
3. Cliente authorize → Stripe paymentIntent (manual capture) → `pending_validation`
   - Si `creditApplied === total` → skip Stripe, va directo a `confirm-non-stripe`
4. Super admin confirma → `confirmed_by_colmado` → decrementa stock (transaccional)
5. Super admin marca en ruta → `in_delivery_route`
6. Super admin entrega y cobra → `delivered`. En una sola transacción:
   - Captura Stripe paymentIntent (si hay)
   - Credita puntos PENDING por línea (vence a 90d)
   - Genera invoice inmutable
   - Credita comisión PENDING al promotor si `customer.referredById`

### Cancelación / Stripe failure

Si order tiene `creditApplied > 0`:
- `CANCELLED` transition → reverseCharge (idempotente vía unique partial index)
- `payment_intent.canceled` / `payment_failed` webhook → reverseCharge (idempotente)

### Tick diario de vesting

Cron `0 3 * * *` (vía `@nestjs/schedule`): puntos PENDING → CLAIMABLE a los 90d, → EXPIRED a los 180d. Mismo pattern para comisiones (sin expiry).

---

## Testing

195 tests across 3 projects. Money paths cubiertos.

### Backend (Jest + Postgres en Docker + Stripe mocked)

```bash
cd zaz-api

# Unit tests (in-process, fast, ~44 tests)
npm test
npm run test:cov           # con coverage (80% threshold en money modules)

# Integration tests (Docker + real Postgres, requires PRE-1 InitialSchema migration)
docker compose -f test/docker-compose.test.yml up -d
npm run test:integration

# E2E specs (supertest, full app)
npm run test:e2e

# Concurrency-tagged tests con --runInBand (race conditions)
npm run test:concurrency
```

Detalles del setup en [`zaz-api/test/PATTERNS.md`](./zaz-api/test/PATTERNS.md).

Lo que cubre:
- **Credit**: applyCharge, reverseCharge (idempotency!), recordPayment, isOverdue, race conditions con pessimistic_write
- **Subscription**: handleWebhook (6 events), extractPeriodBounds (legacy + new Stripe API), isActiveSubscriber, getOrCreateStripeCustomer (3-tier dedup)
- **Orders**: overdue gate, useCredit ignored para non-CLIENT, **regression test del double-charge bug** (CRIT-1 catched durante verify)
- **Payments**: handleAuthFailureByIntentId reversal idempotente

### Web (Vitest + RTL + jsdom)

```bash
cd zaz-web
npm test                   # 63 tests across 8 suites
npm run test:watch
npm run test:cov
```

Cubre: cart signal, schemas (zod 4), CategoryCard image fallback, CheckoutCreditStep math + role-gate, SuscriptorBadge, route states (5 estados de credit/subscription).

### Mobile (jest-expo + RNTL)

```bash
cd zaz
npm test                   # 88 tests across 8 suites
npm run test:cov
```

Cubre: cart, category-selection, token-storage (con mock SecureStore), schemas (zod 3), CategoryCard, SuscriptorBadge, screens (credit + subscription state machines + deep-link return).

### CI

`.github/workflows/test.yml` corre 3 jobs en paralelo (api/web/mobile) en cada PR + push a main.

Inicialmente con `continue-on-error: true` para no bloquear merges hasta que el equipo esté listo. Para activar enforcement, sacá esa flag de los pasos de `Run tests` / `Run integration tests` / `Run E2E tests`.

Coverage artifacts se suben en cada job (retention 7 días).

---

## Dev sin Docker

```bash
# postgres solo
docker compose up -d postgres

cd zaz-api && cp env.example .env && npm install --legacy-peer-deps && npm run start:dev
cd zaz-web && cp env.example .env && npm install && npm run dev
cd zaz     && cp env.example .env && npm install && npm run ios
```

---

## Estructura

```
Zaz/
├── README.md                      # este archivo
├── docker-compose.yml             # postgres + adminer + api + web
├── env.example                    # secrets compartidos
├── package-lock.json
├── .github/workflows/test.yml     # CI: 3 jobs paralelos
├── .atl/skill-registry.md         # registry de skills (autoresolved)
│
├── zaz-api/                   # NestJS backend
│   ├── env.example                # DB_*, JWT_*, TWILIO_*, STRIPE_*
│   ├── package.json               # jest projects (unit + integration)
│   ├── Dockerfile                 # multi-stage prod
│   ├── src/
│   │   ├── main.ts                # bootstrap (helmet, compression, pipes, filters)
│   │   ├── app.module.ts          # Joi env validation
│   │   ├── config/database.config.ts
│   │   ├── database/migrations/   # InitialSchema (PENDING) + 3 features
│   │   ├── entities/              # flat: Category, Product, Order, CreditAccount, Subscription, etc.
│   │   ├── modules/{auth,users,products,categories,orders,payments,promoters,points,invoices,shipping,twilio,credit,subscription}/
│   │   ├── common/                # filters, middleware, guards
│   │   ├── health/                # /api/health endpoint
│   │   └── test-utils/            # db, stripe mock factory, fixtures, testing-app, transaction
│   └── test/
│       ├── docker-compose.test.yml  # postgres test on port 5433
│       ├── setup-integration.ts     # globalSetup: drop+recreate schema, run migrations
│       ├── teardown-integration.ts
│       ├── PATTERNS.md              # test patterns guide
│       ├── jest-e2e.json
│       ├── integration/{credit,orders,subscription}.integration-spec.ts
│       └── e2e/{orders,subscription,credit}.e2e-spec.ts
│
├── zaz-web/                   # TanStack + Vite
│   ├── env.example                # VITE_API_URL, VITE_SENTRY_DSN
│   ├── vitest.config.ts
│   ├── tsconfig.test.json
│   └── src/
│       ├── routes/                # __root, index, login, home, catalog, checkout, credit, subscription, super.*
│       ├── components/            # CategoryCard, CheckoutCreditStep, SuscriptorBadge, MapPicker, etc.
│       ├── lib/                   # api, auth, cart, queries, schemas, types, geo, tax
│       └── test/                  # setup, test-utils, mocks/
│
└── zaz/                       # Expo Mobile
    ├── env.example                # EXPO_PUBLIC_API_URL, EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY, EXPO_PUBLIC_SENTRY_DSN
    ├── app.config.ts              # bundleIdentifier, package, permissions
    ├── eas.json                   # dev/preview/production profiles
    ├── jest.config.js
    └── src/
        ├── app/                   # Expo Router: (auth), (tabs), (promoter), (super), checkout, orders/[orderId]
        ├── components/            # CategoryCard, SuscriptorBadge, MapPicker
        ├── lib/                   # api, queries, schemas, types, cart, category-selection, token-storage
        └── test/                  # setup, test-utils, mocks/{expo-router,expo-secure-store,expo-web-browser,api}
```

---

## Gotchas

- **macOS + Docker bind mounts**: cada subpath montado tiene device ID distinto → `fs.rename` entre ellos falla con `EXDEV` (ej. tanstack-router-plugin). El compose monta cada proyecto entero + volumen anónimo en `/app/node_modules`.
- **Volumen anónimo de node_modules**: `npm install` en el host **no** propaga al contenedor. Para agregar deps del backend: `docker compose exec api npm install <pkg> --legacy-peer-deps && docker compose restart api`.
- **Vite 8 + Rolldown en nvm Node 24 (macOS)**: binding nativo `.node` choca con Hardened Runtime. Workaround: dev server y typecheck en Docker (Linux), no en el Node local. CI en ubuntu-latest no se ve afectado.
- **Nest 11 peer deps**: `npm ci` requiere `--legacy-peer-deps` (conflicto `@nestjs/config`). Ya aplicado en `zaz-api/Dockerfile`.
- **Enum changes con `synchronize: true`**: si hay filas con el valor viejo, ALTER TYPE falla. Fix: `docker compose down -v && docker compose up -d && docker compose exec api npm run seed`. (En prod synchronize está OFF, usar migrations.)
- **TypeORM `numeric`**: columnas `numeric(p,s)` devuelven strings. Usá `parseFloat` o aritmética en centavos enteros para evitar drift.
- **Stripe API version ≥ 2025-04-30**: `current_period_start/end` se movió de Subscription a Subscription.items[0]. Código nuestro lee con fallback compatible con ambos shapes.
- **Zod versión**: web usa Zod 4, mobile usa Zod 3. **Schemas NO se comparten** entre proyectos.
- **NativeWind en tests**: jest-expo no corre el babel transform de NativeWind, los tests usan `testID` y accessibility props (NO `className`).
- **TanStack Router strict + validateSearch**: cualquier `redirect({ to: '/login' })` requiere `search: { next: undefined, ref: undefined }`. Hay 34 fixes ya aplicados.
- **Database config + entities**: si agregás una entity nueva, sumarla al array en `zaz-api/src/config/database.config.ts` además de exportar en `entities/index.ts`. El bug clásico: `forFeature()` funciona pero relations cross-entity rompen porque `forRoot()` no las tiene.

---

## Licencia

Proprietary — Zaz.
# zaz
