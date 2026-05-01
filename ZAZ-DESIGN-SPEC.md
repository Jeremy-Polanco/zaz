# ZAZ — Design Specification

**Purpose**: This document is a complete feature & flow specification for the ZAZ delivery platform, written as a design handoff. It is intended to be consumed by an AI design agent (Claude or similar) to produce a fresh visual design for the mobile app and web admin without needing to read the existing codebase. It describes WHAT the app does and HOW users move through it — not how the code is structured.

**Last updated**: 2026-04-30
**Stack-agnostic**: any decision made by the designer that conflicts with implementation should win.

---

## 1. Product Snapshot

ZAZ is a hyper-local delivery service launching in **New York City**. The core product is **water delivery** (jugs, gallons, bottled), with adjacent categories (cold drinks, ice, household accessories). The model is on-demand: customer places an order through the app → admin reviews and quotes shipping → customer authorizes payment → driver delivers.

The brand evolved through three names: Colmapp → Bodeguita → **ZAZ**. The current ZAZ identity (purple + electric yellow + lightning bolt) signals **speed and energy** — orders arrive fast, like a bolt.

### Operating principles
- **Ultra-fast delivery** is the core value prop. UI should always reinforce speed (concise, confident, decisive).
- **Spanish-first** (Rioplatense — Argentine voseo). English is not supported in the UI today.
- **Mobile-first** for customers; **web-first** for the operator. Both must look like the same product, not two different apps.
- **Trust**: this app handles money (orders, credit, subscriptions, payouts). UI must always show the breakdown of charges, the status of pending payments, and the source of every dollar moved.

---

## 2. Audience & Roles

There are exactly **three** user roles. The app routes each role to a different home screen on login.

### 2.1 Client (end customer)
The buyer. Uses the **mobile app** primarily. Browses catalog, places orders, manages credit, opts into subscription, redeems points. Receives delivery at their address.

### 2.2 Promoter (referrer)
A user who promotes ZAZ to friends in exchange for commission. Has their own dashboard tab group. Sees referral code, referred customer list, commission balance, payout history. Can also order as a customer (catalog access). Promoters do NOT have a credit account or subscription.

### 2.3 Super Admin Delivery (operator)
The business owner / dispatcher. Uses the **web admin** primarily — the mobile app for super admins exists but is a fallback (mobile auto-redirects to a super-admin section if needed). Manages: orders queue, quoting & dispatch, products, categories, credit accounts, promoter applications, payouts, reports.

---

## 3. Brand & Visual Identity

### 3.1 Logo
The ZAZ wordmark is two white **Z** letters with a **yellow lightning bolt** in place of the central "A". Rendered on a deep purple background. The mark always reads "ZAZ" — never "ZAS" or "Z⚡Z".

### 3.2 Color palette (light theme — current)

| Token | Hex | Usage |
|---|---|---|
| `paper` | `#FAFAFC` | Main background — off-white, never pure white |
| `paper-deep` | `#F0F0F5` | Elevated surfaces (cards, posters, sticky bars on light pages) |
| `ink` | `#1A1530` | Primary text, dark icons |
| `ink-soft` | `#4A4566` | Body text, secondary labels |
| `ink-muted` | `#6B6488` | Tertiary, captions, placeholders |
| `brand` | `#220247` | Deep ZAZ purple — primary action, branded surfaces |
| `brand-dark` | `#15012E` | Pressed states, text on yellow |
| `brand-light` | `#E8E0F5` | Branded callouts, subtle highlight backgrounds |
| `accent` | `#F5E447` | Lightning yellow — badges only, contained blocks |
| `accent-dark` | `#D4C12E` | Pressed accent |
| `accent-light` | `#FFF9D6` | Pale highlight (notifications, banner backgrounds) |
| `ok` | `#2F7D5B` | Success / delivered |
| `warn` | `#7D5500` | Pending, needs-attention |
| `bad` | `#A83232` | Errors, overdue, cancelled |

### 3.3 Color rules a designer MUST follow
- **Yellow is contained, never free**. `bg-accent` always wraps text in dark color (`text-brand-dark`). `text-accent` is forbidden on light backgrounds because yellow text on white is illegible. Yellow is a *highlight*, not a *signal*.
- **Brand purple is the primary CTA color** in light theme. `bg-brand` with white text → primary buttons, hero posters, branded callouts. Yellow CTAs exist but are reserved for SECONDARY emphasis ("see promotion", "claim points") never the main button on a screen.
- **Dark cards on light pages are intentional contrast moments**: the cart sticky bar, primary buttons, profile avatar circle — these use `bg-ink` (near-black) with `text-paper` (white). They should feel like a "pressed-in" element, not a separate panel.

