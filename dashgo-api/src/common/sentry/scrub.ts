/**
 * PII scrubbing helpers for Sentry events.
 *
 * NC1 (Sentry PII leak) fix. sendDefaultPii: false alone is insufficient:
 *   - setupNestErrorHandler attaches request.body / params / query to events
 *   - captureException(err, { contexts/extra: ... }) carries whatever the
 *     caller hands it — including OTP codes, JWT tokens, phone numbers
 *   - Auto-recorded breadcrumbs (http, console) capture URLs with query
 *     strings like ?phone=%2B...&code=123456
 *
 * This module exports a single allow-by-default redactor that walks objects
 * recursively, redacting any key whose name matches SENSITIVE_KEY_REGEX. It's
 * deliberately conservative: false positives (over-redacting) are cheap,
 * false negatives (leaking a token) are not.
 *
 * Used by:
 *   - dashgo-api: src/instrument.ts (Sentry.init beforeSend / beforeBreadcrumb)
 *   - dashgo-api: src/common/filters/all-exceptions.filter.ts (strips query
 *     strings before attaching request URL to Sentry context)
 *   - dashgo (mobile): src/lib/sentry.ts (mirrors the same posture)
 *
 * Keep dashgo/src/lib/sentry.ts's local copy in sync if you change the regex.
 */

/**
 * Case-insensitive match against any substring that smells like PII or a
 * secret. Matches whole-key, e.g. `phone`, `phoneNumber`, `authorization`,
 * `access_token`, `refreshToken`. We err on the side of redaction; adding
 * a key here costs nothing.
 *
 * Why each entry:
 *   - password/otp/code/token/jwt/secret/refresh/access — credentials
 *   - authorization/cookie — auth headers
 *   - phone/email/address/lat/lng — direct PII
 *   - card/cvv/ssn — payment / national-ID PII
 *   - signature/webhook — request signing secrets (Stripe, Twilio)
 */
export const SENSITIVE_KEY_REGEX =
  /password|otp|code|token|jwt|secret|refresh|access|authorization|cookie|phone|email|address|lat|lng|card|cvv|ssn|signature|webhook/i;

/**
 * Max recursion depth for {@link scrubObject}. Anything beyond this is replaced
 * with the literal string `[depth-limit]`. Two reasons for the cap:
 *   1. Defensive: a cyclic object reference would otherwise loop forever.
 *   2. Sentry truncates events at 200KB anyway, so deeply-nested payloads
 *      add cost for no benefit.
 *
 * 8 is empirically deep enough for our domain (deepest known: nested order
 * line-items inside an event context).
 */
export const SENTRY_SCRUB_DEPTH_LIMIT = 8;

/**
 * Recursively walk an arbitrary value and redact entries whose KEY matches
 * {@link SENSITIVE_KEY_REGEX}. Arrays are preserved (mapped element-wise),
 * primitives pass through, `null`/`undefined` pass through unchanged.
 *
 * Important behavior:
 *   - Redaction is by KEY NAME, not by value. This means `phone: "+1234"`
 *     becomes `phone: "[redacted]"`, but a raw string `"+1234567890"` sitting
 *     in `message: "..."` is NOT scrubbed. Callers shouldn't be putting raw
 *     PII into error messages — but if it happens, the URL-strip and
 *     beforeBreadcrumb hooks pick up the common cases.
 *   - The cap at {@link SENTRY_SCRUB_DEPTH_LIMIT} is enforced strictly:
 *     entries beyond that depth become the literal string `[depth-limit]`
 *     so the redactor can never stack-overflow on a cyclic graph.
 *
 * @param obj - Any value. Objects/arrays are walked; primitives returned as-is.
 * @param depth - Internal: current recursion depth. Callers pass 0 (default).
 * @returns A new value (object/array) with sensitive keys redacted, or the
 *   original primitive.
 */
export function scrubObject(obj: unknown, depth = 0): unknown {
  if (depth > SENTRY_SCRUB_DEPTH_LIMIT) return '[depth-limit]';
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) {
    return obj.map((item) => scrubObject(item, depth + 1));
  }
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (SENSITIVE_KEY_REGEX.test(key)) {
      result[key] = '[redacted]';
    } else {
      result[key] = scrubObject(value, depth + 1);
    }
  }
  return result;
}

/**
 * Strip the query string from a URL-like string. Returns the path/origin
 * portion only. Safe to call with malformed strings — falls back to splitting
 * on `?` so we never throw inside Sentry hooks.
 *
 * Examples:
 *   /api/auth/verify-otp?phone=%2B...&code=123456 -> /api/auth/verify-otp
 *   https://api.example.com/x?k=v                  -> https://api.example.com/x
 *   not-a-url                                       -> not-a-url
 */
export function stripQueryString(url: string): string {
  const q = url.indexOf('?');
  if (q < 0) return url;
  return url.slice(0, q);
}

/**
 * Patterns of raw PII that show up in STRING-VALUED Sentry fields
 * (exception.value, event.message, breadcrumb.message) where the
 * key-name scrubber can't help.
 *
 * Realistic leak surfaces this closes:
 *   - "Código inválido para teléfono +18095551234"
 *   - "Failed to verify OTP 123456 for user xyz"
 *   - "Invalid input: user@example.com is malformed"
 *
 * We deliberately over-match a little (e.g. 6–10 digit runs catch OTPs
 * AND timestamps). Over-redaction is cheap; leaked PII is not.
 */
const E164_PHONE_REGEX = /\+\d{8,15}/g;
const EMAIL_REGEX = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
// 6–10 standalone digits with word boundaries — matches OTPs, ZIP+plus4, and
// short numeric account IDs while avoiding UUID fragments (which have hex
// letters / dashes) and currency amounts (which have decimal points).
const DIGIT_RUN_REGEX = /\b\d{6,10}\b/g;

/**
 * Redact PII patterns inside a raw string. Pass anything; non-strings
 * return as-is. Safe inside Sentry hooks — never throws.
 *
 * Applied to:
 *   - event.exception.values[i].value
 *   - event.message
 *   - event.breadcrumbs[i].message
 *   - breadcrumb.message (in beforeBreadcrumb)
 *
 * Ordering matters: emails first (the leading-+ pattern could overlap with
 * E.164 inside a malformed email), then phones, then bare digit runs.
 */
export function scrubString(input: unknown): unknown {
  if (typeof input !== 'string') return input;
  return input
    .replace(EMAIL_REGEX, '[redacted-email]')
    .replace(E164_PHONE_REGEX, '[redacted-phone]')
    .replace(DIGIT_RUN_REGEX, '[redacted-digits]');
}
