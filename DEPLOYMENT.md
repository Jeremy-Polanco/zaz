# DashGo · Deployment guide

End-to-end steps to deploy the **API** (NestJS) to **DigitalOcean App Platform** and the **web** (Vite) to **Vercel**.

This guide assumes:

- You have admin access to the GitHub repo holding this code.
- You have accounts on **DigitalOcean**, **Vercel**, **Sentry**, **Stripe** (test mode for now), and **Twilio** (production credentials).
- You're deploying without a custom domain — using the platform-provided URLs (`*.ondigitalocean.app` and `*.vercel.app`). Adding a custom domain later is a 5-minute step on each platform.

---

## 1. Pre-flight: install dependencies

The API gained `@sentry/node` as a new dependency. Install once locally so the lockfile is up to date, then commit:

```bash
cd dashgo-api
npm install
git add package.json package-lock.json
git commit -m "chore(api): add @sentry/node"
```

---

## 2. Sentry — create projects

1. Sign in to [sentry.io](https://sentry.io). Create an organization if you don't have one.
2. Create **two projects** under that org:
   - **dashgo-api** → platform: `Node.js`
   - **dashgo-web** → platform: `React`
3. Copy each project's **DSN** from `Settings → Projects → <project> → Client Keys (DSN)`. You'll paste them in the next steps.

---

## 3. API → DigitalOcean App Platform

### 3.1 Create the app

The repo includes [`.do/app.yaml`](./.do/app.yaml) — an App Spec describing the API service + a managed Postgres database.

**Edit `.do/app.yaml` first**:

- Replace `REPLACE_WITH_GH_OWNER/REPLACE_WITH_GH_REPO` with your GitHub coordinates (e.g. `jeremypolanco/dashgo`).
- Replace every `REPLACE_WITH_*` value with the real one **OR** leave them as placeholders and set them via the DO dashboard after creation (recommended for secrets).

Then either:

**Option A — `doctl` CLI** (faster, infra-as-code):

```bash
brew install doctl              # macOS
doctl auth init                 # paste your DO API token
doctl apps create --spec .do/app.yaml
```

**Option B — DO dashboard**:

1. Go to **Apps → Create App**.
2. Pick "Import from existing app spec" and upload `.do/app.yaml`.
3. Confirm and create.

### 3.2 Set the secret env vars

After the app is created, go to **Settings → Components → api → Environment Variables** and fill in:

| Variable | How to get it |
|---|---|
| `JWT_SECRET` | `openssl rand -base64 48` (must be ≥32 chars) |
| `STRIPE_SECRET_KEY` | Stripe dashboard → Developers → API keys → "Secret key" (TEST mode) |
| `STRIPE_WEBHOOK_SECRET` | Set after step 3.4 below |
| `STRIPE_SUBSCRIPTION_PRICE_ID` | Stripe → Products → create a recurring price → copy `price_...` (optional — only used to bootstrap `subscription_plan` when the table is empty; leave unset if you seed the plan directly in the DB) |
| `TWILIO_ACCOUNT_SID` | Twilio console (Production credentials) |
| `TWILIO_API_KEY_SID` | Twilio → Account → API Keys → create a Standard key |
| `TWILIO_API_KEY_SECRET` | (shown once when you create the key) |
| `TWILIO_FROM_NUMBER` | Twilio SMS number, E.164 format (`+1...`) — used ONLY for admin order notifications. OTP uses WhatsApp below. |
| `TWILIO_WHATSAPP_FROM` | `whatsapp:+1...` — your verified WhatsApp Business sender (or `whatsapp:+14155238886` for the Twilio sandbox during dev) |
| `TWILIO_WHATSAPP_OTP_TEMPLATE_SID` | `HX...` — Content SID of the approved Spanish OTP template. Required outside the sandbox. See §3.5 below. |
| `SENTRY_DSN` | The DSN from the **dashgo-api** Sentry project |

`CORS_ORIGIN` and `PUBLIC_WEB_URL` will get the Vercel URL — set them in step 4.3.

Save and the app redeploys automatically.

### 3.3 Verify the API is up

The API URL is shown in the DO dashboard, something like `https://dashgo-XXXX.ondigitalocean.app`.

```bash
curl https://dashgo-XXXX.ondigitalocean.app/api/health
# → {"status":"ok","db":"up"}
```

If `db` is `down`, check that `DB_SSL=true` is set and the database is healthy in the DO dashboard.

### 3.4 Configure the Stripe webhook

1. In the [Stripe dashboard](https://dashboard.stripe.com/test/webhooks), click **Add endpoint**.
2. Endpoint URL: `https://dashgo-XXXX.ondigitalocean.app/api/payments/stripe/webhook`
3. Events to listen to (at minimum):
   - `payment_intent.amount_capturable_updated`
   - `payment_intent.succeeded`
   - `payment_intent.canceled`
   - `payment_intent.payment_failed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
4. Save → click into the new endpoint → **Signing secret** → "Reveal" → copy `whsec_...`.
5. Paste that into `STRIPE_WEBHOOK_SECRET` in DO. The app will redeploy.

### 3.5 Set up Twilio WhatsApp for OTP

OTP codes go through WhatsApp instead of SMS — Meta's WhatsApp Business
API has lighter compliance overhead than A2P 10DLC SMS registration, and
DashGo's NY-Latino audience uses WhatsApp by default.

There are three sub-steps, all in parallel:

#### 3.5.A — Twilio WhatsApp Sandbox (for dev/staging, instant)

[Twilio Console](https://console.twilio.com) → **Messaging** → **Try it out** → **Send a WhatsApp message** → activate the sandbox.

- Sandbox sender: `whatsapp:+14155238886`
- Each tester must text `join <your-sandbox-code>` to `+1 415 523 8886` from their WhatsApp ONCE to opt in.
- After opting in, the api can send free-form text (no template needed).
- Set `TWILIO_WHATSAPP_FROM=whatsapp:+14155238886` in DO staging. Leave `TWILIO_WHATSAPP_OTP_TEMPLATE_SID` UNSET to use the sandbox free-form path.

#### 3.5.B — Production WABA + Twilio Sender (1-2 days)

1. **Meta side** — [business.facebook.com](https://business.facebook.com) → create / verify your Business Manager. Legal name (matches EIN), business address, business website. Verification takes a few hours to a few days; start this first.

2. **Twilio side** — Twilio Console → **Messaging** → **Senders** → **WhatsApp senders** → **Create new sender**:
   - Pick a phone number NOT used for personal WhatsApp (buy a fresh one if needed, ~$1.15/mo).
   - Display name: `DashGo`
   - Display category: `Local Services`
   - Description: "Delivery service for water and beverages in New York City"
   - Link to your Facebook Business Manager from the wizard.

3. Once approved you get a WhatsApp sender like `whatsapp:+1<your-number>`. Set that as `TWILIO_WHATSAPP_FROM` in DO production.

#### 3.5.C — Authentication template (after WABA is approved)

Twilio Console → **Content Template Builder** → **New template** → **WhatsApp** → **Authentication**:

| Field | Value |
|---|---|
| Friendly name | `dashgo_otp_es` |
| Language | Spanish (Latin America) |
| Category | **AUTHENTICATION** |
| Body | `{{1}} es tu código de DashGo. Por tu seguridad, no compartas este código.` |
| Variable `{{1}}` | The 6-digit OTP code |
| Button | "Copy code" (auto-added for auth templates) |

Meta's auth-template approval is usually instant or within an hour. Once approved, copy the **Content SID** (starts with `HX…`) and set it as `TWILIO_WHATSAPP_OTP_TEMPLATE_SID` in DO.

#### Smoke test

After both `TWILIO_WHATSAPP_FROM` and `TWILIO_WHATSAPP_OTP_TEMPLATE_SID` are set, redeploy the api and hit login with your real phone. You should receive a WhatsApp message within ~2 seconds with the code + a "Copy code" button.

If you see `Twilio WhatsApp is not configured — cannot send OTP in production` in the api logs, one of the two env vars is missing. The env schema's production rule enforces "both or neither", so this can only happen if you set one and not the other.

---

## 4. Web → Vercel

### 4.1 Connect the repo

1. Sign in to [Vercel](https://vercel.com).
2. **Add New… → Project** → import your GitHub repo.
3. **Root Directory**: set to `dashgo-web`.
4. **Framework Preset**: Vite (auto-detected from `vercel.json`).
5. Don't deploy yet — set env vars first.

### 4.2 Set env vars in Vercel

Under **Settings → Environment Variables**, add (Production, Preview, Development as needed):

| Variable | Value |
|---|---|
| `VITE_API_URL` | `https://dashgo-XXXX.ondigitalocean.app/api` (from step 3.3) |
| `VITE_SENTRY_DSN` | DSN from the **dashgo-web** Sentry project |
| `VITE_SENTRY_TRACES_SAMPLE_RATE` | `0.1` |

Click **Deploy**. After the deploy, Vercel gives you a URL like `https://dashgo.vercel.app`.

### 4.3 Wire the web URL back into the API

Now that you have the Vercel URL, return to **DO Apps → api → Environment Variables** and set:

- `CORS_ORIGIN` = `https://dashgo.vercel.app` (no trailing slash; comma-separate if multiple)
- `PUBLIC_WEB_URL` = `https://dashgo.vercel.app`

Save. The API redeploys.

---

## 4.5 Mobile → EAS Build & Submit

The mobile app builds through Expo EAS. Production builds require live Stripe credentials and Sentry, both wired as EAS **project secrets** (never committed).

### Set the production secrets

From `dashgo/` run:

```bash
eas secret:create --scope project --name EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY --value pk_live_xxx
eas secret:create --scope project --name EXPO_PUBLIC_SENTRY_DSN --value https://...@sentry.io/...
```

EAS injects these into the build env automatically — there is no entry for them in `eas.json` for the production profile (intentionally; that file is committed and must not carry live keys).

### Build & submit

```bash
# iOS — first build creates certs/provisioning interactively
eas build --profile production --platform ios
eas submit --profile production --platform ios

# Android — uploads to internal track; promote in Play Console after testing
eas build --profile production --platform android
eas submit --profile production --platform android
```

### Pre-build checks

- [ ] `npx tsc --noEmit` passes cleanly in `dashgo/`.
- [ ] `app.config.ts` `version` and `ios.buildNumber` / `android.versionCode` have been bumped (or `autoIncrement: true` in `eas.json` handles it).
- [ ] PNG brand assets in `dashgo/assets/images/` match the current logo (regenerate from `dashgo-logo.svg` when the brand changes).
- [ ] Both EAS secrets above exist (`eas secret:list`).

---

## 5. First-deploy checklist

Run these in order to verify everything's working end-to-end:

- [ ] **API health**: `curl <API_URL>/api/health` returns `{"status":"ok","db":"up"}`.
- [ ] **Web loads**: open the Vercel URL — login screen should render.
- [ ] **Auth (Twilio)**: enter your phone, receive an SMS code, log in.
- [ ] **Catalog loads**: products and categories render.
- [ ] **Stripe webhook**: Stripe dashboard → Webhooks → your endpoint → "Send test event" with `payment_intent.succeeded`. Should return 200.
- [ ] **Sentry**: trigger a 500 (e.g. hit a bogus admin endpoint as a normal user). Confirm an event appears in `dashgo-api` Sentry project.
- [ ] **CORS**: open the web app, look at network tab — API requests should succeed without CORS errors.
- [ ] **Rental product**: create a test rental product via admin UI (`/super/products`), set `pricingMode = rental`, fill in `monthlyRentCents`, `lateFeeCents`, `stripeProductId`, and `stripePriceId`. Save and verify all four fields persist (check DB or re-open the edit form).
- [ ] **Rental order activation**: place a test rental order as a client, then advance it through the full status lifecycle to `DELIVERED` as admin. Verify a Stripe Subscription is created in the Stripe dashboard and the Rental row in the DB flips to `status = ACTIVE`.
- [ ] **(Optional — manual) past_due webhook**: in the Stripe test dashboard, mark the test subscription as `past_due` (or use `stripe trigger customer.subscription.updated`). Verify the Rental row in the DB flips to `status = PAST_DUE`.
- [ ] **(Optional — manual) late-fee cron**: wait for the 03:00 UTC tick, or inject `LateFeeCron` and call `runDaily()` from a one-off script. Verify `last_late_fee_at` is set on any PAST_DUE rental that is ≥ 3 days past due. Re-run within the same UTC day and confirm the charge is NOT repeated (`lastLateFeeAt` is already today).

---

## 6. Migrations

Migrations are committed under `dashgo-api/src/database/migrations/` and **run automatically on every deploy** because the DataSource has `migrationsRun: true`.

To add a new migration:

```bash
cd dashgo-api
# Make schema changes (entity files), then:
npm run migration:generate -- src/database/migrations/AddSomething
git add src/database/migrations
git commit -m "feat(db): add something"
git push    # triggers redeploy on DO; migration runs at boot
```

To revert (rare — usually fix-forward):

```bash
npm run migration:revert
```

---

## 7. Costs (estimate)

| Service | Plan | $/mo |
|---|---|---|
| DigitalOcean App Platform — `basic-xxs` | 1 instance | ~$5 |
| DigitalOcean Managed Postgres — `db-s-dev-database` | dev cluster | ~$15 |
| Vercel | Hobby (free) | $0 |
| Sentry | Developer (free, 5k errors/mo) | $0 |
| **Total** | | **~$20** |

Scale up the API to `basic-xs` ($12) and Postgres to a non-dev cluster ($15+) when you have real traffic.

---

## 8. Custom domain (when ready)

1. Register a domain (Namecheap / Cloudflare Registrar / Google Domains).
2. **Vercel** → Project → Domains → add `dashgo.dev` (or whatever). Vercel gives you DNS records to add at your registrar.
3. **DO Apps** → api → Settings → Domains → add `api.dashgo.dev`. Same flow — copy the CNAME.
4. Update `VITE_API_URL` in Vercel to `https://api.dashgo.dev/api`.
5. Update `CORS_ORIGIN` and `PUBLIC_WEB_URL` in DO to `https://dashgo.dev`.
6. Update the Stripe webhook URL to the new domain.

---

## 9. Going to Stripe live

When you have your live keys:

1. Replace `STRIPE_SECRET_KEY` in DO (sk_test → sk_live).
2. Recreate the webhook in Stripe live mode — get a new `whsec_...` and update `STRIPE_WEBHOOK_SECRET`.
3. Recreate the subscription Price in live mode — get a new `price_...` and update `STRIPE_SUBSCRIPTION_PRICE_ID`.
4. Update `VITE_STRIPE_PUBLISHABLE_KEY` in Vercel if the web uses Stripe.js client-side.
5. Redeploy.

That's the whole thing. The code is mode-agnostic — only env vars change.

---

## Operational notes

- **Logs**: DO → Apps → api → Runtime Logs. Errors also land in Sentry.
- **Restart**: DO → Apps → api → Settings → "Force Rebuild and Deploy".
- **Database access**: DO → Databases → dashgo-db → "Connection details". Use Postico/TablePlus from your laptop (DO whitelists trusted sources by default; you may need to add your IP).
- **Webhooks failing**: usually a `STRIPE_WEBHOOK_SECRET` mismatch after rotating keys. Re-copy from Stripe dashboard.
- **JWT secret rotation**: changing `JWT_SECRET` invalidates every active session — users get logged out and have to OTP again. Plan accordingly.

---

## 10. Rentals — Stripe test mode provisioning (CI and local E2E)

### 10.1 Create the Stripe test-mode rental product

1. Open the [Stripe dashboard](https://dashboard.stripe.com) and switch to **Test mode** (toggle in the top-left).
2. Go to **Products → + Add product**.
3. Fill in:
   - **Name**: `Rental Test Product` (or any name — it's only used for labelling)
   - **Pricing model**: Recurring
   - **Price**: any amount (e.g. `20.00 USD / month`)
4. Click **Save product**.
5. On the product detail page copy:
   - `prod_…` → this is your `STRIPE_RENTAL_TEST_PRODUCT_ID`
   - `price_…` → this is your `STRIPE_RENTAL_TEST_PRICE_ID`

### 10.2 GitHub Actions secrets (CI E2E)

Add these four secrets under **Settings → Secrets and variables → Actions** in the repo:

| Secret | Value |
|--------|-------|
| `STRIPE_SECRET_KEY` | Test-mode secret key (`sk_test_…`) from Stripe → Developers → API keys |
| `STRIPE_WEBHOOK_SECRET` | Signing secret (`whsec_…`) from the Stripe webhook endpoint you create for CI (see 10.3) |
| `STRIPE_RENTAL_TEST_PRODUCT_ID` | `prod_…` ID copied in step 10.1 |
| `STRIPE_RENTAL_TEST_PRICE_ID` | `price_…` ID copied in step 10.1 |

### 10.3 Stripe webhook endpoint for CI

CI E2E tests use `Stripe.webhooks.generateTestHeaderString()` to sign fixture events locally — they do NOT call back to a live URL. You still need a `whsec_…` secret to sign events:

**Option A — reuse an existing test webhook endpoint**:
1. In Stripe → Webhooks, click an existing test-mode endpoint (or create one pointing at `https://example.com` — it never receives real traffic).
2. Copy the **Signing secret** (`whsec_…`).
3. Set it as `STRIPE_WEBHOOK_SECRET` in GitHub Actions.

**Option B — derive a secret without a real endpoint**:
Generate a deterministic test secret locally:
```bash
node -e "console.log('whsec_' + require('crypto').randomBytes(32).toString('base64'))"
```
Use that value for `STRIPE_WEBHOOK_SECRET` in GitHub Actions AND in the `createTestingApp()` environment.

### 10.4 Local E2E with the Stripe CLI

To run E2E tests locally against a live forwarded webhook:

```bash
# Terminal 1 — start the API on port 3001
cd dashgo-api && npm run start:dev

# Terminal 2 — forward Stripe test events to the local API
stripe listen --forward-to localhost:3001/api/payments/webhook --print-secret
# Copy the printed whsec_... value

# Terminal 3 — run the E2E suite with real creds
STRIPE_SECRET_KEY=sk_test_... \
STRIPE_WEBHOOK_SECRET=whsec_... \
STRIPE_RENTAL_TEST_PRODUCT_ID=prod_... \
STRIPE_RENTAL_TEST_PRICE_ID=price_... \
  cd dashgo-api && npx jest --selectProjects e2e
```

### 10.5 CI workflow snippet (reference)

The E2E project already uses `describeIfStripe` which skips gracefully when creds are absent. To enable the full suite in CI, add to your workflow:

```yaml
- name: Run E2E tests
  env:
    STRIPE_SECRET_KEY: ${{ secrets.STRIPE_SECRET_KEY }}
    STRIPE_WEBHOOK_SECRET: ${{ secrets.STRIPE_WEBHOOK_SECRET }}
    STRIPE_RENTAL_TEST_PRODUCT_ID: ${{ secrets.STRIPE_RENTAL_TEST_PRODUCT_ID }}
    STRIPE_RENTAL_TEST_PRICE_ID: ${{ secrets.STRIPE_RENTAL_TEST_PRICE_ID }}
  run: |
    cd dashgo-api
    npx jest --selectProjects e2e
```

### 10.6 LateFeeCron — monitoring

The `LateFeeCron` runs at **03:00 server time** daily (cron: `0 3 * * *`).

- **Logs**: search Runtime Logs for `LateFeeCron.runDaily` to see charge/skip counts.
- **Expected output on a quiet day**: `charged=0 skipped/errored=0 total=0`
- **Alert on skipped/errored > 0**: means a rental charge failed. Check Sentry for `LateFeeCron.runDaily: failed to charge rental`.
- **Manual trigger**: inject the `LateFeeCron` service and call `runDaily()` from a one-off script or admin endpoint if needed.
- **Idempotency**: the cron is safe to re-run within the same UTC day — it will not double-charge a rental whose `last_late_fee_at` is today.

---

## 11. Rentals — Live Stripe products runbook

This section covers the steps needed to go live with rental products. It supplements the general Stripe live-mode steps in §9.

### 11.1 Create a Stripe live-mode Product + recurring Price for each rental SKU

For **each** product in the admin UI that has `pricingMode = rental`:

1. Open the [Stripe dashboard](https://dashboard.stripe.com) and switch to **Live mode** (toggle in the top-left).
2. Go to **Products → + Add product**.
3. Fill in:
   - **Name**: match the product name in your admin (e.g. `Botellón 20L — Alquiler mensual`)
   - **Pricing model**: Recurring
   - **Price**: the monthly rent amount (e.g. `15.00 USD / month`)
4. Click **Save product**.
5. On the product detail page copy:
   - `prod_…` → `stripeProductId`
   - `price_…` → `stripePriceId`

### 11.2 Paste the IDs into the admin product form

1. Open the DashGo admin web (`/super/products`).
2. Find the rental product and click **Edit**.
3. Paste:
   - `prod_…` into the **Stripe Product ID** field
   - `price_…` into the **Stripe Price ID** field
4. Save. The API persists both IDs alongside `monthlyRentCents` and `lateFeeCents`.

These IDs are used at order delivery time when `RentalsService.performActivation` calls `stripe.subscriptions.create({ items: [{ price: stripePriceId }] })`.

### 11.3 Late-fee cron schedule and observability

The late-fee cron is implemented in:

```
dashgo-api/src/modules/rentals/late-fee.cron.ts
```

Schedule: `@Cron('0 3 * * *')` — runs daily at **03:00 UTC**.

**Viewing logs on DigitalOcean App Platform**:

1. Go to **Apps → dashgo-api → Runtime Logs**.
2. Filter by text `LateFeeCron` to isolate cron output.
3. Each run emits a structured log line with `charged`, `skipped`, `errored`, and `total` counts.

**What to look for**:

| Log output | Meaning |
|---|---|
| `charged=N` | N rentals had a late-fee PaymentIntent created today |
| `skipped=N` | N rentals were in the grace period (< 3 days past due) or already charged today |
| `errored=N` | N rentals threw an error — check Sentry for `LateFeeCron.runDaily: failed to charge rental` |

### 11.4 Admin retry-setup action

When a rental activation fails at delivery (Stripe unreachable, invalid price ID, etc.), the rental stays in `PENDING_SETUP`.

**Customer experience before retry**: the customer sees a yellow badge in the mobile app with the message _"Estamos terminando de configurar tu alquiler. Te avisamos cuando esté activo."_

**Admin retry endpoint**:

```
POST /api/admin/rentals/:id/retry-setup
Authorization: Bearer <super-admin JWT>
```

- **When to use**: any time a rental is stuck in `PENDING_SETUP` after the order has been delivered.
- **What it does**: re-runs the same `performActivation` logic — creates a Stripe Subscription for the rental's product price and flips the rental to `ACTIVE` if successful.
- **Idempotency key**: `rental:{rentalId}:activate` — safe to call multiple times; Stripe deduplicates.
- **On success**: the rental status flips to `ACTIVE` and `stripeSubscriptionId` is populated in the DB.
- **On failure**: returns the Stripe error. Fix the root cause (e.g. update `stripePriceId` in the product) and retry again.

**Finding stuck rentals**: the admin listing endpoint returns all rentals. Filter by `status = PENDING_SETUP` to find the ones needing attention.
