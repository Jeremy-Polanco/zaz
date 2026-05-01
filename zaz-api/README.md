# zaz-api

Backend de Zaz. NestJS 11 · TypeORM · Postgres · JWT · Twilio OTP · Stripe.

> Setup del stack completo (docker, seed, envs): ver [../README.md](../README.md).

## Stack

- **NestJS 11** con `@nestjs/config`, `@nestjs/jwt`, `@nestjs/passport`, `@nestjs/schedule`
- **TypeORM** + `pg` (Postgres 16). `synchronize: true` en dev, migraciones en prod.
- **Auth:** phone + OTP (Twilio), JWT access (1h) + refresh (30d)
- **Pagos:** Stripe (setup inicial, Connect pendiente)
- **SMS:** Twilio con dev bypass para `+1555555XXXX`

## Módulos

```
src/
├── entities/                  # User, Product, Category, Order, OrderItem,
│                              # PointsLedgerEntry, PromoterCommissionEntry,
│                              # Invoice, Counter, Payout, OtpCode
├── modules/
│   ├── auth/                  # OTP send/verify, refresh, /me
│   ├── users/                 # perfil, update
│   ├── products/              # CRUD + getEffectivePrice (precio con offer)
│   ├── categories/            # CRUD con slug auto
│   ├── orders/                # create, status transitions, delivery txn
│   ├── points/                # balance, history, creditForOrder, cron vesting
│   ├── invoices/              # immutable invoices con counter + pessimistic_write
│   ├── promoters/             # invite, dashboard, commissions, payouts
│   ├── twilio/                # sendSms con regex bypass
│   └── stripe/                # webhooks, payment intents
├── common/
│   ├── guards/                # JwtAuthGuard, RolesGuard
│   └── decorators/            # @CurrentUser, @Roles, @Public
├── database/
│   ├── data-source.ts         # CLI para migraciones
│   └── seed.ts                # npm run seed
└── config/
    └── database.config.ts
```

## Auth flow (phone + OTP)

```
POST /api/auth/otp/send      { phone }
  → Twilio SMS 6 dígitos, bcrypt-hash en DB, TTL 5m, cooldown 30s
  → teléfonos /^\+1555555\d{4}$/ bypassean Twilio (log a consola)

POST /api/auth/otp/verify    { phone, code, fullName?, referralCode? }
  → primer login crea User (role = CLIENT)
  → referralCode setea referredById (usado para comisiones)
  → devuelve { accessToken, refreshToken, user }

POST /api/auth/refresh       { refreshToken }
GET  /api/auth/me            (JWT required)
```

JWT payload: `{ sub: userId, phone, role }`.

## Delivery transaction

`OrdersService.markDelivered(orderId)` ejecuta **en una sola transacción de TypeORM**:

1. `status = delivered`, set `deliveredAt`
2. `PointsService.creditForOrder(orderId, tx)` — 1pt por 1¢ por línea, status PENDING
3. `InvoicesService.createForOrder(orderId, tx)` — `INV-YYYY-NNNNNN` via `Counter` + `pessimistic_write`
4. `PromotersService.creditCommissionsForOrder(orderId, tx)` — si `customer.referredById`, comisión PENDING según `product.promoterCommissionPct`

Si algún paso falla, rollback total. Nunca queda mitad facturado.

## Cron — vesting tick

Cada día a las 03:00 (`@Cron('0 3 * * *')`):
- **Puntos:** PENDING → CLAIMABLE a los 90d · CLAIMABLE → EXPIRED a los 180d
- **Comisiones:** PENDING → CLAIMABLE a los 90d (sin expiry — es dinero ganado)

## Precio efectivo

`products/pricing.ts`:

```ts
getEffectivePrice(product, now = new Date()) → {
  priceCents, basePriceCents, discountPct, offerActive
}
```

Offer activo si `offerDiscountPct` seteado **y** `now ∈ [offerStartsAt, offerEndsAt]` (extremos nullables = sin límite). Cálculo SIEMPRE server-side — nunca confiar en el precio que manda el cliente.

## Endpoints principales

```
Auth:       POST /auth/otp/send · /otp/verify · /refresh · GET /auth/me
Users:      GET /users/me · PATCH /users/me
Products:   GET /products · POST /products (super) · PATCH /products/:id
Categories: GET /categories · POST /categories (super) · PATCH · DELETE
Orders:     POST /orders · GET /orders (scoped por rol) · GET /orders/:id
            PATCH /orders/:id/status (super) · GET /orders/:id/invoice
Points:     GET /points/balance · GET /points/history
Promoters:  POST /promoters/invite (super) · GET /promoters (super)
            GET /promoters/by-code/:code · GET /promoters/me
            GET /promoters/:id/dashboard · GET /promoters/:id/commissions
            POST /promoters/:id/payouts (super) · GET /promoters/:id/payouts
```

Prefix global: `/api`. CORS: `CORS_ORIGIN` (default `http://localhost:5173`).

## Dev

```bash
# postgres solo (desde raíz)
docker compose up -d postgres

cp env.example .env
npm install --legacy-peer-deps     # Nest 11 peer ranges
npm run start:dev                  # watch mode, :3001
npm run seed                       # popula DB (requiere API down o DB vacía)
```

En docker: `docker compose exec api npm install <pkg> --legacy-peer-deps && docker compose restart api` — el volumen anónimo de `/app/node_modules` impide que `npm install` en host propague.

## Stripe — local webhook setup

```bash
# install Stripe CLI once
brew install stripe/stripe-cli/stripe   # macOS
stripe login

# forward live events to your local API
stripe listen --forward-to localhost:3001/api/payments/webhook
# → prints: > Ready! Your webhook signing secret is whsec_xxx
# copy that to STRIPE_WEBHOOK_SECRET in zaz-api/.env, then restart API
```

Trigger test events without a real card:

```bash
# customer credit payment success
stripe trigger payment_intent.succeeded \
  --add payment_intent:metadata.kind=credit_payment \
  --add payment_intent:metadata.userId=<userId>

# order authorization (manual capture flow)
stripe trigger payment_intent.amount_capturable_updated
```

Idempotency: `credit_movements` has a unique partial index on
`stripe_payment_intent_id`. Duplicate webhooks return the existing movement
without writing twice. `recordPaymentFromStripe` also handles concurrent
deliveries via the 23505 unique-violation catch path.

## Gotchas

- **`synchronize: true` + enum changes:** si hay filas con valor viejo, ALTER TYPE falla. Fix: `docker compose down -v && npm run seed`.
- **TypeORM `numeric`:** columnas `numeric(p,s)` devuelven **strings**. Parsear con `parseFloat` o trabajar en centavos enteros.
- **Bcrypt en OTP:** el código OTP se hashea igual que passwords. Comparación con `bcrypt.compare` en verify.
- **Invoice numbering:** el `pessimistic_write` lock en la tabla `counters` serializa los inserts. No es cuello de botella hoy pero tenerlo en cuenta si hay alta concurrencia.