### 3.4 Typography

**Family**: Inter Tight (Google Fonts) — used at every weight: regular (400), medium (500), semibold (600), bold (700). Italic is reserved for **decorative emphasis** (display headlines, marketing tail words like "tu *pedido*", "Mi *suscripción*").

**Hierarchy** (mobile baseline, web scales 1.1×):
- Display heading: 36–44px / semibold / tight tracking
- Section heading: 22–28px / semibold
- Body: 14–16px / regular or medium
- Eyebrow: 11px / regular / uppercase / 0.18em tracking
- Label / chip: 10–11px / medium / uppercase / 0.10em tracking
- Tabular numbers (prices, totals): all-cap variant `font-variant-numeric: tabular-nums` — required for any column of money.

**Pattern that recurs**: a small uppercase **Eyebrow** ("Catálogo · New York") above a big **Display** headline ("Hola, vos."). This is the visual signature across most screens.

### 3.5 Iconography
- **iOS**: SF Symbols via `expo-symbols`. Filled variants when focused, outlined when inactive.
- **Android**: Material Icons (mapped equivalents).
- **Web**: SVG (no icon font). Lucide-style line icons or custom strokes acceptable.
- **Categories**: each category has an emoji as its primary visual marker (💧 Agua, 🥤 Bebidas, 🧊 Hielo, 📦 Accesorios). Emojis ARE part of the design and should be displayed, not stripped.

### 3.6 Voice & tone

**Language**: Rioplatense Spanish (voseo). Uses second-person singular informal: *vos* not *tú*. Imperative *poné, mandanos, autorizá* not *pon, envíanos, autoriza*.

**Vibe**: Direct, warm, confident. Like a friendly merchant who doesn't waste your time. Never corporate-cold, never childish.

**Microcopy patterns**:
- Greetings: "Hola, {firstName}." — informal, first-name only.
- CTAs in uppercase tracking-label format: "ENVIAR CÓDIGO →", "AGREGAR", "VERIFICAR".
- Empty states are encouraging not apologetic: "Catálogo vacío" / "No hay productos disponibles ahora mismo." (not "Lo sentimos, no hay productos").
- Error states are direct: "Código inválido", "No pudimos mandar el código".
- Trailing arrows on forward actions ("→") are part of the brand voice.
- Italic accent words for emphasis ("Hola, *vos*", "Mi *suscripción*", "Saldar mi *deuda*").

---

## 4. Mobile App — Client Experience

### 4.1 Authentication

**Single screen, two steps**: phone → OTP code.

**Layout pattern**: a "poster" header (purple `bg-brand` block with hero text, eyebrow, italic accent word, big italic step number "01", subtitle) followed by a form section on a slightly elevated `paper-deep` surface.

**Step 1 — Phone**:
- Eyebrow: "Ingresar"
- Field: telephone (with placeholder `+18091234567`)
- CTA: "Enviar código →" (yellow accent button, dark text)

**Step 2 — Code**:
- Eyebrow: "Código"
- Subtitle: "Mandamos un código a +1809...". Below: "← Usar otro número" link.
- If first login (server returns "primer ingreso") show an inline name field with a small accent border highlight: "Primer ingreso detectado — decinos cómo te llamás."
- If user signed up via referral link `/r/{code}`: show a pill badge "Registrándote con código: {CODE}" above the inputs.
- Field: 6-digit OTP (centered, large 28px, letter-spaced)
- CTA: "Verificar →"
- Resend timer: "Reenviar en 30s" → "Reenviar código" when ready.

**Routing after success**: `client → home`, `promoter → /promoter`, `super_admin_delivery → /super`.

### 4.2 Bottom tab bar (client)

5 tabs always visible. SF Symbols icons + uppercase 10px labels. Active tab uses **brand purple** for both icon tint and label.

| Tab | Icon (iOS) | Label |
|---|---|---|
| Inicio | `house.fill` | INICIO |
| Catálogo | `square.grid.2x2.fill` | CATÁLOGO |
| Pedidos | `bag.fill` | PEDIDOS |
| Crédito | `creditcard.fill` | CRÉDITO |
| Cuenta | `person.crop.circle.fill` | CUENTA |

**Hidden but routable**: Puntos and Suscripción are accessed from inside Cuenta (via "Mi actividad" links), not from the tab bar. Promoters get a different 4-tab bar (no Inicio/Crédito; gain Puntos).

