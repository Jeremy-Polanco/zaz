import { z } from 'zod';

const E164_REGEX = /^\+[1-9]\d{9,14}$/;

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

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
  STRIPE_SECRET_KEY: z.string(),
  STRIPE_WEBHOOK_SECRET: z.string(),
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
        path: hasWaFrom ? ['TWILIO_WHATSAPP_OTP_TEMPLATE_SID'] : ['TWILIO_WHATSAPP_FROM'],
        message:
          'TWILIO_WHATSAPP_FROM and TWILIO_WHATSAPP_OTP_TEMPLATE_SID must be set together in production',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;
