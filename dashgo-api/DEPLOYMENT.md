# Deployment

## WhatsApp Cloud API setup (OTP delivery)

DashGo sends login OTP codes over WhatsApp via **Meta's WhatsApp Cloud API**
(`graph.facebook.com`) directly — no BSP (we left Twilio's WhatsApp channel;
Twilio is now SMS-only for admin order notifications). The code path lives in
`src/modules/whatsapp/whatsapp.service.ts`; failures are classified in
`src/modules/auth/whatsapp-error-codes.ts`.

OTP is **dormant by default** (`AUTH_OTP_MODE=disabled` → phone-only login).
To turn verified login on you set `AUTH_OTP_MODE=whatsapp` **and** supply the
Meta credentials below. In production the env schema (`Rule 4`) refuses to boot
with `AUTH_OTP_MODE=whatsapp` unless the full trio is present.

### Environment variables

| Var | Required | Default | Notes |
|-----|----------|---------|-------|
| `AUTH_OTP_MODE` | — | `disabled` | Set `whatsapp` to enable OTP send+verify in prod. `sandbox` = relaxed testing mode (Meta test number / allow-listed testers), guard not enforced. |
| `WHATSAPP_PHONE_NUMBER_ID` | when OTP on | — | The Cloud API **phone number ID** (numeric, from the WhatsApp > API setup page). NOT the phone number itself. |
| `WHATSAPP_ACCESS_TOKEN` | when OTP on | — | A **System User long-lived token** (see step 7). Do not use the temporary 24h token. |
| `WHATSAPP_OTP_TEMPLATE_NAME` | when OTP on | — | Name of the approved **authentication** template (e.g. `dashgo_otp`). |
| `WHATSAPP_OTP_TEMPLATE_LANG` | — | `es` | Template language code. Must match the approved template's locale exactly. |
| `WHATSAPP_API_VERSION` | — | `v22.0` | Graph API version. |
| `WHATSAPP_OTP_TEMPLATE_HAS_BUTTON` | — | `true` | `true` echoes the OTP into the copy-code/one-tap button component (authentication templates ship one by default). Set `false` only for a body-only template. |

Dev/test bypass: phones matching `+1555555XXXX` are logged to the console and
never hit Meta (used by seeds + e2e). When the trio is unset in non-production,
OTPs are logged to the console instead of sent.

---

## Meta Business validation — path to production

The gating below is **Meta's**, identical whether you go direct or via a BSP.
Start the slow item (business verification) on day one; build/test against the
unverified-app trial in parallel.

### 1. Create the app + WhatsApp product
1. Go to **developers.facebook.com** → My Apps → **Create App** → type
   **Business**.
2. Add the **WhatsApp** product to the app. This auto-creates a test
   **WhatsApp Business Account (WABA)** and a free Meta **test number**.

### 2. Connect to your Business Portfolio
1. In **business.facebook.com** (Meta Business Suite) → Settings → create or
   select your **Business Portfolio** (the legal entity: *Urban Dash LLC*).
2. Link the app + WABA to that portfolio under **Accounts → WhatsApp accounts**.

### 3. Start Business Verification  ← the long pole, do this first
1. Business Settings → **Security Center** → **Start Verification**.
2. Provide legal docs: business registration / formation document, business
   address proof, and a verifiable phone or domain. Entity details must match
   exactly (name, address).
3. Submission review: typically a few days, up to ~2 weeks; can bounce if docs
   mismatch. **You can keep building while this is pending** (see step 6).

### 4. Add + verify your production phone number
1. WhatsApp Manager → **Phone numbers → Add phone number**.
2. The number must **not** be registered on the consumer WhatsApp / WhatsApp
   Business app. If it is, delete that account first.
3. Verify via SMS or voice call. Set the **Display name** (Meta reviews it —
   usually hours to a couple of days).

### 5. Create + submit the authentication template
1. WhatsApp Manager → **Message templates → Create template** → category
   **Authentication**.
2. Language **Spanish** (`es`) to match `WHATSAPP_OTP_TEMPLATE_LANG`. Keep the
   default copy-code button (matches `WHATSAPP_OTP_TEMPLATE_HAS_BUTTON=true`).
3. Submit. Authentication templates are standardized and usually approved in
   minutes to a day. Note the **template name** → `WHATSAPP_OTP_TEMPLATE_NAME`.

### 6. Test before verification clears (unverified-app trial)
- An unverified app can message a **small allow-list of test recipients**
  immediately. WhatsApp Manager → API setup → add tester numbers.
- Point a staging deploy at the Meta test number with `AUTH_OTP_MODE=sandbox`
  and the trio set, and run the real send. A `131030` (recipient not in allowed
  list) error here just means you haven't added that tester.

### 7. Mint the production access token
1. **business.facebook.com → Business Settings → Users → System Users** →
   create a System User (role: Admin or Employee).
2. **Add Assets** → assign the **app** and the **WABA** to the system user with
   full control.
3. **Generate token** for that system user → scopes `whatsapp_business_messaging`
   + `whatsapp_business_management` → choose **never expires** (or long-lived).
   This is `WHATSAPP_ACCESS_TOKEN`. (The temporary token on the API-setup page
   expires in 24h — do not ship it.)

### 8. Go live
1. Business Verification **approved** → the recipient cap lifts.
2. Set production env: `AUTH_OTP_MODE=whatsapp`, `WHATSAPP_PHONE_NUMBER_ID`,
   `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_OTP_TEMPLATE_NAME` (+ optional lang /
   version / button). Deploy.
3. You start at a **messaging tier** (e.g. 250 → 1K → 10K business-initiated
   conversations/day) that ramps automatically based on quality + volume.