### 4.3 Inicio (Home)

**Purpose**: Landing page after login. Shows category cards as the primary navigation. Goal: reduce friction from "open app" to "see products" to one tap.

**Layout**:
- Eyebrow: "Inicio"
- Display: "¿Qué necesitás?"
- Grid of large square category cards (2 columns on mobile). Each card shows:
  - Category emoji (large, top-aligned)
  - Product count ("3 PRODUCTOS")
  - Category name ("Agua")
  - On tap → navigates to Catálogo with that category preselected.

**Empty state**: if no categories loaded, show a soft "(no hay categorías cargadas)" notice.

### 4.4 Catálogo

**Purpose**: Product browsing + cart building.

**Header**:
- Eyebrow: "Catálogo · {neighborhood}" (e.g., "Catálogo · Washington Heights")
- Display: "Hola, {firstName}." — single line, semibold, tight tracking, no italic.
- Subtitle: "Elegí lo que te hace falta. Entrega directa a tu puerta."
- Horizontal-scrolling chip row: "Todos" + each category. Active chip is yellow with dark text; inactive is bordered with muted text.

**Product list** — each row:
- 80×80 square image with light gray fill (`bg-paper-deep`) + 15% ink border. If no image: shows first 3 letters of product name in muted small uppercase (e.g., "GAR" for Garrafón).
- Top-left of image: an OFERTA badge (yellow with dark uppercase text) when an offer is active.
- Right side: name (18px semibold), description (13px ink-soft, 2-line clamp), price block.
- Price block: small uppercase eyebrow "Unidad", then big tabular-numbers price. If on offer: original strike-through price + new price side by side.
- Action: a thin **outlined** AGREGAR button (border + transparent fill + ink text). When quantity > 0, it transforms into a tri-element: minus button, count, plus button. **The AGREGAR is intentionally muted** — yellow CTAs are reserved for the checkout, not for every row.

**Sticky cart bar** (appears at bottom only when items in cart):
- Floats above the tab bar.
- `bg-ink` (dark) with `text-paper` content.
- Left: count badge (small yellow square, dark number) + "EN CARRITO" label.
- Below count: total in big tabular-numbers, white.
- Right: yellow CTA "IR AL CHECKOUT →" with dark text.

**Pull to refresh**: yes. Loading indicator is brand purple.

### 4.5 Checkout flow

A single scrollable screen with 5 numbered sections. Each section header is an italic accent number ("01", "02", "03"...) next to a step title, like a magazine spread.

**Sections**:
1. **Lista de compra** — items in cart with thumbnails, names, qty, line totals. Editable count or remove. If a product is on offer, line price is shown in brand color (was yellow, now purple).
2. **Dirección de entrega** — read-only display of the saved default address. "Cambiar →" link reroutes to address selection (not in scope here).
3. **Método de pago** — two large radio tiles side by side: "Efectivo" and "Digital". Active tile is filled with `bg-ink` and white label; inactive is bordered. Below: a small explanatory line about each.
4. **Puntos & Crédito** — two toggle rows. "Usar puntos" shows the available claimable amount; "Usar crédito" shows the available credit balance. Each toggle has a checkmark in brand purple when active. Below the toggles: a recomputed price preview.
5. **Resumen** — itemized list:
   - Subtotal: $X.XX
   - Puntos aplicados: −$X.XX (if any)
   - Crédito aplicado: −$X.XX (if any)
   - Envío: "A cotizar" if order will be quoted server-side
   - Tax (8.887%): "A calcular"
   - **Total estimado**: big number, brand purple
   - CTA: "Confirmar pedido →" (full-width yellow accent button with dark text)

After confirm: order is created in `pending_quote` state. The user is taken to the order detail page (Pedidos > detalle).

### 4.6 Pedidos (Orders)

**Index** — chronological list. Each row:
- Date (small)
- Order number / short id
- Item summary ("3 productos · Garrafón 2.5gal +2 más")
- Total ($X.XX)
- Status badge (see Status System below)

Tap a row → order detail.

**Detail** — read-only page with:
- Header: order id, date, status badge.
- Section "Pedido": item list with quantities and unit prices.
- Section "Entrega": delivery address.
- Section "Pago": method, breakdown (subtotal / shipping / tax / points / credit / total). If order is quoted, all numbers are real; if not yet quoted, shipping and tax show "Pendiente de cotización" in muted style.
- Action footer (varies by status):
  - `pending_quote` / `quoted`: "Cancelar pedido" button (red outline)
  - `quoted` (digital payment): "Autorizar pago →" yellow accent button
  - `delivered`: "Ver factura →" link

