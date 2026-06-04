// Sentry initialization — MUST be imported before anything else in main.ts.
// If SENTRY_DSN is unset, this is a no-op and the app boots normally.
//
// Side effect ordering matters: @sentry/node patches Node's `http`,
// `https`, and a host of other modules at first import. If anything else
// imports those modules before this file runs, the instrumentation is
// silently missed. That's why main.ts does `import './instrument'` as
// its very first import.
import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import { scrubObject, stripQueryString } from './common/sentry/scrub';

if (process.env.SENTRY_DSN) {
  // ─────────────────────────────────────────────────────────────────────────
  // Release tagging — REQUIRED so uploaded source maps match incoming events.
  //
  // Sentry stores each uploaded artifact bundle under a `release` (and
  // optionally a `dist`) tag. If the event ingested at runtime doesn't carry
  // the same `release`, the symbolicator has no way to pick the right
  // bundle and stack traces stay minified — even though the maps are there.
  //
  // Priority order:
  //   1. SENTRY_RELEASE — set by the deploy pipeline so it can match the
  //      `--release` flag used in `sentry-cli sourcemaps upload`. Usually a
  //      git SHA, semver tag, or `${name}@${semver}+${sha}`.
  //   2. npm_package_version — auto-populated by Node when run via `npm`/
  //      `yarn` scripts. Falls back to the version in package.json. Useful
  //      as a default when SENTRY_RELEASE isn't wired up yet.
  //   3. undefined — events still ship, but won't be linked to maps. Logged
  //      as a warning at boot in case the deploy step was missed.
  // ─────────────────────────────────────────────────────────────────────────
  const release =
    process.env.SENTRY_RELEASE ?? process.env.npm_package_version;

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    release,
    environment: process.env.NODE_ENV,
    tracesSampleRate: parseFloat(
      process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.1',
    ),
    profilesSampleRate: parseFloat(
      process.env.SENTRY_PROFILES_SAMPLE_RATE ?? '0.1',
    ),
    integrations: [nodeProfilingIntegration()],
    // Don't send PII (phones, emails) to Sentry by default. The mobile and
    // backend code deliberately AVOID calling Sentry.setUser() — see the
    // "Not Linked" privacy declaration in dashgo/assets/PrivacyInfo.xcprivacy.
    // If you ever need per-request user context, scrub PII first.
    sendDefaultPii: false,
    // ─────────────────────────────────────────────────────────────────────
    // PII scrubbing — last line of defence (NC1 fix).
    //
    // sendDefaultPii: false stops Sentry's NODE SDK from auto-attaching
    // headers/cookies/IP, but it does NOT scrub:
    //   - request.data we attach via setupNestErrorHandler / contexts
    //   - query strings on request.url (OTP/phone/code leak hot-path:
    //     `/api/auth/verify-otp?phone=%2B...&code=123456`)
    //   - breadcrumbs the SDK auto-records (http requests, console logs)
    //   - extra/context objects callers pass to captureException()
    //
    // beforeSend walks the event right before transmission and redacts any
    // key matching SENSITIVE_KEY_REGEX at any depth (see common/sentry/scrub).
    // URLs are stripped to path-only so query params never reach Sentry.
    // ─────────────────────────────────────────────────────────────────────
    beforeSend(event) {
      if (event.request) {
        if (event.request.data) {
          event.request.data = scrubObject(
            event.request.data,
          ) as typeof event.request.data;
        }
        if (event.request.query_string) {
          event.request.query_string = '[redacted]';
        }
        if (event.request.headers) {
          event.request.headers = scrubObject(
            event.request.headers,
          ) as typeof event.request.headers;
        }
        if (event.request.cookies) {
          event.request.cookies =
            '[redacted]' as unknown as typeof event.request.cookies;
        }
        if (event.request.url) {
          event.request.url = stripQueryString(event.request.url);
        }
      }
      if (event.extra) {
        event.extra = scrubObject(event.extra) as typeof event.extra;
      }
      if (event.contexts) {
        for (const ctxKey of Object.keys(event.contexts)) {
          const ctx = event.contexts[ctxKey];
          event.contexts[ctxKey] = scrubObject(ctx) as typeof ctx;
        }
      }
      if (event.breadcrumbs) {
        event.breadcrumbs = event.breadcrumbs.map((b) => ({
          ...b,
          data: b.data
            ? (scrubObject(b.data) as Record<string, unknown>)
            : undefined,
        }));
      }
      return event;
    },
    beforeBreadcrumb(breadcrumb) {
      if (breadcrumb.data) {
        breadcrumb.data = scrubObject(breadcrumb.data) as Record<
          string,
          unknown
        >;
        if (
          breadcrumb.category === 'http' &&
          typeof breadcrumb.data.url === 'string'
        ) {
          breadcrumb.data.url = stripQueryString(breadcrumb.data.url);
        }
      }
      return breadcrumb;
    },
  });
}
