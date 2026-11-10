# Catálogo mayorista para asociados — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The admin sets a fixed wholesale price on any one-time-payment product; users with role `associate` see only those products at that price, can buy nothing else, can't take a subscription, and their orders don't feed the pool.

**Architecture:** One nullable column `products.associate_price_cents` is the whole list (null = not offered). The API decides everything server-side: `GET /products` filters and re-prices for associates, both charging paths (`orders.service.create`, `payments.service.createIntentForItems`) enforce and price through `getEffectivePrice({ isAssociate })`, and `orders.associate_pricing` freezes the decision for the pool. Web and mobile only add the admin field, hide bebedero entry points for associates, and key the catalog cache by role — no client-side pricing logic.

**Tech Stack:** NestJS 11 + TypeORM + Postgres (Jest), React + TanStack Router/Query (Vitest), Expo Router + i18next (Jest).

**Spec:** `docs/superpowers/specs/2026-11-10-catalogo-asociados-design.md`

## Global Constraints

- Work in the worktree `/Users/jeremypolanco/Documents/work/Colmapp-worktrees/pool-asociados`, branch `feat/catalogo-asociados`. Never touch `/Users/jeremypolanco/Documents/work/Colmapp` (another branch with uncommitted work).
- Do NOT use the codegraph MCP tool: its index points at an older checkout. Use grep/Read in the worktree.
- dashgo-api: NEVER run `npm run lint` (it is `eslint --fix` and rewrites 100+ files). Verify with `npm test` and `npm run build`.
- Jest: put the test path BEFORE `--selectProjects` (it is variadic and swallows a trailing path). Unit: `npx jest <path> --selectProjects unit`. Integration: `npx jest <path> --selectProjects integration --runInBand`.
- Integration specs: `jest.mock('stripe')` (copy `test/integration/associate-checkout.integration-spec.ts`), one shared DB with no truncation — create and clean your own rows, assert by ids, run the spec 2–3× before trusting green.
- Web: verify with `npm test` and `npm run build` (`tsc -b && vite build`), not `tsc --noEmit`. No new routes → `routeTree.gen.ts` untouched.
- Mobile: every new CLIENT-facing string goes in BOTH `src/i18n/locales/es/<ns>.ts` and `en/<ns>.ts` (ES is source; tests assert Spanish). Admin screens (`app/(super)/*`) are plain Spanish, not i18n.
- Web and mobile `lib/associate.ts` are mirrors: identical function names and bodies.
- Copy (exact): error `Este producto no está disponible para asociados`; `Solo los productos de pago único pueden tener precio para asociados`; `Los asociados no pueden contratar la suscripción`; admin label `Precio para asociados (opcional)`; placeholder `Vacío = no se ofrece a asociados`; help `Precio mayorista fijo. Los asociados solo ven los productos que tienen este precio.`; list tag `Asociados $X.XX`; form error `Ingresa un precio mayor a 0`; associate empty catalog `Todavía no hay productos disponibles para asociados.` (en: `There are no products available for associates yet.`).
- Error codes: `PRODUCT_NOT_AVAILABLE_FOR_ASSOCIATES` (400), `ASSOCIATE_PRICE_NOT_ALLOWED` (400), `ASSOCIATE_CANNOT_SUBSCRIBE` (403).
- Commits: Conventional Commits in Spanish like the repo history, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Admin types a Spanish decimal (`4,50`) in the associate price — `parseFloat` would silently save $4.00; expect $4.50. → Task 6 test (shared helper, mirrored in Task 8).
2. An associate's locally persisted cart holds a product that was removed from the list (or added before they became an associate) — expect checkout to show `Este producto no está disponible para asociados`, not a generic error. → Task 7 test.
3. An associate pays with pool balance on a wholesale order — expect the Stripe intent and the order to compute the same total from the wholesale subtotal. → Task 5 test.
4. Admin converts a product with an associate price into a rental — expect the save to succeed and the associate price to be cleared, not a blocked form. → Task 6 test.
5. An associate opens `/subscription` directly (bookmark, old link) — expect the page to show `Los asociados no pueden contratar la suscripción` from the API. → Task 7 test.

---

### Task 1: Schema, role helper and pricing rule (API)