### 4.7 Crédito

**Purpose**: A buy-now-pay-later account managed by the operator. Customers can borrow up to a limit set by admin and repay via Stripe.

**Empty state** (no credit account): "Aún no tenés crédito asignado." — minimal, encouraging.

**Active state — header card area**:
- 4 metric cards in a 2×2 grid: **Disponible** ($X), **Saldo** ($X — can be negative if owed), **Límite** ($X), **Vencimiento** (date).
- If overdue: a red banner above the cards, "Cuenta bloqueada — saldá tu deuda para seguir usando la app".
- Primary CTA below cards (only if balance owed > 0): "Pagar ahora →" yellow accent → routes to credit-pay screen.

**Movement ledger** below: scrollable list of every charge, payment, grant, adjustment. Each entry: date, type tag, optional note, amount (color-coded — green for credits to user, red for charges).

**Credit lockout**: when account is overdue + balance owed, the app FORCES the user to credit-pay screen on every navigation. Allowlist: login screen, credit-pay screen. Lockout banner is the only way out.

**credit-pay screen** (separate, modal-style):
- Eyebrow: "Pago de crédito"
- Display: "Saldar mi *deuda*."
- Amount due, breakdown.
- Stripe Payment Sheet trigger.
- On success: confirmation animation, return to Crédito tab.

### 4.8 Cuenta (Profile)

**Identity block**: 64×64 dark square with the user's first initial in white, semibold. To the right: full name, phone in muted style.

**Sections**:
- Eyebrow + value pairs: "Rol", "Teléfono", "Dirección por defecto".
- Hairline divider.
- "Mi actividad" section (clients only): tappable rows with SF Symbols and chevrons → "Puntos" and "Suscripción".
- Hairline divider.
- "Cerrar sesión →" outlined button at the bottom.

### 4.9 Puntos (loyalty — accessed via Cuenta)

**Purpose**: Earn 1 point per $1 spent on delivered orders. Points have a 90-day waiting period before becoming claimable, then a 180-day expiration window.

**Layout**:
- 4 small cards at top: **Disponibles**, **Pendientes**, **Canjeados**, **Vencidos**. Each shows the dollar-equivalent.
- Below: a chronological ledger. Each row shows entry type (Ganados/Canjeados/Vencidos), date, amount, and the activation/expiration date in fine print.
- Status labels: Disponible (green dot), Pendiente (amber dot), Canjeado (gray), Vencido (red).

**No manual claim button** — points auto-transition by date.

### 4.10 Suscripción (accessed via Cuenta)

**Purpose**: Monthly subscription that grants free shipping on every order. Single-tier, single-price.

**Layout**: Single hero card.
- Eyebrow: "Mi *suscripción*."
- States:
  - **Sin suscripción**: "Suscribite por $X/mes y obtené envío gratis siempre." CTA: "Activar suscripción →"
  - **Activa**: large green status pill, "Activa", below it: "Renueva el {date}". Buttons: "Administrar pago", "Cancelar".
  - **Activa con cancelación programada**: amber pill "Activa hasta {endDate}". Button: "Reactivar suscripción".
  - **Vencida** (`past_due`): red pill "Pago fallido — Actualizá tu método para continuar". Button: "Actualizar pago".

Subscribe / manage flows are externalized to **Stripe-hosted portal** (deeplink out, deeplink back). The app reflects the new state on return.

---

## 5. Mobile App — Promoter Experience

Promoters are people who recommend ZAZ in exchange for a 10% commission on referred customers' delivered orders.

### 5.1 Promoter tab bar (4 tabs)
**Catálogo · Pedidos · Puntos · Cuenta** — same as client minus Inicio and Crédito; promoters can still place orders. Promoter-specific dashboard is accessed via a "Promotor" entry inside Cuenta or via a dedicated landing.

### 5.2 Promoter dashboard (`(promoter)/index.tsx`)

**Header**:
- Eyebrow: "Programa Promotor"
- Display: "Tu *equipo*." (or similar)
- 3 metric cards: **Comisiones disponibles**, **Comisiones pendientes**, **Total pagado**.

**Referral block**:
- Eyebrow: "Tu código"
- Code displayed in big tabular-numbers (e.g., `K7F3LM91`)
- Two buttons: "Copiar código", "Compartir link" (uses native share sheet, includes `https://zaz.com/r/{code}`).
- Below: small caption "Cuando alguien usa tu código y le entregamos su pedido, ganás 10%."

