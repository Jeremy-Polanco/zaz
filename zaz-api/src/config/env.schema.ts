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
  STRIPE_SUBSCRIPTION_PRICE_ID: z.string().optional(),

  // Twilio
  TWILIO_ACCOUNT_SID: z.string(),
  TWILIO_API_KEY_SID: z.string(),
  TWILIO_API_KEY_SECRET: z.string(),
  TWILIO_FROM_NUMBER: z.string(),

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
  });

export type Env = z.infer<typeof envSchema>;
