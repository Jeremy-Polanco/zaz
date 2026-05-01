# Zaz · Deployment guide

End-to-end steps to deploy the **API** (NestJS) to **DigitalOcean App Platform** and the **web** (Vite) to **Vercel**.

This guide assumes:

- You have admin access to the GitHub repo holding this code.
- You have accounts on **DigitalOcean**, **Vercel**, **Sentry**, **Stripe** (test mode for now), and **Twilio** (production credentials).
- You're deploying without a custom domain — using the platform-provided URLs (`*.ondigitalocean.app` and `*.vercel.app`). Adding a custom domain later is a 5-minute step on each platform.

---

## 1. Pre-flight: install dependencies

The API gained `@sentry/node` as a new dependency. Install once locally so the lockfile is up to date, then commit:

```bash
cd zaz-api
npm install
git add package.json package-lock.json
git commit -m "chore(api): add @sentry/node"
```

---

## 2. Sentry — create projects

1. Sign in to [sentry.io](https://sentry.io). Create an organization if you don't have one.
2. Create **two projects** under that org:
   - **zaz-api** → platform: `Node.js`
   - **zaz-web** → platform: `React`
3. Copy each project's **DSN** from `Settings → Projects → <project> → Client Keys (DSN)`. You'll paste them in the next steps.

---

## 3. API → DigitalOcean App Platform

### 3.1 Create the app

The repo includes [`.do/app.yaml`](./.do/app.yaml) — an App Spec describing the API service + a managed Postgres database.

**Edit `.do/app.yaml` first**:

- Replace `REPLACE_WITH_GH_OWNER/REPLACE_WITH_GH_REPO` with your GitHub coordinates (e.g. `jeremypolanco/zaz`).
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
| `STRIPE_SUBSCRIPTION_PRICE_ID` | Stripe → Products → create a recurring price → copy `price_...` |
| `TWILIO_ACCOUNT_SID` | Twilio console (Production credentials) |
| `TWILIO_API_KEY_SID` | Twilio → Account → API Keys → create a Standard key |
| `TWILIO_API_KEY_SECRET` | (shown once when you create the key) |
| `TWILIO_FROM_NUMBER` | Your Twilio production phone number, E.164 format (`+1...`) |
| `SENTRY_DSN` | The DSN from the **zaz-api** Sentry project |

`CORS_ORIGIN` and `PUBLIC_WEB_URL` will get the Vercel URL — set them in step 4.3.

Save and the app redeploys automatically.

### 3.3 Verify the API is up

The API URL is shown in the DO dashboard, something like `https://zaz-XXXX.ondigitalocean.app`.

```bash
curl https://zaz-XXXX.ondigitalocean.app/api/health
# → {"status":"ok","db":"up"}
```

If `db` is `down`, check that `DB_SSL=true` is set and the database is healthy in the DO dashboard.

### 3.4 Configure the Stripe webhook

1. In the [Stripe dashboard](https://dashboard.stripe.com/test/webhooks), click **Add endpoint**.
2. Endpoint URL: `https://zaz-XXXX.ondigitalocean.app/api/payments/stripe/webhook`
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

---

## 4. Web → Vercel

### 4.1 Connect the repo

1. Sign in to [Vercel](https://vercel.com).
2. **Add New… → Project** → import your GitHub repo.
3. **Root Directory**: set to `zaz-web`.
4. **Framework Preset**: Vite (auto-detected from `vercel.json`).
5. Don't deploy yet — set env vars first.

### 4.2 Set env vars in Vercel

Under **Settings → Environment Variables**, add (Production, Preview, Development as needed):

| Variable | Value |
|---|---|
| `VITE_API_URL` | `https://zaz-XXXX.ondigitalocean.app/api` (from step 3.3) |
| `VITE_SENTRY_DSN` | DSN from the **zaz-web** Sentry project |
| `VITE_SENTRY_TRACES_SAMPLE_RATE` | `0.1` |

Click **Deploy**. After the deploy, Vercel gives you a URL like `https://zaz.vercel.app`.

### 4.3 Wire the web URL back into the API

Now that you have the Vercel URL, return to **DO Apps → api → Environment Variables** and set:

- `CORS_ORIGIN` = `https://zaz.vercel.app` (no trailing slash; comma-separate if multiple)
- `PUBLIC_WEB_URL` = `https://zaz.vercel.app`

Save. The API redeploys.

---

## 5. First-deploy checklist

Run these in order to verify everything's working end-to-end:

- [ ] **API health**: `curl <API_URL>/api/health` returns `{"status":"ok","db":"up"}`.
- [ ] **Web loads**: open the Vercel URL — login screen should render.
- [ ] **Auth (Twilio)**: enter your phone, receive an SMS code, log in.
- [ ] **Catalog loads**: products and categories render.
- [ ] **Stripe webhook**: Stripe dashboard → Webhooks → your endpoint → "Send test event" with `payment_intent.succeeded`. Should return 200.
- [ ] **Sentry**: trigger a 500 (e.g. hit a bogus admin endpoint as a normal user). Confirm an event appears in `zaz-api` Sentry project.
- [ ] **CORS**: open the web app, look at network tab — API requests should succeed without CORS errors.

---

## 6. Migrations

Migrations are committed under `zaz-api/src/database/migrations/` and **run automatically on every deploy** because the DataSource has `migrationsRun: true`.

To add a new migration:

```bash
cd zaz-api
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
2. **Vercel** → Project → Domains → add `zaz.com` (or whatever). Vercel gives you DNS records to add at your registrar.
3. **DO Apps** → api → Settings → Domains → add `api.zaz.com`. Same flow — copy the CNAME.
4. Update `VITE_API_URL` in Vercel to `https://api.zaz.com/api`.
5. Update `CORS_ORIGIN` and `PUBLIC_WEB_URL` in DO to `https://zaz.com`.
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
- **Database access**: DO → Databases → zaz-db → "Connection details". Use Postico/TablePlus from your laptop (DO whitelists trusted sources by default; you may need to add your IP).
- **Webhooks failing**: usually a `STRIPE_WEBHOOK_SECRET` mismatch after rotating keys. Re-copy from Stripe dashboard.
- **JWT secret rotation**: changing `JWT_SECRET` invalidates every active session — users get logged out and have to OTP again. Plan accordingly.