**Referidos table**: list of customers who signed up with the promoter's code. Each row: customer first name (privacy), order count, total spent, commission earned. If they haven't ordered yet: "Aún no pidió" in muted.

**Recent commissions**: 5 most recent commission entries with date, customer, amount, status pill (Pendiente / Disponible / Pagada).

**Recent payouts**: 5 most recent payout entries — when admin paid the promoter, how much, and when.

**Action**: "Solicitar pago" button (only if claimable balance > 0). Triggers admin notification; payout is processed manually.

### 5.3 `/r/{code}` referral landing (web + deeplink to mobile)

A simple shareable URL. When opened:
- **On phone**: deeplinks into the mobile app's login screen with the referral code prefilled.
- **In browser**: shows a one-screen landing — promoter's first name, lightning bolt visual, "Te invito a usar ZAZ" message, big CTA "Crear mi cuenta →" that takes them to login with the code attached.

### 5.4 Comisiones (full list)
Paginated, filterable. Filter chips: **Todas / Disponibles / Pendientes / Pagadas**. Each row: date, customer, order id, commission amount, claimable date, status.

### 5.5 Pagos (payouts history)
Read-only chronological list. Each row: date, amount, who issued it (admin name), method note.

---

## 6. Web Admin (Super Admin Only)

The web admin lives at the root domain (e.g., `app.zaz.com`). Super admins log in with their phone OTP just like clients. After login, non-super-admin users are redirected away.

### 6.1 Top navigation
A persistent horizontal bar with the ZAZ wordmark on the left (subtle yellow dot before "AGUA · NEW YORK" eyebrow) and 6 nav links on the right:
**Ruta · Productos · Categorías · Promotores · Crédito · Reparto** + "Salir" log out button.

The active link has a thin yellow underline (this is one of the rare valid uses of `bg-accent` as visual decoration — but applied as a 2px underline, not a fill).

### 6.2 Ruta (Routes / Orders queue)

**Purpose**: The super admin's primary workspace — the live queue of orders that need action.

**Page layout**:
- Eyebrow: "Panel · Reparto"
- Display: "*Hoy*."
- Subtitle: "{n} pedidos pendientes · {n} en ruta · {n} entregados"
- 4 small KPI cards: **Por cotizar**, **Por confirmar**, **En ruta**, **Entregados hoy**.
- Below: a search bar ("Buscar por cliente, colmado o dirección...") and a dense table of orders.

**Orders table columns**:
| Fecha | Cliente | Dirección | Lista de compra | Ruta | Pago | Total | Estado | Acciones |

- **Fecha**: date + time, monospaced numerals.
- **Cliente**: full name in semibold.
- **Dirección**: full address, soft text.
- **Lista de compra**: bulleted item list (e.g., "1× Garrafón 2.5gal · 1× Galón Planeta Azul 5gal").
- **Ruta**: two small bordered chips "Maps ↗" and "Waze ↗" — open driving directions to the address.
- **Pago**: muted uppercase: "Efectivo" or "Digital".
- **Total**: tabular-numbers price + subscription badge if customer was a subscriber at quote time.
- **Estado**: status pill (see Status System below).
- **Acciones** (varies by status):
  - `pending_quote`: yellow CTA button "Cotizar →" → opens QuoteDrawer.
  - `pending_validation`: dark CTA "Confirmar pedido".
  - `confirmed_by_colmado`: dark CTA "Salir a entregar".
  - `in_delivery_route`: dark CTA "Marcar entregado".
  - `delivered`: brand-purple link "Ver factura ↗".
  - any active: secondary "Cancelar" link in muted red.

**Quote drawer** (right-side slide-over):
- Header: order id, customer name, address.
- Read-only summary: subtotal, points redeemed, credit applied.
- Editable: shipping in USD (input). Live preview recalculates tax and total below.
- If customer has active subscription: shipping field is locked at $0 with a small "Suscriptor — envío gratis" badge.
- Footer: "Cotizar →" submit (brand purple), "Cancelar" ghost.

### 6.3 Productos (Products)

**Index**: vertical card list. Each card:
- Left: 96×96 image (or "SIN FOTO" placeholder).
- Middle: product name (semibold), category chip with emoji, price (with strike-through and offer price if active), stock, commission %, points %.
- Right: 3 actions — "Disponible" toggle (status pill), "Editar" (dark button), "Borrar" (ghost link).
- Top-right page action: "+ Nuevo producto" — yellow accent CTA with dark text.

