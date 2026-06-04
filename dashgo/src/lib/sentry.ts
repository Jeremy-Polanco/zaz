/**
 * Canonical Sentry initialization for the mobile (Expo / React Native) app.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS / WHY IT INITIALIZES AT MODULE LOAD
 * ---------------------------------------------------------------------------
 * `Sentry.init` MUST run before any other code that might throw or perform
 * patched network I/O. ES module imports are hoisted and evaluated in
 * dependency order, so the ONLY reliable way to guarantee Sentry is armed
 * before `axios`, `expo-router`, `@stripe/stripe-react-native`, etc. is to:
 *
 *   1. Call `Sentry.init` at MODULE TOP LEVEL (not inside a function), and
 *   2. Have `_layout.tsx` import this file on its VERY FIRST line.
 *
 * If `Sentry.init` lived inside a component body or a `useEffect`, every
 * import preceding it would already have evaluated — and any boot-time
 * error in axios/Stripe/expo-router would crash the app with no breadcrumb.
 *
 * ---------------------------------------------------------------------------
 * PII / PRIVACY POSTURE
 * ---------------------------------------------------------------------------
 * The Apple privacy manifest declares "Not Linked" data collection. Sending
 * phone numbers, emails, tokens, or device identifiers to Sentry would
 * contradict that disclosure. Two layers of defense:
 *
 *   - `sendDefaultPii: false` disables Sentry's automatic PII enrichment.
 *   - `beforeSend` + `beforeBreadcrumb` recursively scrub well-known PII keys
 *     out of every event and breadcrumb before it leaves the device.
 *
 * `scrubObject` is intentionally local to this file so the mobile and API
 * sides can diverge if they need to (mobile cares about phone/email/token;
 * server cares about additional things like Stripe secrets). The KEYS list
 * below is the source of truth for the mobile app.
 *
 * ---------------------------------------------------------------------------
 * NO-DSN BEHAVIOR
 * ---------------------------------------------------------------------------
 * When `EXPO_PUBLIC_SENTRY_DSN` is unset (dev/preview without a DSN) we skip
 * `Sentry.init` entirely. All `Sentry.captureException` / `Sentry.wrap` calls
 * remain safe no-ops, so callers don't need to branch on DSN presence.
 */
import * as Sentry from '@sentry/react-native'
import Constants from 'expo-constants'

// ---------------------------------------------------------------------------
// PII scrubbing
// ---------------------------------------------------------------------------

/**
 * Lowercased key names that must NEVER be transmitted to Sentry. Matching is
 * case-insensitive and substring-based (`'authorization'` matches both
 * `'Authorization'` and `'x-authorization-bearer'`).
 *
 * Keep this list conservative — over-scrubbing is cheap; leaking PII is not.
 */
const PII_KEYS: readonly string[] = [
  'phone',
  'phonenumber',
  'whatsapp',
  'email',
  'emailaddress',
  'password',
  'token',
  'accesstoken',
  'refreshtoken',
  'authorization',
  'cookie',
  'set-cookie',
  'otp',
  'code',
  'pin',
  'secret',
  'apikey',
  'api_key',
  'creditcard',
  'cardnumber',
  'cvv',
  'cvc',
  'ssn',
  'dni',
  'cuit',
  'cuil',
]

const REDACTED = '[REDACTED]'

/**
 * Strip everything from the first `?` onward in a URL-like string. Returns
 * the path/origin portion only. Safe with malformed input — never throws,
 * since this runs inside Sentry hooks (a throw here would lose the event).
 *
 * Examples:
 *   `/api/auth/verify-otp?phone=%2B&code=123456` -> `/api/auth/verify-otp`
 *   `https://api.example.com/x?k=v`               -> `https://api.example.com/x`
 *   `not-a-url`                                    -> `not-a-url`
 *
 * Exported so tests can pin the behavior without going through Sentry.init.
 */
export function stripQueryString(url: string): string {
  const q = url.indexOf('?')
  if (q < 0) return url
  return url.slice(0, q)
}

/**
 * Recursively walk an object/array and replace the value of any key whose
 * lowercased name contains one of `PII_KEYS` with `'[REDACTED]'`. Returns a
 * NEW object — the input is never mutated, so callers can safely scrub a
 * Sentry event before returning it.
 *
 * Handles circular references via a `WeakSet` so a self-referential breadcrumb
 * (e.g. an Axios error whose `.config` points back to the error) won't loop.
 *
 * Exported for unit testing AND for re-use in case a partner module needs the
 * same scrubbing semantics (DRY — see `_layout.tsx` ordering note).
 */
