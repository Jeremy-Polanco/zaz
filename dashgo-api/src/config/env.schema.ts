import { z } from 'zod';

const E164_REGEX = /^\+[1-9]\d{9,14}$/;

export const envSchema = z
  .object({
    // FIX HIGH-G4 — NODE_ENV is required, no default.
    // A missing NODE_ENV used to fall back to 'development', which silently
    // disabled every production-only guard (Sentry DSN, sk_live_* check,
    // AUTH_BYPASS guard, DB_SYNCHRONIZE rejection). Make it mandatory so a
    // mis-set deploy fails loudly at boot instead of running in "fake dev".
    NODE_ENV: z.enum(['development', 'production', 'test']),

    // Database
    DB_HOST: z.string().default('localhost'),
    DB_PORT: z.coerce.number().default(5432),
    DB_USER: z.string(),
    DB_PASSWORD: z.string(),
    DB_NAME: z.string(),
    DB_SYNCHRONIZE: z.enum(['true', 'false']).default('false'),
    DB_POOL_MAX: z.coerce.number().default(20),
    DB_SSL: z.enum(['true', 'false', 'ca']).default('false'),
    DB_SSL_CA: z.string().optional(),

    // Auth
    JWT_SECRET: z.string().min(32),
    JWT_ACCESS_TTL: z.string().default('1h'),
    JWT_REFRESH_TTL: z.string().default('7d'),

    // Stripe
    // FIX CRITICAL-G2 — both keys must be non-empty WHEN SET. An empty
    // string used to slip through (`z.string()` accepts ''), and the
    // runtime guard treated empty as "payments intentionally disabled".
    // `.min(1)` rejects `STRIPE_SECRET_KEY=""` outright (a misconfig).
    //
    // `.optional()` enables the cash-only / payments-disabled launch path:
    // when STRIPE_SECRET_KEY is UNSET (undefined), stripe-runtime-guard.ts
    // returns early and each Stripe service (Payments/Subscription/Rentals)
    // warns + skips init. Without `.optional()` the schema forced the key
    // present in production, making the very disabled-mode the guard +
    // services were built for UNREACHABLE — a launch-blocking conflict for a
    // cash-only soft-launch. The guard still enforces sk_live_/rk_live_ when
    // a key IS set, so the production security check stays intact.
    STRIPE_SECRET_KEY: z.string().min(1).optional(),
    STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
    // Optional by design: SubscriptionService bootstraps the row from this env
    // var on startup IFF the `subscription_plan` table is empty. Operators can
    // instead seed `subscription_plan` directly and leave this unset. If both
    // are absent, subscription routes return 4xx until the table is populated.
    STRIPE_SUBSCRIPTION_PRICE_ID: z.string().optional(),

    // Twilio — SMS ONLY (admin order notifications + dormant SMS OTP fallback).
    // WhatsApp OTP is sent via Meta's WhatsApp Cloud API, see WHATSAPP_* below.
    TWILIO_ACCOUNT_SID: z.string(),
    TWILIO_API_KEY_SID: z.string(),
    TWILIO_API_KEY_SECRET: z.string(),
    TWILIO_FROM_NUMBER: z.string(),

    // WhatsApp Business — Meta WhatsApp Cloud API (production OTP path).
    // We call graph.facebook.com directly (no BSP). All optional at the schema
    // level so non-OTP deploys boot without them; the production guard below
    // (Rule 4) requires the trio when AUTH_OTP_MODE=whatsapp.
    //
    //   WHATSAPP_PHONE_NUMBER_ID — the Cloud API phone number ID (numeric).
    //   WHATSAPP_ACCESS_TOKEN    — System User long-lived token (Bearer).
    //   WHATSAPP_OTP_TEMPLATE_NAME — name of the approved authentication template.
    //   WHATSAPP_OTP_TEMPLATE_LANG — template language code (default 'es').
    //   WHATSAPP_API_VERSION       — Graph API version (default 'v22.0').
    //   WHATSAPP_OTP_TEMPLATE_HAS_BUTTON — 'false' for a body-only template;
    //     default 'true' (auth templates ship a copy-code button that needs the
    //     OTP echoed in a button component on send).
    WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
    WHATSAPP_ACCESS_TOKEN: z.string().optional(),
    WHATSAPP_OTP_TEMPLATE_NAME: z.string().optional(),
    WHATSAPP_OTP_TEMPLATE_LANG: z.string().default('es'),
    WHATSAPP_API_VERSION: z.string().default('v22.0'),
    WHATSAPP_OTP_TEMPLATE_HAS_BUTTON: z.enum(['true', 'false']).default('true'),

    // Order SMS notifications
    ORDER_SMS_NOTIFY_NUMBERS: z
      .string()
      .default('')
      .transform((s) =>
        s
          .split(',')
          .map((n) => n.trim())
          .filter((n) => n.length > 0),
      )
      .refine((arr) => arr.every((n) => E164_REGEX.test(n)), {
        message:
          'each ORDER_SMS_NOTIFY_NUMBERS entry must be E.164 (e.g. +18091234567)',
      }),

    // Auth bypass
    AUTH_BYPASS_PHONES: z.string().default(''),
    AUTH_BYPASS_OTP_CODE: z.string().length(6).default('000000'),
    AUTH_BOOTSTRAP_ADMIN_PHONES: z.string().default(''),

    // ─────────────────────────────────────────────────────────────────────
    // OTP delivery mode — controls whether codes are sent + verified at login.
    //
    //   disabled  — DEFAULT. Phone-only login: no code is sent and verifyOtp
    //               authenticates by phone alone. This is the canonical product
    //               behavior. SECURITY: anyone who knows a registered phone can
    //               sign in as that user — there is no second factor.
    //   whatsapp  — RE-ENABLE OTP via Meta WhatsApp Cloud API template.
    //               WHATSAPP_PHONE_NUMBER_ID + WHATSAPP_ACCESS_TOKEN +
    //               WHATSAPP_OTP_TEMPLATE_NAME must be set (enforced in prod).
    //   sandbox   — RE-ENABLE OTP for testing. Same Meta send path, but the
    //               production config guard is relaxed (use Meta test numbers /
    //               an unverified app's allow-listed testers).
    //
    // Default is `disabled` (phone-only). Set AUTH_OTP_MODE=whatsapp|sandbox to
    // turn verified login back on — the OTP code path is dormant, not deleted.
    AUTH_OTP_MODE: z
      .enum(['whatsapp', 'sandbox', 'disabled'])
      .default('disabled'),

    // App
    CORS_ORIGIN: z.string().default('http://localhost:5173'),
    API_PORT: z.coerce.number().default(3001),
    PUBLIC_WEB_URL: z.string().default('http://localhost:5173'),

    // Sentry
    // Optional by design — dev/test boots without it. But if set, the value
    // must be a real DSN: a URL starting with `https://`. We reject `http://`
    // outright because Sentry's ingest endpoints are always HTTPS, and a
    // typo'd `http://` would silently drop every event. An empty string is
    // accepted as "not set" so operators can clear the secret via tooling
    // that doesn't support delete (most secret managers don't).
    SENTRY_DSN: z
      .union([
        z.string().startsWith('https://', {
          message: 'SENTRY_DSN must start with https://',
        }),
        z.literal(''),
      ])
      .optional(),
    SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),
    SENTRY_PROFILES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),
  })
  .superRefine((env, ctx) => {
    // Rule 1 — DB_SSL='ca' requires DB_SSL_CA.
    if (env.DB_SSL === 'ca' && !env.DB_SSL_CA) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DB_SSL_CA'],
        message: 'DB_SSL_CA is required when DB_SSL=ca',
      });
    }
    // Rule 2 — production must have DB_SYNCHRONIZE='false'.
    if (env.NODE_ENV === 'production' && env.DB_SYNCHRONIZE !== 'false') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DB_SYNCHRONIZE'],
        message: 'DB_SYNCHRONIZE must be "false" in production',
      });
    }
    // Rule 3 — production must have a Sentry DSN so 5xx errors aren't silently
    // lost. Without it the AllExceptionsFilter still logs locally, but there's
    // no remote aggregation and noisy regressions go unnoticed.
    if (env.NODE_ENV === 'production' && !env.SENTRY_DSN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SENTRY_DSN'],
        message: 'SENTRY_DSN is required in production',
      });
    }
    // Rule 4 — production WhatsApp OTP (Meta Cloud API) requires the full trio:
    // phone number id, access token, and the approved template name. Without
    // any one of them no business-initiated message can be sent. We only
    // enforce this when OTP is actually turned on in production
    // (AUTH_OTP_MODE=whatsapp) so phone-only deploys and the relaxed 'sandbox'
    // testing mode boot without the Meta credentials.
    if (env.NODE_ENV === 'production' && env.AUTH_OTP_MODE === 'whatsapp') {
      const missing = [
        !env.WHATSAPP_PHONE_NUMBER_ID && 'WHATSAPP_PHONE_NUMBER_ID',
        !env.WHATSAPP_ACCESS_TOKEN && 'WHATSAPP_ACCESS_TOKEN',
        !env.WHATSAPP_OTP_TEMPLATE_NAME && 'WHATSAPP_OTP_TEMPLATE_NAME',
      ].filter((v): v is string => Boolean(v));
      for (const key of missing) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} is required in production when AUTH_OTP_MODE=whatsapp`,
        });
      }
    }
    // Rule 5 — AUTH_BYPASS production guard (FIX C1).
    // Auth bypass exists for dev/test/E2E so engineers and CI can log in
    // without burning real WhatsApp/SMS credits. The default code is
    // '000000', which is trivially guessable. If that combo leaks into
    // production with a non-empty AUTH_BYPASS_PHONES, ANY attacker who
    // guesses an allow-listed phone can sign in as that user.
    //
    // Enforce, in production only, when AUTH_BYPASS_PHONES is non-empty:
    //   a) AUTH_BYPASS_OTP_CODE must NOT be '000000', must be ≥6 chars,
    //      and must be all digits — i.e. a real random 6+ digit code.
    //   b) Every phone in AUTH_BYPASS_PHONES must be in the NANP test range
    //      `+1555555XXXX` (E.164 reserved-for-testing) so even if the code
    //      leaks the only victim is a fake number.
    //
    // When AUTH_BYPASS_PHONES is empty in production, the bypass is
    // effectively off — we let that pass through without restrictions on
    // AUTH_BYPASS_OTP_CODE.
    const bypassPhones = env.AUTH_BYPASS_PHONES.split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (env.NODE_ENV === 'production' && bypassPhones.length > 0) {
      const code = env.AUTH_BYPASS_OTP_CODE;
      if (
        !code ||
        code === '000000' ||
        code.length < 6 ||
        !/^\d+$/.test(code)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['AUTH_BYPASS_OTP_CODE'],
          message:
            'AUTH_BYPASS_OTP_CODE in production must be a real random 6+ digit code (not "000000")',
        });
      }
      // NANP test range: +1 555 555 XXXX (4 trailing digits, 0100-0199 are
      // the canonical reserved-for-testing block but we accept the whole
      // +1555555XXXX block to keep this guard practical).
      const NANP_TEST_REGEX = /^\+1555555\d{4}$/;
      const badPhones = bypassPhones.filter((p) => !NANP_TEST_REGEX.test(p));
      if (badPhones.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['AUTH_BYPASS_PHONES'],
          message: `AUTH_BYPASS_PHONES in production must only contain NANP test phones (+1555555XXXX); rejected: ${badPhones.join(', ')}`,
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;