**Editor (modal or inline)**:
- Image uploader with drag-drop.
- Name, description, category dropdown.
- Pricing: base price (USD), offer price + offer label + offer date range (optional).
- Stock count.
- Commission %, points %.
- Submit / cancel.

### 6.4 Categorías

Same pattern as Productos: list of category cards, "+ Nueva categoría" CTA. Each category has: emoji picker, name, slug (auto), display order, optional cover image.

### 6.5 Crédito (admin)

**Index — `/super/credit`**:
- All users in the system (with or without credit accounts), search bar, filter chips (Sin deuda · Al día · Vencido).
- Each row: avatar/initial, name, phone, status pill, balance, due date.
- Click row → user detail page.
- Header CTA: "+ Nueva cuenta" — opens user picker modal.

**User detail — `/super/credit/{userId}`**:
- Header: user identity, big balance number, status pill.
- 4 metric cards: Saldo, Disponible, Límite, Vencimiento.
- Action row: 5 buttons in a horizontal strip:
  - **Otorgar crédito** (grant)
  - **Aceptar pago** (record payment received off-platform)
  - **Ajustar límite** (change limit)
  - **Ajuste manual** (positive or negative ledger adjustment)
  - **Devolver pago** (refund — only on delivered orders)
- Each button opens an inline form drawer with the relevant fields.
- Movement ledger below: every entry typed and timestamped.

### 6.6 Promotores (admin)

**Index — `/super/promoters`**:
- List of all promoters: name, phone, status (Activo / Pendiente / Suspendido), referral count, total commissions earned.
- Per-row action: "Ver detalle".

**Detail — `/super/promoters/{id}`**:
- Promoter identity.
- Referral stats summary.
- Referred customers table.
- Commissions ledger (pendiente / disponible / pagada).
- Payouts history.
- Action drawer: "Pagar comisión" (specify amount + method note + submit).

### 6.7 Reparto (Delivery profile)

The super admin's own profile page. Identity block, role badge, store/business address (used for shipping distance calc), Stripe connect status, logout.

---

## 7. Order Status State Machine

Every order moves through this graph. The status badge color and label are consistent across mobile and web.

```
[CREATED]
    ↓
PENDING_QUOTE      "Por cotizar"      amber dot, pulse
    ↓ (admin sets shipping)
QUOTED             "Cotizado"         yellow dot, pulse
    ↓ (customer authorizes Stripe OR confirms cash)
PENDING_VALIDATION "Pendiente"        amber dot
    ↓ (admin confirms — stock decremented)
CONFIRMED_BY_COLMADO "Confirmado"     purple dot
    ↓ (admin marks "salir a entregar")
IN_DELIVERY_ROUTE  "En ruta"          yellow dot, pulse
    ↓ (admin marks delivered — Stripe captures)
DELIVERED          "Entregado"        green dot
```

**Cancellation**: any of the first 5 states can transition to CANCELLED. Customer-initiated cancellation is allowed only on PENDING_QUOTE, QUOTED, PENDING_VALIDATION. Admin can cancel from any.

**Visual treatment of the badge**: a small bordered pill with a colored dot, a 10–11px uppercase label, and the colored text matching the dot. Pulsing animation on dots for "active waiting" states (pending_quote, quoted, in_delivery_route).

---

## 8. Pricing & Money Logic

This logic must be visible in the UI; never hide it.

### 8.1 Price computation order
1. **Subtotal** = sum of (item qty × effective unit price). Effective price = offer price if an active offer is in date range, else base price.
2. **Points discount** = if user toggled "Usar puntos", subtract claimable balance up to subtotal.
3. **Credit applied** = if user toggled "Usar crédito" AND user is a CLIENT (not promoter), subtract available credit on the remainder.
4. **Shipping** = admin-set during quote step. $0 if user is an active subscriber.
5. **Tax** = 8.887% × (subtotal + shipping − points). Note: tax base does NOT subtract credit.
6. **Total** = taxable amount + tax. The customer owes this total minus credit applied.

### 8.2 Display rules
- All money: USD, format `$X.XX`, tabular numerals.
- Shipping shown as "A cotizar" (italics, muted) until quote.
- Tax shown as "A calcular" (italics, muted) until quote.
- Discounted prices: original price strikethrough next to new price; new price in `text-ink` (high contrast — never yellow).
- Negative ledger entries (refunds, charges to user) shown in `text-bad` color with a "−" prefix.
- Positive ledger entries (grants, payments received) shown in `text-ok` with a "+" prefix.