**Files:**
- Create: `dashgo-api/src/database/migrations/1815000000000-AssociateWholesaleCatalog.ts`
- Create: `dashgo-api/src/modules/products/associate-catalog.ts`, `dashgo-api/src/modules/products/associate-catalog.spec.ts`
- Modify: `dashgo-api/src/entities/product.entity.ts` (next to `subscriberPriceCents`, ~126), `dashgo-api/src/entities/order.entity.ts` (next to `provisioned`, ~260), `dashgo-api/src/common/roles.ts`, `dashgo-api/src/modules/products/pricing.ts`
- Test: `dashgo-api/src/modules/products/pricing.spec.ts`

**Interfaces:**
- Produces:
  - `Product.associatePriceCents: number | null` (column `associate_price_cents`, integer, nullable).
  - `Order.associatePricing: boolean` (column `associate_pricing`, boolean, default false).
  - `isAssociate(role: UserRole | null | undefined): boolean` in `src/common/roles.ts`.
  - `EffectivePriceOptions.isAssociate?: boolean`; `decorateProduct(product, now?, opts?: EffectivePriceOptions)`.
  - In `associate-catalog.ts`: `canCarryAssociatePrice(p: Pick<Product, 'pricingMode' | 'isMaintenanceService' | 'isDefaultSubscriberBebedero' | 'isPremiumSubscriberProduct'>): boolean` and `assertAssociateCart(products: Array<Pick<Product, 'associatePriceCents'>>): void`.

- [ ] **Step 1: Write the failing tests**

