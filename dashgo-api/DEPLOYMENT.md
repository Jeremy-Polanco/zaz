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
