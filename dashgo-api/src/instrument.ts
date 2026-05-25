// Sentry initialization — MUST be imported before anything else in main.ts.
// If SENTRY_DSN is unset, this is a no-op and the app boots normally.
import * as Sentry from '@sentry/node';

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? 'development',
    tracesSampleRate: parseFloat(
      process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.1',
    ),
    // Don't send PII (phones, emails) to Sentry by default. Override per-request
    // with Sentry.setUser() if you need to identify the user in an event.
    sendDefaultPii: false,
  });
}