In `pricing.spec.ts` (build products with the file's `mkProduct` plus explicit `priceToPublic`):
```ts
it('associate pays the fixed associate price, ignoring an active offer and the subscriber price', () => {
  const p = mkProduct({ priceToPublic: '10.00', offerDiscountPct: '50', offerStartsAt: null, offerEndsAt: null,
    subscriberPriceCents: 300, associatePriceCents: 650 });
  expect(getEffectivePrice(p, new Date(), { isAssociate: true, isSubscriber: true })).toEqual({
    priceCents: 650, basePriceCents: 650, discountPct: null, offerActive: false, subscriberPriceApplied: false });
});
it('non-associate never gets the associate price', () => {
  const p = mkProduct({ priceToPublic: '10.00', associatePriceCents: 650 });
  expect(getEffectivePrice(p, new Date(), {}).priceCents).toBe(1000);
});
it('associate flag without an associate price falls back to the public rules', () => {
  const p = mkProduct({ priceToPublic: '10.00', associatePriceCents: null });
  expect(getEffectivePrice(p, new Date(), { isAssociate: true }).priceCents).toBe(1000);
});
```
In `associate-catalog.spec.ts`:
- `canCarryAssociatePrice` is true for `{ pricingMode: 'single_payment', all flags false }` and false for each of: `pricingMode: 'rental'`, `isMaintenanceService: true`, `isDefaultSubscriberBebedero: true`, `isPremiumSubscriberProduct: true`.
- `assertAssociateCart([{ associatePriceCents: 500 }])` does not throw; `assertAssociateCart([{ associatePriceCents: 500 }, { associatePriceCents: null }])` throws `BadRequestException` whose `getResponse()` equals `{ code: 'PRODUCT_NOT_AVAILABLE_FOR_ASSOCIATES', message: 'Este producto no está disponible para asociados' }`.
- `isAssociate(UserRole.ASSOCIATE)` true; `isAssociate(UserRole.CLIENT)`, `isAssociate(null)` false (put this in the same spec or a `roles.spec.ts`).

- [ ] **Step 2: Run them to verify they fail**

Run: `cd dashgo-api && npx jest src/modules/products/pricing.spec.ts src/modules/products/associate-catalog.spec.ts --selectProjects unit`
Expected: FAIL (`associatePriceCents` not on Product / module not found).

- [ ] **Step 3: Implement**

- Entities: copy the `subscriberPriceCents` / `provisioned` column pattern, with a short Spanish doc comment (null = no se ofrece a asociados; associate_pricing congela que la orden se vendió a precio mayorista).
- Migration `AssociateWholesaleCatalog1815000000000` (copy `1799000000000-AddProductSubscriberPrice.ts`): add `products.associate_price_cents integer` + constraint `CHK_products_associate_price_positive` `CHECK ("associate_price_cents" IS NULL OR "associate_price_cents" > 0)`; add `orders.associate_pricing boolean NOT NULL DEFAULT false`. `down()` drops the constraint and both columns. One `queryRunner.query` per statement, `IF [NOT] EXISTS` guards.
- `getEffectivePrice`: when `opts.isAssociate && product.associatePriceCents != null`, return the associate price as both `priceCents` and `basePriceCents`, before any offer/subscriber logic. `decorateProduct` forwards `opts`.

- [ ] **Step 4: Run them to verify they pass**

Run: same command as Step 2. Expected: PASS.

- [ ] **Step 5: Run the full unit suite and the build**

Run: `cd dashgo-api && npm test && npm run build`
Expected: all suites pass, build exits 0.

- [ ] **Step 6: Commit**

```bash
git add dashgo-api/src/database/migrations/1815000000000-AssociateWholesaleCatalog.ts dashgo-api/src/entities/product.entity.ts dashgo-api/src/entities/order.entity.ts dashgo-api/src/common/roles.ts dashgo-api/src/modules/products/pricing.ts dashgo-api/src/modules/products/pricing.spec.ts dashgo-api/src/modules/products/associate-catalog.ts dashgo-api/src/modules/products/associate-catalog.spec.ts
git commit -m "feat(products): precio mayorista para asociados en el modelo y en getEffectivePrice"
```

### Task 2: Admin API and the catalog each viewer sees

**Files:**
- Modify: `dashgo-api/src/modules/products/dto/create-product.dto.ts`, `dto/update-product.dto.ts` (both standalone; field next to `subscriberPriceCents`), `dashgo-api/src/modules/products/products.service.ts` (`findAllPublic` 68-98, `create` ~226, `update` ~302, `toClient` ~565)
- Test: `dashgo-api/src/modules/products/products.service.spec.ts`; create `dashgo-api/src/modules/products/dto/update-product.dto.spec.ts`

**Interfaces:**
- Consumes: Task 1 (`associatePriceCents`, `isAssociate`, `canCarryAssociatePrice`, `decorateProduct(…, opts)`).
- Produces: `findAllPublic(viewer)` return type omits `'promoterCommissionPct' | 'pointsPct' | 'associatePriceCents'`. `GET /products/admin` keeps `associatePriceCents`.

- [ ] **Step 1: Write the failing tests** (use the spec's `fakeProduct`, `makeRepoMock`, and the existing `findAllPublic` call style)

- `findAllPublic as guest and as client never includes associatePriceCents` — products with and without an associate price; assert every item `not.toHaveProperty('associatePriceCents')` and both products are returned for the client.
- `associate sees only products with an associate price, priced at it` — rows: A (`priceToPublic '10.00'`, active offer 50%, `subscriberPriceCents 300`, `associatePriceCents 650`), B (no associate price). Viewer `{ role: UserRole.ASSOCIATE, sellerId: null }`. Expect exactly `[A]` with `effectivePriceCents 650`, `basePriceCents 650`, `offerActive false`, `subscriberPriceCents null`, `offerLabel null`, `offerDiscountPct null`, `offerStartsAt null`, `offerEndsAt null`.
- `associate with a seller ignores the seller catalog` — viewer has `sellerId`; seller catalog contains only B; expect `[A]` and `sellerProducts.find` not called.
- `associate with an empty list gets an empty catalog` — no product has an associate price → `[]`.
- `create rejects an associate price on a rental` — dto `{ pricingMode: 'rental', associatePriceCents: 500, … }` → `BadRequestException` with code `ASSOCIATE_PRICE_NOT_ALLOWED`, `products.save` not called. Same for `isMaintenanceService: true`.
- `update sets and clears the associate price` — `{ associatePriceCents: 450 }` → `products.update` called with `expect.objectContaining({ associatePriceCents: 450 })`; `{ associatePriceCents: null }` → `associatePriceCents: null`; omitted → key absent from the patch.
- `update rejects a final state that is a rental with an associate price` — existing product has `associatePriceCents 500`, dto `{ pricingMode: 'rental' }` → code `ASSOCIATE_PRICE_NOT_ALLOWED`; but dto `{ pricingMode: 'rental', associatePriceCents: null }` succeeds.
- DTO spec: `validate(plainToInstance(UpdateProductDto, { associatePriceCents: 0 }))` has an error on `associatePriceCents`; `450` and `null` have none.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd dashgo-api && npx jest src/modules/products/products.service.spec.ts src/modules/products/dto/update-product.dto.spec.ts --selectProjects unit`
Expected: FAIL.

- [ ] **Step 3: Implement**

- DTOs: `@IsOptional() @IsInt() @Min(1) @Max(1000000) associatePriceCents?: number | null;` in both.
- `create`: persist `dto.associatePriceCents ?? null`; if non-null and `!canCarryAssociatePrice(dto-with-defaults)` → `BadRequestException({ code: 'ASSOCIATE_PRICE_NOT_ALLOWED', message: 'Solo los productos de pago único pueden tener precio para asociados' })` before saving.
- `update`: patch only when `dto.associatePriceCents !== undefined`; validate the merged final state (`{ ...p, ...patch }`) with the same rule and error.
- `findAllPublic`: if `isAssociate(viewer?.role)` → keep rows with `associatePriceCents != null` (skip seller scope), decorate with `{ isAssociate: true }`, and null out `subscriberPriceCents` and the four offer fields. For every viewer, strip `associatePriceCents` alongside `pointsPct` / `promoterCommissionPct`.

- [ ] **Step 4: Run them to verify they pass** — same command. Expected: PASS.

- [ ] **Step 5: Full unit suite + build** — `cd dashgo-api && npm test && npm run build`. Expected: green, exit 0.

- [ ] **Step 6: Commit**

```bash
git add dashgo-api/src/modules/products
git commit -m "feat(products): el admin fija el precio de asociado y el asociado solo ve esa lista"
```

### Task 3: Both charging paths enforce and apply the wholesale price

**Files:**
- Modify: `dashgo-api/src/modules/orders/orders.service.ts` (validation loop 335-350, pricing 556-572, `orderRepo.create` 763-799), `dashgo-api/src/modules/payments/payments.service.ts` (`CreateIntentInput` 31-51, loop 138-151), `dashgo-api/src/modules/payments/payments.controller.ts` (60-75)
- Test: `dashgo-api/src/modules/orders/orders.service.spec.ts` (copy the `setupTx()` harness of `describe('create — per-product subscriber price')` ~2909), `dashgo-api/src/modules/payments/payments.service.spec.ts` (copy the subscriber test 363-391), `dashgo-api/src/modules/payments/payments.controller.spec.ts`

**Interfaces:**
- Consumes: Task 1 (`isAssociate`, `assertAssociateCart`, `getEffectivePrice({ isAssociate })`, `Order.associatePricing`).
- Produces: `CreateIntentInput.role: UserRole` (required); the controller passes `role: user.role`.

- [ ] **Step 1: Write the failing tests**

`orders.service.spec.ts`, new `describe('create — associate wholesale price')`:
- `rejects an associate cart with a product outside the list, writing nothing` — `fakeUser(UserRole.ASSOCIATE)`, products `[fakeProduct({ id: 'p1', associatePriceCents: 500 }), fakeProduct({ id: 'p2', associatePriceCents: null })]` → rejects with code `PRODUCT_NOT_AVAILABLE_FOR_ASSOCIATES`; `dataSource.transaction` not called.
- `charges the associate price and freezes associate_pricing` — product `priceToPublic '10.00'` with an active 50% offer and `associatePriceCents 650`, quantity 3 → `savedItems[0].priceAtOrder === '6.50'`, `savedOrderArg.subtotal` reflects 1950 cents, `savedOrderArg.associatePricing === true`.
- `a client buying the same product pays the offer and associate_pricing is false` → `priceAtOrder '5.00'`, `associatePricing false`.
- `a provisioned system order for an associate is not restricted` — `opts.provisioned = true`, product without associate price → resolves; `associatePricing false`.

`payments.service.spec.ts`, inside `describe('createIntentForItems')`:
- `associate intent uses the associate price` — `makeProduct({ associatePriceCents: 650 })`, quantity 2, `role: UserRole.ASSOCIATE` → `paymentIntents.create` called with `expect.objectContaining({ amount: <1300 + shipping + tax as the existing subscriber test computes it> })`. Derive the expected amount the same way the neighbouring subscriber test does; do not hard-code a guess.
- `associate intent with a product outside the list is rejected before Stripe` → code `PRODUCT_NOT_AVAILABLE_FOR_ASSOCIATES`; `paymentIntents.create` not called.
- Update every existing `createIntentForItems({...})` call in the spec to include `role: UserRole.CLIENT`.

`payments.controller.spec.ts`: the expected call object includes `role: <the request user's role>`.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd dashgo-api && npx jest src/modules/orders/orders.service.spec.ts src/modules/payments --selectProjects unit`
Expected: FAIL.

- [ ] **Step 3: Implement**

- `orders.create`: `const buyerIsAssociate = isAssociate(user.role) && !opts.provisioned;` After the existing existence/availability/stock loop and before any transaction: `if (buyerIsAssociate) assertAssociateCart(<the cart's products>)`. Pass `isAssociate: buyerIsAssociate` to the `getEffectivePrice` call at ~569. Set `associatePricing: buyerIsAssociate` next to `provisioned` in `orderRepo.create`.
- `payments.createIntentForItems`: after the existing loop's checks, `if (isAssociate(input.role)) assertAssociateCart(...)` before any Stripe call; pass `isAssociate` to `getEffectivePrice` at ~148.
- Controller: add `role: user.role`.

- [ ] **Step 4: Run them to verify they pass** — same command. Expected: PASS.

- [ ] **Step 5: Full unit suite + build** — `cd dashgo-api && npm test && npm run build`. Expected: green.

- [ ] **Step 6: Commit**

```bash
git add dashgo-api/src/modules/orders dashgo-api/src/modules/payments
git commit -m "feat(orders): el asociado paga el precio mayorista y no puede comprar fuera de su lista"
```

### Task 4: Pool exclusion and subscription block

**Files:**
- Modify: `dashgo-api/src/modules/pool/pool.service.ts` (`contributeForOrder`, after the order load ~61), `dashgo-api/src/modules/subscription/subscription.service.ts` (`createCheckoutSession` ~212)
- Test: `dashgo-api/test/integration/pool-contributions.integration-spec.ts`, `dashgo-api/src/modules/subscription/subscription.service.spec.ts` (describe `createCheckoutSession plan source (T23)` ~1155)

**Interfaces:**
- Consumes: `Order.associatePricing`, `isAssociate`.

- [ ] **Step 1: Write the failing tests**

- Integration, in `Aportes al pool (integración)`: `una orden vendida a precio de asociado no aporta al pool` — create the order the way the file's first test does but with `associatePricing: true`, deliver it, expect no `pool_contributions` row for that order id and `contributeForOrder` returns 0. Keep a twin with `associatePricing: false` that still contributes (the existing test may already cover it — reuse, don't duplicate).
- Unit: `createCheckoutSession rejects an associate` — user repo returns `{ role: UserRole.ASSOCIATE, … }` → rejects `ForbiddenException` with response `{ code: 'ASSOCIATE_CANNOT_SUBSCRIBE', message: 'Los asociados no pueden contratar la suscripción' }`; Stripe `checkout.sessions.create` not called. A client still gets a session (existing tests stay green).

- [ ] **Step 2: Run them to verify they fail**

Run: `cd dashgo-api && npx jest src/modules/subscription/subscription.service.spec.ts --selectProjects unit` and `npx jest test/integration/pool-contributions.integration-spec.ts --selectProjects integration --runInBand`
Expected: FAIL.

- [ ] **Step 3: Implement**

- `contributeForOrder`: `if (order.associatePricing) return 0;` right after `if (!order) return 0;`.
- `createCheckoutSession`: reject associates (load the user if the method doesn't already) before validating redirects or touching Stripe. Existing subscriptions are untouched: portal, cancel and reactivate are not changed.

- [ ] **Step 4: Run them to verify they pass** — same commands (integration 2–3×). Expected: PASS.

- [ ] **Step 5: Full unit suite + build** — `cd dashgo-api && npm test && npm run build`.

- [ ] **Step 6: Commit**

```bash
git add dashgo-api/src/modules/pool dashgo-api/src/modules/subscription dashgo-api/test/integration/pool-contributions.integration-spec.ts
git commit -m "feat(pool): las compras a precio de asociado no aportan y el asociado no puede suscribirse"
```

### Task 5: End-to-end over HTTP (integration)

**Files:**
- Create: `dashgo-api/test/integration/associate-catalog.integration-spec.ts` (bootstrap, JWT and `jest.mock('stripe')` copied from `associate-checkout.integration-spec.ts`)

**Interfaces:**
- Consumes: everything from Tasks 1–4 through the real HTTP API and migrations.

- [ ] **Step 1: Write the tests** (seed your own users/products with unique names; delete them in `afterAll`)

- `GET /products` — guest and client: no item has `associatePriceCents`; associate: only the priced product, `effectivePriceCents` equals its associate price.
- `POST /orders` as associate with an unpriced product → 400, body `code` `PRODUCT_NOT_AVAILABLE_FOR_ASSOCIATES`, no order row for that user.
- Parity with pool balance (Review Focus 3): give the associate an `associate_balance_entries` ALLOCATION smaller than the wholesale subtotal; `POST /payments/intent` with `usePoints: true` and then `POST /orders` with the same cart, `usePoints: true` and the intent id → the Stripe mock's `amount` equals the order's `totalAmount` in cents, and `orders.associate_pricing` is true.
- `POST /subscription/checkout-session` as associate → 403, `code` `ASSOCIATE_CANNOT_SUBSCRIBE`.

- [ ] **Step 2: Run it** — `cd dashgo-api && npx jest test/integration/associate-catalog.integration-spec.ts --selectProjects integration --runInBand`, three times. Expected: PASS all three.

- [ ] **Step 3: Run the whole integration suite once** — `cd dashgo-api && npm run test:integration`. Expected: green except failures that also fail on `main` (name them in the report if any).

- [ ] **Step 4: Commit**

```bash
git add dashgo-api/test/integration/associate-catalog.integration-spec.ts
git commit -m "test(integración): catálogo, cobro y suscripción del asociado por HTTP"
```

### Task 6: Web — admin field and shared helpers

**Files:**
- Create: `dashgo-web/src/lib/associate.ts`, `dashgo-web/src/lib/associate.test.ts`
- Modify: `dashgo-web/src/lib/types.ts` (Product, after `subscriberPriceCents` ~121), `dashgo-web/src/lib/queries.ts` (`CreateProductInput` ~564), `dashgo-web/src/routes/super.products.tsx` (form state ~78/97/125, init ~238, validation ~324, payload ~371, field UI after the subscriber field ~867-900, list row ~1602-1616)
- Test: `dashgo-web/src/routes/super.products.test.tsx`

**Interfaces:**
- Produces (`lib/associate.ts`, mirrored verbatim in mobile Task 8):
  - `parseAssociatePrice(text: string): { cents: number | null; error: string | null }` — blank/whitespace → `{ cents: null, error: null }`; accepts `,` or `.` as decimal separator; non-finite or `<= 0` → `{ cents: null, error: 'Ingresa un precio mayor a 0' }`; otherwise `Math.round(value * 100)`.
  - `canCarryAssociatePrice(p: { pricingMode?: string | null; isMaintenanceService?: boolean; isDefaultSubscriberBebedero?: boolean; isPremiumSubscriberProduct?: boolean }): boolean` — same rule as the API.
  - `showsSubscriptionEntry(role: UserRole | null | undefined, hasSubscription: boolean): boolean` and `showsRentalsEntry(role: UserRole | null | undefined, hasRentals: boolean): boolean` — false only for an associate without one.
  - `productsQueryKey(role: UserRole | null | undefined): readonly ['products', 'public', string]` — `role ?? 'guest'` as the last segment.
  - `Product.associatePriceCents?: number | null`.

- [ ] **Step 1: Write the failing tests**

`associate.test.ts`:
```ts
expect(parseAssociatePrice('')).toEqual({ cents: null, error: null })
expect(parseAssociatePrice('4.50')).toEqual({ cents: 450, error: null })
expect(parseAssociatePrice('4,50')).toEqual({ cents: 450, error: null })   // Review Focus 1
expect(parseAssociatePrice('0')).toEqual({ cents: null, error: 'Ingresa un precio mayor a 0' })
expect(parseAssociatePrice('abc').error).toBe('Ingresa un precio mayor a 0')
expect(showsSubscriptionEntry('associate', false)).toBe(false)
expect(showsSubscriptionEntry('associate', true)).toBe(true)
expect(showsSubscriptionEntry('client', false)).toBe(true)
expect(showsRentalsEntry('associate', false)).toBe(false)
expect(productsQueryKey(undefined)).toEqual(['products', 'public', 'guest'])
expect(productsQueryKey('associate')).toEqual(['products', 'public', 'associate'])
```
plus `canCarryAssociatePrice` true/false cases matching Task 1.

`super.products.test.tsx` (use `setupProductFormMocks` / `openPricingTab` like the monthly-rent test at 240-256):
- `saves the associate price in cents` — type `4,50` in `Precio para asociados` → `update` called with `expect.objectContaining({ associatePriceCents: 450 })`.
- `clearing the associate price sends null`.
- `zero shows the error and does not save` — `Ingresa un precio mayor a 0` visible; `update` not called.
- `a rental hides the field and saves associatePriceCents null` (Review Focus 4) — product with `associatePriceCents: 500` switched to rental → field not rendered; `update` called with `associatePriceCents: null`.

- [ ] **Step 2: Run them to verify they fail** — `cd dashgo-web && npx vitest run src/lib/associate.test.ts src/routes/super.products.test.tsx`. Expected: FAIL.

- [ ] **Step 3: Implement**

Form field `associatePriceText`, label/placeholder/help from Global Constraints, `id="associatePrice"`, rendered only when `canCarryAssociatePrice(<current form values>)`; when not rendered the payload sends `associatePriceCents: null`. List row: add `Asociados $X.XX` next to `Precio:` when `associatePriceCents != null`.

- [ ] **Step 4: Run them to verify they pass** — same command. Expected: PASS.

- [ ] **Step 5: Full suite + build** — `cd dashgo-web && npm test && npm run build`.

- [ ] **Step 6: Commit**

```bash
git add dashgo-web/src/lib/associate.ts dashgo-web/src/lib/associate.test.ts dashgo-web/src/lib/types.ts dashgo-web/src/lib/queries.ts dashgo-web/src/routes/super.products.tsx dashgo-web/src/routes/super.products.test.tsx
git commit -m "feat(web): el admin fija el precio para asociados en cada producto"
```

### Task 7: Web — associate experience

**Files:**
- Modify: `dashgo-web/src/lib/queries.ts` (`useProducts` 58-63), `dashgo-web/src/routes/__root.tsx` (Suscripción link 188-190), `dashgo-web/src/routes/cuenta.tsx` (AccountLinks 191-192), `dashgo-web/src/routes/catalog.tsx` (empty state 241-256)
- Test: `dashgo-web/src/routes/catalog.test.tsx` or a new focused test, `dashgo-web/src/routes/checkout.test.tsx`, the subscription page test (create `dashgo-web/src/routes/subscription.test.tsx` if absent — check first), a `cuenta`/root rendering test where one exists

**Interfaces:**
- Consumes: Task 6 helpers; `useMySubscription()` (`lib/queries.ts:1158`), `useMyRentals()` (`:1353`), `isAssociate` (`lib/roles.ts:33`).

- [ ] **Step 1: Write the failing tests**

- `useProducts is keyed by the viewer role` — with the current user mocked as associate, the query key equals `productsQueryKey('associate')`; product mutations that invalidate `['products']` still match it by prefix (assert with `queryClient.invalidateQueries({ queryKey: ['products'] })` marking it stale).
- `associate with an empty catalog sees the associate message` — catalog rendered with `useProducts` → `[]`, user associate → `Todavía no hay productos disponibles para asociados.`; a client still sees `No hay productos disponibles ahora mismo.`
- `associate without subscription or rentals has no Suscripción / Mis alquileres links` (root nav and cuenta); with a subscription record the Suscripción link shows.
- `checkout shows the server message when an associate cart is rejected` (Review Focus 2) — order creation rejects with `{ code: 'PRODUCT_NOT_AVAILABLE_FOR_ASSOCIATES', message: 'Este producto no está disponible para asociados' }` → that text is visible.
- `subscription page shows the API message for an associate` (Review Focus 5) — checkout-session mutation rejects with 403 `{ code: 'ASSOCIATE_CANNOT_SUBSCRIBE', message: 'Los asociados no pueden contratar la suscripción' }` → text visible.

- [ ] **Step 2: Run them to verify they fail** — `cd dashgo-web && npx vitest run <the test files above>`. Expected: the new tests FAIL. If the checkout or subscription message tests already pass, keep them as regression guards and say so in the report.

- [ ] **Step 3: Implement**

`useProducts` reads the current user and uses `productsQueryKey(user?.role)`. Gate the nav/cuenta links with `showsSubscriptionEntry(role, !!subscription)` / `showsRentalsEntry(role, rentals.length > 0)` (adapt to the hooks' real data shapes). Associate empty-state body as specified. If checkout/subscription pages don't surface the API `message`, make them use the existing API-error helper.

- [ ] **Step 4: Run them to verify they pass** — same command. Expected: PASS.

- [ ] **Step 5: Full suite + build** — `cd dashgo-web && npm test && npm run build`.

- [ ] **Step 6: Commit**

```bash
git add dashgo-web/src
git commit -m "feat(web): el asociado ve solo su catálogo y no ve ofertas de bebedero"
```

### Task 8: Mobile — admin field and shared helpers

**Files:**
- Create: `dashgo/src/lib/associate.ts` (verbatim mirror of web `lib/associate.ts`), `dashgo/src/lib/associate.test.ts` (same cases as Task 6)
- Modify: `dashgo/src/lib/types.ts` (Product, after `subscriberPriceCents` ~114), the mobile product input type in `dashgo/src/lib/queries.ts`, `dashgo/src/app/(super)/products.tsx` (state ~64/74/101, init ~168, validation ~230, payload ~264, field after the subscriber field ~587-604, list row tag)

**Interfaces:**
- Produces: same exports as Task 6 `lib/associate.ts`.

- [ ] **Step 1: Write the failing test** — `associate.test.ts` with the Task 6 cases (Jest syntax).
- [ ] **Step 2: Run it to verify it fails** — `cd dashgo && npx jest src/lib/associate.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** — helper file; admin screen field `Precio para asociados (opcional)` (plain Spanish), validated with `parseAssociatePrice`, rendered only when `canCarryAssociatePrice(...)`, otherwise payload `associatePriceCents: null`; list row tag `Asociados $X.XX`. (No screen test exists for `(super)/products.tsx`; the helper test plus the type-check is the gate.)
- [ ] **Step 4: Run it to verify it passes** — same command. Expected: PASS.
- [ ] **Step 5: Full suite + types** — `cd dashgo && npm test && npx tsc --noEmit`. Expected: tests green; tsc shows only the 2 pre-existing errors in `src/lib/push.ts`.
- [ ] **Step 6: Commit**

```bash
git add dashgo/src/lib/associate.ts dashgo/src/lib/associate.test.ts dashgo/src/lib/types.ts dashgo/src/lib/queries.ts "dashgo/src/app/(super)/products.tsx"
git commit -m "feat(mobile): el admin fija el precio para asociados en cada producto"
```

### Task 9: Mobile — associate experience

**Files:**
- Modify: `dashgo/src/lib/queries.ts` (`useProducts` 186-191), `dashgo/src/app/(tabs)/_layout.tsx` (`CLIENT_MORE_ITEMS` filter 60-62), `dashgo/src/app/(tabs)/profile.tsx` (links ~255-276), `dashgo/src/app/(tabs)/catalog.tsx` (`ListEmptyComponent` 802-815), `dashgo/src/i18n/locales/es/catalog.ts` + `en/catalog.ts` (`empty.associateBody`)
- Test: `dashgo/src/app/(tabs)/catalog.test.tsx` (add any new hook to its `jest.mock('../../lib/queries')` factory), `dashgo/src/app/(tabs)/profile.test.tsx`, the `(tabs)/_layout` test if one exists (else cover the filter through the helper)

**Interfaces:**
- Consumes: Task 8 helpers; `useMySubscription` (`lib/queries.ts:1257`), `useMyRentals` (`:1464`).

- [ ] **Step 1: Write the failing tests**
  - `associate with an empty catalog sees the associate message` → `Todavía no hay productos disponibles para asociados.`; client unchanged.
  - `associate without subscription or rentals has no Suscripción / Mis alquileres links in profile`; with a subscription the link shows.
  - `useProducts is keyed by the viewer role` (same assertion as web).
- [ ] **Step 2: Run them to verify they fail** — `cd dashgo && npx jest "src/app/(tabs)/catalog.test.tsx" "src/app/(tabs)/profile.test.tsx"`. Expected: FAIL.
- [ ] **Step 3: Implement** — role-keyed `useProducts`; `more.subscription` / `more.rentals` filtered with the helpers next to the existing `more.pool` filter; profile links gated the same way; i18n key in es and en; associate empty body in `ListEmptyComponent`.
- [ ] **Step 4: Run them to verify they pass** — same command. Expected: PASS.
- [ ] **Step 5: Full suite + types** — `cd dashgo && npm test && npx tsc --noEmit` (only the 2 pre-existing `push.ts` errors).
- [ ] **Step 6: Commit**

```bash
git add dashgo/src
git commit -m "feat(mobile): el asociado ve solo su catálogo y no ve ofertas de bebedero"
```