---

## 9. Critical Flows

### 9.1 Flow: First-time customer signup → first delivery
1. User opens app → sees auth poster ("Bienvenido de vuelta. 01") → enters phone.
2. SMS arrives → user enters 6-digit code.
3. Server detects "primer ingreso" → app reveals an inline name field with brand-purple accent border. User enters first + last name.
4. (If signed up via `/r/{code}`) Referral code pill is displayed above the form.
5. Submit → routed to home (Inicio) tab.
6. User taps a category → catalog filtered.
7. User taps AGREGAR on items → cart sticky bar appears.
8. User taps IR AL CHECKOUT → 5-step checkout.
9. User selects address (default), payment (digital), toggles points (off), confirms.
10. Order created in `PENDING_QUOTE`. User sees order detail with "esperando cotización" muted message.
11. Admin reviews on web → sets shipping → order moves to `QUOTED`.
12. Customer receives push/SMS notification → opens app → order detail now shows full breakdown including shipping, tax, total.
13. (Digital payment) Customer taps "Autorizar pago →" → Stripe Payment Sheet opens → authorizes → order moves to `PENDING_VALIDATION`.
14. Admin confirms → CONFIRMED_BY_COLMADO. Stock decremented.
15. Admin marks "Salir a entregar" → IN_DELIVERY_ROUTE.
16. Driver delivers → admin marks "Marcar entregado" → DELIVERED. Stripe captures the authorization. Customer's points (subtotal × points-rate) enter the 90-day pending window.

### 9.2 Flow: Subscriber places order
Same as 9.1 but at step 11 the admin's quote drawer auto-locks shipping at $0 with a "Suscriptor — envío gratis" badge. Tax is still calculated on subtotal.

### 9.3 Flow: Customer pays credit balance
1. Credit-locked customer opens app → forced redirect to credit-pay screen on every navigation attempt.
2. Customer reviews amount due.
3. Taps "Pagar →" → Stripe Payment Sheet.
4. Successful payment → backend records ledger entry → account unlocked instantly → customer can navigate normally.

### 9.4 Flow: Promoter earns first commission
1. Promoter shares their `/r/{code}` link via WhatsApp/Instagram.
2. New friend opens link → lands on `/r/{code}` page → taps "Crear mi cuenta".
3. Friend signs up → referral code attached to their account.
4. Friend places first order → flows through normal lifecycle to DELIVERED.
5. On delivery: backend creates a commission entry (10% of order subtotal) in `pending` state for the promoter.
6. 90 days later: commission auto-transitions to `claimable`. Promoter sees their balance update.
7. Promoter requests payout → admin sees the request → manually issues payment → ledger marked `paid`.

### 9.5 Flow: Admin starts the day
1. Admin logs in to web.
2. Lands on Ruta page. Sees today's KPI cards.
3. Filters orders by `pending_quote` → opens each → sets shipping based on distance → quotes.
4. Refreshes; new orders move to `quoted`.
5. Customers authorize → moves to `pending_validation`.
6. Admin batches confirmation → all in `confirmed_by_colmado`.
7. Admin or driver marks "Salir a entregar" when leaving.
8. As deliveries complete → marks "Marcar entregado" → Stripe captures, points pending, commissions pending.
9. End of day: KPI shows X delivered, Y in route still open, Z to confirm tomorrow.

---

## 10. Interaction Patterns & Components

### 10.1 Buttons
Four variants. Square corners (2px radius — `rounded-xs`), uppercase tracked labels, no shadows, no rounded-pill exceptions:

| Variant | Background | Text | Use case |
|---|---|---|---|
| **Accent** (primary CTA) | `bg-accent` (yellow) | `text-brand-dark` | Main action of a screen — submit, confirm, place order |
| **Ink** (alternate primary) | `bg-ink` (near-black) | `text-paper` (white) | Secondary primary — admin actions, filters |
| **Outline** | transparent + border | `text-ink` | Secondary actions in catalog/cards |
| **Ghost** | transparent | `text-ink` | Tertiary, "Cancelar", in-row actions |

Sizes: `md` (h-12), `lg` (h-14). Loading state shows a centered spinner in the contrasting color.

### 10.2 Status badges
Always: thin border + 10% colored fill bg + colored dot + uppercase label. Border opacity 40%, bg opacity 10%, text full color. Animated dots (pulse) on "actively waiting" states.