### Gotchas
- **Number migration:** if you ever onboarded this number under a BSP's WABA,
  moving it here is a separate phone-number migration with a brief send outage.
- **Token expiry** is the #1 production outage cause — a system-user token that
  silently expires surfaces as Meta error `190` → classified `WHATSAPP_SEND_FAILED`
  (503, generic retry). Rotate deliberately.
- **Template edits** re-enter review and can pause sends; the running config
  errors map to `WHATSAPP_SEND_FAILED`, not a recipient error.

---

## Stripe Live setup (payments)

Stripe spans **three surfaces**, and each key lives in a different place. The
golden rule: the **publishable** key (`pk_live_…`) is public and ships in the
client bundles; the **secret** key (`sk_live_…` / `rk_live_…`) is server-only and
NEVER goes in the repo, a client build, or a chat/log. Set it directly in the
backend host's environment.

| Surface | Key / env var | Where it lives |
|---------|---------------|----------------|
| Backend (`dashgo-api`) | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_SUBSCRIPTION_PRICE_ID` | Host env vars (container runtime for `api.dashgo.dev`) |
| Web (`dashgo-web`) | `VITE_STRIPE_PUBLISHABLE_KEY` | Vercel → Project → Settings → Environment Variables (Production) |
| Mobile (`dashgo`) | `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` | EAS project secret (`eas.json` production already references `$EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY`) |

> **⚠️ Same-account rule.** Every key MUST come from the same Stripe account and
> the same mode. The account id is the chunk after the prefix: `pk_live_51XXXX…`
> and `sk_live_51XXXX…` must share the same `51XXXX…`. A secret from a different
> account than the publishable fails at runtime with `No such payment_intent` —
> a bug that looks like anything except the real cause. Note the repo's **test**
> keys (`pk_test_51TNgYH…` in `eas.json` dev/preview) belong to a *different*
> account than live — that's fine for sandbox, but the live trio must all match
> each other.

### Backend environment variables

| Var | Required (prod) | Notes |
|-----|-----------------|-------|
| `STRIPE_SECRET_KEY` | when payments on | `sk_live_…` or restricted `rk_live_…`. Boot guard (`src/common/stripe/stripe-runtime-guard.ts`) rejects `sk_test_*` and any non-`sk_live_`/`rk_live_` prefix in production. Unset = payments intentionally disabled. |
| `STRIPE_WEBHOOK_SECRET` | when payments on | Must start with `whsec_`. From the webhook endpoint you create below. |
| `STRIPE_SUBSCRIPTION_PRICE_ID` | when secret key set | `price_…`. **The guard refuses to boot if `STRIPE_SECRET_KEY` is set but this is missing** — the three go together or none do. |

### Restricted key (`rk_live_…`) scopes

If you use a restricted key (recommended over a full `sk_live_`), it boots fine
but throws `permission` errors at the first payment unless these scopes are set.
Grant in Stripe → Developers → API keys → Create restricted key:

| Resource | Permission | Used by |
|----------|------------|---------|
| Payment Intents | Write | order checkout, credit payment |
| Checkout Sessions | Write | subscription checkout |
| Subscriptions | Write | subscriptions + rentals |
| Customers | Write | customer creation |
| Products | Write | subscription-plan bootstrap (`SubscriptionService`) |
| Prices | Read | `prices.retrieve()` during seed |
| Billing Portal | Write | billing portal sessions |

Webhook signature verification (`stripe.webhooks.constructEvent`) needs **no key
permission** — it only uses `STRIPE_WEBHOOK_SECRET`.

### Webhook endpoint

1. Stripe Dashboard (correct account, **Live** mode) → Developers → Webhooks →
   **Add endpoint**.
2. URL: `https://api.dashgo.dev/api/payments/webhook` (controller route
   `src/modules/payments/payments.controller.ts`; the `/api` prefix is the app's
   global prefix).
3. Select events the handler processes: `payment_intent.amount_capturable_updated`,
   `payment_intent.succeeded`, `payment_intent.canceled`,
   `payment_intent.payment_failed`, `checkout.session.completed`,
   `customer.subscription.*`, `invoice.payment_*`.
4. Copy the endpoint's **Signing secret** (`whsec_…`) → `STRIPE_WEBHOOK_SECRET`.

### Web (Vercel)

1. Vercel → Project → Settings → Environment Variables → add
   `VITE_STRIPE_PUBLISHABLE_KEY=pk_live_…` (scope **Production**) and
   `VITE_API_URL=https://api.dashgo.dev/api`.
2. **Redeploy.** Vite inlines `VITE_*` vars at build time — an env change without
   a new build does nothing.

### Mobile (EAS)

```bash
eas secret:create --scope project --name EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY --value pk_live_…
```

`eas.json` production already maps it; dev/preview keep the hardcoded `pk_test_…`
on purpose — don't touch those.

### Gotchas
- **A leaked secret is a dead secret.** If a `sk_live_`/`rk_live_` key ever lands
  in the repo, a client build, a log, or a chat, **roll it** (Stripe → API keys →
  Roll key) before relying on it. Restricted scope doesn't exempt it.
- **The guard fails the boot, loudly, on purpose.** A test key, a placeholder, a
  missing `whsec_`, or a missing `price_…` in production throws at `onModuleInit`
  — not at the first payment. If the API won't start after a Stripe change, read
  the boot error; it names the exact misconfigured var.
- **Publishable ≠ optional.** Web throws `VITE_STRIPE_PUBLISHABLE_KEY is required`
  (`src/lib/stripe.ts`) and mobile renders an error screen at runtime if the key
  is missing or still a `pk_test_*` in a production build.