export function scrubObject<T>(input: T, seen: WeakSet<object> = new WeakSet()): T {
  if (input === null || input === undefined) return input
  if (typeof input !== 'object') return input

  // Circular guard. Returning the placeholder rather than the original
  // reference avoids infinite recursion AND avoids leaking the unscrubbed
  // sub-tree via aliasing.
  if (seen.has(input as object)) return REDACTED as unknown as T
  seen.add(input as object)

  if (Array.isArray(input)) {
    return input.map((item) => scrubObject(item, seen)) as unknown as T
  }

  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const lowered = key.toLowerCase()
    const isPii = PII_KEYS.some((pii) => lowered.includes(pii))
    if (isPii) {
      out[key] = REDACTED
    } else if (value !== null && typeof value === 'object') {
      out[key] = scrubObject(value, seen)
    } else {
      out[key] = value
    }
  }
  return out as unknown as T
}

// ---------------------------------------------------------------------------
// Sentry init — runs ONCE at module load time
// ---------------------------------------------------------------------------

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN

if (DSN) {
  // ─────────────────────────────────────────────────────────────────────────
  // Release + dist tagging — REQUIRED so uploaded source maps match events.
  //
  // Sentry's symbolicator looks up uploaded JS bundles by (release, dist).
  // If the event ingested at runtime doesn't carry the same tags as the
  // upload, stack traces stay minified even though the maps are present.
  //
  // We build the release tag the way `@sentry/react-native` recommends:
  //   `${appName}@${version}+${buildNumber}`
  // (e.g. `dashgo@1.0.0+42`). This matches the format produced by the EAS
  // post-build sourcemap upload step. `dist` carries the platform-specific
  // build counter — `ios.buildNumber` or `android.versionCode` — which
  // Sentry uses to disambiguate multiple uploads sharing the same version.
  //
  // All three values come from expo-constants (populated from app.config.ts
  // at build time) rather than env vars, so the runtime tag is guaranteed
  // to match the binary's actual version metadata.
  // ─────────────────────────────────────────────────────────────────────────
  const expoCfg = Constants.expoConfig
  const appName = expoCfg?.name ?? 'dashgo'
  const version = expoCfg?.version ?? '0.0.0'
  const buildNumber =
    expoCfg?.ios?.buildNumber ??
    (expoCfg?.android?.versionCode != null
      ? String(expoCfg.android.versionCode)
      : '0')

  Sentry.init({
    dsn: DSN,
    release: `${appName}@${version}+${buildNumber}`,
    dist: buildNumber,
    environment: process.env.NODE_ENV ?? 'development',
    // Disable automatic PII enrichment. We layer scrubObject on top as a
    // defense-in-depth check for fields we add ourselves (extras, contexts,
    // breadcrumb data).
    sendDefaultPii: false,
    // Conservative sample rate — bump when actively investigating perf.
    tracesSampleRate: 0.1,
    integrations: [
      // Route-change breadcrumbs from expo-router. Without this, Sentry has
      // no idea which screen the user was on when an error occurred.
      Sentry.reactNavigationIntegration(),
    ],
    /**
     * Last-chance scrub before an event leaves the device. Runs AFTER
     * `sendDefaultPii: false` so we only see fields the app deliberately
     * attached (extras, tags, contexts, request/response bodies surfaced by
     * other integrations).
     *
     * In addition to key-name scrubbing, we strip query strings from
     * `event.request.url`. The OTP verify endpoint sends phone/code as query
     * params (`/api/auth/verify-otp?phone=...&code=...`) — without this
     * extra pass the URL lands in Sentry verbatim even though the key-name
     * scrubber wouldn't catch it (the leak is in the VALUE of `url`).
     */
    beforeSend(event) {
      const scrubbed = scrubObject(event)
      if (scrubbed?.request?.url && typeof scrubbed.request.url === 'string') {
        scrubbed.request.url = stripQueryString(scrubbed.request.url)
      }
      return scrubbed
    },
    /**
     * Breadcrumbs are the noisiest source of accidental PII (HTTP request
     * URLs with query params, console.log of user objects, etc.). Scrub
     * every breadcrumb the same way we scrub events, then strip query
     * strings from any `data.url` (http/navigation/fetch all leak here).
     */
    beforeBreadcrumb(breadcrumb) {
      const scrubbed = scrubObject(breadcrumb)
      if (
        scrubbed?.data &&
        typeof scrubbed.data === 'object' &&
        typeof (scrubbed.data as { url?: unknown }).url === 'string'
      ) {
        const data = scrubbed.data as { url: string }
        data.url = stripQueryString(data.url)
      }
      return scrubbed
    },
  })
}

/**
 * Re-export Sentry for convenience so callers can do
 *   `import { Sentry } from '../lib/sentry'`
 * instead of importing both this module (for the side-effect init) and
 * `@sentry/react-native` separately.
 */
export { Sentry }
