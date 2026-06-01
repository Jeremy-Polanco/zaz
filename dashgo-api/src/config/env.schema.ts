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
    // FIX CRITICAL-G2 — both keys must be non-empty when set. An empty
    // string used to slip through (`z.string()` accepts ''), and the
    // runtime guard treated empty as "payments intentionally disabled".
    // That meant `STRIPE_SECRET_KEY=""` punched a hole through every
    // production Stripe guard. Require at least one character; the runtime
    // guard separately rejects empty in production with a clear message.
    STRIPE_SECRET_KEY: z.string().min(1),
    STRIPE_WEBHOOK_SECRET: z.string().min(1),
    // Optional by design: SubscriptionService bootstraps the row from this env
    // var on startup IFF the `subscription_plan` table is empty. Operators can
    // instead seed `subscription_plan` directly and leave this unset. If both
    // are absent, subscription routes return 4xx until the table is populated.
    STRIPE_SUBSCRIPTION_PRICE_ID: z.string().optional(),

    // Twilio
    TWILIO_ACCOUNT_SID: z.string(),
    TWILIO_API_KEY_SID: z.string(),
    TWILIO_API_KEY_SECRET: z.string(),
    TWILIO_FROM_NUMBER: z.string(),

    // WhatsApp Business via Twilio (production OTP path).
    // TWILIO_WHATSAPP_FROM is the sender, format: `whatsapp:+1<number>`. For
    //   the Twilio sandbox use `whatsapp:+14155238886`.
    // TWILIO_WHATSAPP_OTP_TEMPLATE_SID is the Content Template SID (HX…) for
    //   the approved Spanish authentication template. Required outside the
    //   sandbox because business-initiated WhatsApp messages MUST use a
    //   pre-approved template per Meta policy. When missing, TwilioService
    //   falls back to free-form text — only works on the Twilio sandbox where
    //   each tester has joined with `join <code>`.
    TWILIO_WHATSAPP_FROM: z.string().optional(),
    TWILIO_WHATSAPP_OTP_TEMPLATE_SID: z.string().optional(),

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

    // App
    CORS_ORIGIN: z.string().default('http://localhost:5173'),
    API_PORT: z.coerce.number().default(3001),
    PUBLIC_WEB_URL: z.string().default('http://localhost:5173'),

    // Sentry
    SENTRY_DSN: z.union([z.string().url(), z.literal('')]).optional(),
    SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),
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
    // Rule 4 — production WhatsApp OTP requires both the sender and the
    // approved template SID. Without the template SID, business-initiated
    // messages are rejected by Meta; without the sender, no message gets
    // sent at all. We allow them to BOTH be absent (boot keeps working,
    // OTP fails loudly at send-time) so non-API services don't get blocked
    // by Twilio outages, but if one is set the other must be too.
    const hasWaFrom = !!env.TWILIO_WHATSAPP_FROM;
    const hasWaTemplate = !!env.TWILIO_WHATSAPP_OTP_TEMPLATE_SID;
    if (env.NODE_ENV === 'production' && hasWaFrom !== hasWaTemplate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: hasWaFrom
          ? ['TWILIO_WHATSAPP_OTP_TEMPLATE_SID']
          : ['TWILIO_WHATSAPP_FROM'],
        message:
          'TWILIO_WHATSAPP_FROM and TWILIO_WHATSAPP_OTP_TEMPLATE_SID must be set together in production',
      });
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