### 10.3 Eyebrow + Display + Subtitle pattern
The signature opening of almost every page:
```
EYEBROW · CONTEXT          (11px uppercase tracking-eyebrow, ink-muted)
Big display headline.       (36-44px semibold ink, optional italic accent word)
Subtitle in soft ink.       (15px ink-soft)
```

### 10.4 Hairlines
1px dividers using `bg-ink/15` (15% opacity ink). Used between sections, list items, after page headers. Never use double lines or boxed cards within the same surface.

### 10.5 Cards
Bordered (1px ink/15) on `bg-paper` for the default. Elevated cards use `bg-paper-deep` without a border. No shadows in this design system — depth comes from color step, not blur.

### 10.6 Forms
Field structure:
```
LABEL (uppercase eyebrow, 11px, ink-muted)
[input value here, bottom-border only, no full box]
─────────────────────────────────────
Error message in red below if invalid
```

Inputs are minimal — bottom border only (1px ink/25). Focus ring is 2px ink with 2px offset. Placeholder color is `ink-muted`.

### 10.7 Empty states
Compact, centered, encouraging:
- Eyebrow: "Catálogo vacío"
- Subtitle: "No hay productos disponibles ahora mismo."
- Optional CTA if action is possible.

No illustrations or mascots — pure typography.

### 10.8 Loading
Spinner color: `brand` (purple) in light theme. Position: centered in the screen for full-page loads. Inline within rows for granular operations.

---

## 11. Tech Reality Constraints (info only)

- **Mobile**: Expo SDK 55 (React Native, NativeWind v5). Spanish-only. iOS-first, Android second. No tablet design.
- **Web admin**: React 19 + Vite + TanStack Router + Tailwind v4. Desktop-first (operator works on a laptop or large monitor). Tablet-acceptable, mobile-web is secondary.
- **Backend**: NestJS, Postgres, Stripe (manual capture), Twilio (SMS OTP), single-tenant.
- **Status updates** are not real-time; they require pull-to-refresh or polling.
- **Bilingual support is NOT a current requirement** — Spanish only.

---

## 12. Out of Scope (do not design for these)

- Multi-tenant operator selection (currently one ZAZ deployment per market).
- Multi-currency (USD only).
- English UI.
- Tablet / iPad layouts.
- Map-based zone editor for shipping fees.
- Real-time order tracking (driver location on a map).
- In-app chat with delivery driver.
- Product reviews / ratings.
- Cart sharing.
- Wishlist / favorites.

---

## 13. Glossary

- **Colmado**: Spanish-speaking term for a small neighborhood grocery store; the cultural anchor of the brand.
- **Promotor**: a user who refers others in exchange for commission.
- **Suscriptor**: an active subscriber.
- **Cotizar**: to quote (set the shipping price for an order).
- **Saldar**: to pay off (a credit balance).
- **Botellón**: a 5L water bottle, common product type.
- **Garrafón**: a 2.5gal returnable water jug.
- **Eyebrow**: in this design system, the small uppercase label above a heading.
- **Hairline**: a 1-pixel divider.

---

## 14. Open Design Questions for the New Design Pass

The design agent should explicitly answer these in the proposed design:

1. **Order tracking visualization**: today the status is shown as a single badge. Should the new design include a horizontal stepper showing the full lifecycle (pending → quoted → confirmed → in route → delivered) with the current step highlighted? Mobile and web?
2. **Catalog density**: the current row layout shows 1 product per row. Should we offer a 2-up grid view toggle for users who scroll long catalogs?
3. **Cart sticky bar**: currently dark on light. Does it have enough prominence? Should there be a "review before checkout" intermediate sheet?
4. **Empty Inicio when no orders yet**: the current home is just category cards. Should first-time users see an onboarding banner ("Pedí tu primera entrega en 2 minutos") that disappears after the first order?
5. **Web admin density**: the current super admin Ruta page is one big table. Should it be split into kanban-style columns (Por cotizar / Por confirmar / En ruta / Hoy entregados) for faster eyeballing?
6. **Promoter share assets**: when a promoter taps "Compartir link", the share sheet sends a plain URL. Should there be a generated share card (image + branded text) for WhatsApp/Instagram?
7. **Receipt / invoice**: today the invoice is a basic web page. Should the design include a printable / PDF-style invoice layout?

---

**End of spec.**

This document is intentionally exhaustive on what exists today. The new design should preserve all functionality and flows but is free to reinterpret hierarchy, density, and visual treatment. The brand, voice, and the four-token color discipline are non-negotiable.
