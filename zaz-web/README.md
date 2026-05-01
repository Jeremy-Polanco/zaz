# zaz-web

Frontend web de Zaz. Vite 8 · React 19 · TanStack · Tailwind v4.

> Setup del stack completo (docker, seed, envs): ver [../README.md](../README.md).

## Stack

- **Vite 8** con Rolldown
- **React 19** (sin `forwardRef`, `use()` en lugar de `useContext`)
- **TanStack Router** (file-based con `validateSearch` para deep-linking)
- **TanStack Query** para data fetching + cache
- **TanStack Table** en las pantallas admin
- **react-hook-form** + **Zod** para validación
- **Tailwind v4** con `@tailwindcss/vite` y `@theme` directive
- **Inter Tight** single-font system (ver [Design](#design-system))

## Rutas (file-based)

```
src/routes/
├── __root.tsx
├── index.tsx                         # landing, redirect por rol
├── login.tsx                         # phone + OTP, acepta ?ref=code
├── r.$code.tsx                       # landing de referral
├── catalog.tsx                       # productos + filtros por categoría (?cat=)
├── checkout.tsx                      # carrito + toggle puntos + breakdown
├── orders.tsx                        # mis pedidos (cliente)
├── orders.$orderId.invoice.tsx       # factura print-ready
├── points.tsx                        # balance + timeline
├── promoter.index.tsx                # dashboard promotor
├── promoter.commissions.tsx
├── promoter.payouts.tsx
├── super.orders.tsx                  # super admin: todos los pedidos
├── super.products.tsx                # CRUD global
├── super.categories.tsx              # CRUD categorías
├── super.promoters.tsx               # listado + invitar
└── super.promoters.$id.tsx           # detalle + "Pagar ahora"
```

Cada grupo (`_client`, `_promoter`, `_super`) valida rol en `beforeLoad` y redirige si no matchea.

## Auth flow

Cliente sin token → `/login`:

1. Ingresa teléfono → `POST /auth/otp/send` → pantalla de 6 dígitos
2. Ingresa código → `POST /auth/otp/verify` (opcionalmente con `fullName` en primer login y `referralCode` desde `?ref=`)
3. Guarda `accessToken` + `refreshToken` en `localStorage`
4. Redirect por rol: `client → /` · `promoter → /promoter` · `super_admin_delivery → /super/orders`

Interceptor de axios ([src/lib/api.ts](src/lib/api.ts)) inyecta el JWT y refresca en 401.

## Queries y mutations

Todas centralizadas en [src/lib/queries.ts](src/lib/queries.ts). Ejemplos:

```ts
useProducts()              // catálogo con effectivePriceCents computado
usePointsBalance()         // { pending, claimable, redeemed, expired }
usePointsHistory()
usePromoterDashboard()     // stats del promotor autenticado
useCreatePayout()          // super admin paga a promotor
useInvoice(orderId)
```

## Design system

**Editorial minimalista** con carácter de revista:

- **Tipografía:** Inter Tight 300-700 (single font — ni serif display ni mono)
- **Paleta:** Planeta Azul (`--color-paper` cream-blue, `--color-ink` navy, `--color-accent` cyan)
- **Primitivas:** `.eyebrow` (caps spaced), `.hairline` (divider 1px), `.nums` (tabular-nums), `.display` (weight 600 tracking-tight), `.page-rise` (entrada)
- **Tokens:** `src/index.css` (`@theme` block)

Cuando necesites precios/fechas/tablas usá `nums`. Headings grandes: `className="display text-5xl"`. Nada de `font-mono` ni `font-display` — no existen más.

## Dev

```bash
cp env.example .env
npm install
npm run dev                       # http://localhost:5173
npm run build                     # produce dist/
npm run typecheck
```

`VITE_API_URL` en `.env` debe apuntar al API con prefix `/api` (ej. `http://localhost:3002/api`).

## Gotchas

- **Vite 8 + Rolldown en macOS + nvm Node 24:** el binding nativo choca con Hardened Runtime (Team ID mismatch). Workaround: correr el dev server en Docker, no en Node local.
- **Refresh tokens en `localStorage`:** aceptable para MVP. Para prod, mover a httpOnly cookie.
- **TanStack Router codegen:** `routeTree.gen.ts` se regenera al arrancar el dev server. Si agregás una ruta nueva y TS se queja, reiniciá el dev server.
- **`validateSearch`:** para acceder a `?ref=code` en `/login`, definir el schema en el archivo de ruta — sin eso, el parámetro queda como `unknown`.
