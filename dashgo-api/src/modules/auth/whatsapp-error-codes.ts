/**
 * FIX HIGH-G7 — Distinct error codes per WhatsApp send failure type.
 *
 * Previously the backend emitted a single `WHATSAPP_SEND_FAILED` for every
 * delivery failure. That collapsed three very different UX paths into one:
 *
 *   - User has no WhatsApp on this number  → should call support, not retry
 *   - User typed an invalid phone number    → should fix the input
 *   - Provider is rate-limited / down       → should retry with backoff
 *
 * This module is the SINGLE source of truth for those codes. Both the
 * backend exception body and the mobile pattern-match consume it.
 *
 * KEEP IN SYNC with dashgo/src/lib/whatsapp-error-codes.ts — the mobile app
 * imports the same string literals as a separate copy. If you change a code
 * here, change it there too. The string literals are provider-agnostic and
 * MUST NOT change: the mobile app switches on them regardless of whether the
 * backend talks to Twilio or Meta.
 *
 * Provider: Meta WhatsApp Cloud API (graph.facebook.com). The numeric codes
 * below come from Meta's `error.code` field. Reference:
 *   - 131026 → "Message undeliverable" (recipient cannot receive — typically
 *              has no WhatsApp account, or the number is not a WhatsApp user)
 *   - 131030 → "Recipient phone number not in allowed list" (sandbox/unverified
 *              app can only message numbers added as testers) → not reachable
 *   - 131009 → "Parameter value is not valid" (the recipient `to` is malformed)
 *   - 130429 → "Rate limit hit" (throughput cap)
 *   - 131048 → "Spam rate limit hit"
 *   - 133016 → "Account temporarily blocked due to rate limiting"
 *   - 80007 / 4 → application/business request limit reached
 *   - HTTP 429 → rate limit (transient)
 *   - 132xxx → template errors (missing/disabled/param mismatch) → our config
 *              problem, generic retry bucket
 *   - 190 → access token expired/invalid → our config problem, generic bucket
 */

export const WHATSAPP_ERROR_CODES = {
  /** Catch-all transient failure — generic 5xx, network, token/template config, unknown. Retry OK. */
  WHATSAPP_SEND_FAILED: 'WHATSAPP_SEND_FAILED',
  /** Meta rate/throughput limit (HTTP 429 or 130429/131048/133016/80007/4). Retry with longer backoff. */
  WHATSAPP_RATE_LIMITED: 'WHATSAPP_RATE_LIMITED',
  /** Meta 131009 — recipient number is malformed/not valid. User must fix. */
  WHATSAPP_RECIPIENT_INVALID: 'WHATSAPP_RECIPIENT_INVALID',
  /** Meta 131026/131030 — recipient cannot receive (no WhatsApp / not reachable). No retry. */
  WHATSAPP_RECIPIENT_NOT_REACHABLE: 'WHATSAPP_RECIPIENT_NOT_REACHABLE',
} as const;

export type WhatsAppErrorCode =
  (typeof WHATSAPP_ERROR_CODES)[keyof typeof WHATSAPP_ERROR_CODES];

// Meta numeric error codes, grouped by the bucket they map to.
const META_NOT_REACHABLE_CODES = new Set([131026, 131030]);
const META_RECIPIENT_INVALID_CODES = new Set([131009]);
const META_RATE_LIMIT_CODES = new Set([130429, 131048, 133016, 80007, 4]);

/**
 * Classify a thrown WhatsApp send error into one of the WhatsAppErrorCode
 * buckets.
 *
 * WhatsAppService throws {@link WhatsAppApiError}-shaped objects with `status`
 * (HTTP status) and `code` (Meta numeric error code) properties. We pattern
 * match on both, falling back to WHATSAPP_SEND_FAILED for anything we don't
 * recognize so the UX always has *some* code to switch on.
 *
 * NOTE: SendOtpDto already validates E.164 before we ever call Meta, so a
 * malformed-recipient error is rare in steady state. Auth-token (190) and
 * template (132xxx) errors deliberately fall through to WHATSAPP_SEND_FAILED
 * (generic retry) rather than being mislabeled as "your number is invalid".
 */
export function classifyWhatsAppError(err: unknown): WhatsAppErrorCode {
  const e = err as
    | { status?: number; code?: number | string; message?: string }
    | null
    | undefined;
  if (!e || typeof e !== 'object') {
    return WHATSAPP_ERROR_CODES.WHATSAPP_SEND_FAILED;
  }

  const status = typeof e.status === 'number' ? e.status : undefined;
  // Meta returns `code` as a number, but normalize defensively in case a
  // surface hands back a numeric string.
  const rawCode = e.code;
  const numericCode =
    typeof rawCode === 'number'
      ? rawCode
      : typeof rawCode === 'string' && /^\d+$/.test(rawCode)
        ? Number.parseInt(rawCode, 10)
        : undefined;

  // Recipient-not-reachable takes priority — it's the most actionable signal
  // for the user (no WhatsApp on this number → call support, don't retry).
  if (numericCode !== undefined && META_NOT_REACHABLE_CODES.has(numericCode)) {
    return WHATSAPP_ERROR_CODES.WHATSAPP_RECIPIENT_NOT_REACHABLE;
  }
  if (
    numericCode !== undefined &&
    META_RECIPIENT_INVALID_CODES.has(numericCode)
  ) {
    return WHATSAPP_ERROR_CODES.WHATSAPP_RECIPIENT_INVALID;
  }
  if (numericCode !== undefined && META_RATE_LIMIT_CODES.has(numericCode)) {
    return WHATSAPP_ERROR_CODES.WHATSAPP_RATE_LIMITED;
  }
  if (status === 429) {
    return WHATSAPP_ERROR_CODES.WHATSAPP_RATE_LIMITED;
  }
  return WHATSAPP_ERROR_CODES.WHATSAPP_SEND_FAILED;
}

/**
 * Human-readable Spanish message per code. Used in the exception body so the
 * mobile client can show a sensible default even if it hasn't been updated
 * to recognize a new code yet.
 */
export const WHATSAPP_ERROR_MESSAGES: Record<WhatsAppErrorCode, string> = {
  [WHATSAPP_ERROR_CODES.WHATSAPP_SEND_FAILED]:
    'No pudimos enviar el código por WhatsApp. Probá de nuevo en unos minutos.',
  [WHATSAPP_ERROR_CODES.WHATSAPP_RATE_LIMITED]:
    'Hay mucho tráfico en este momento. Probá de nuevo en 30 segundos.',
  [WHATSAPP_ERROR_CODES.WHATSAPP_RECIPIENT_INVALID]:
    'El número no parece válido. Revisalo y probá de nuevo.',
  [WHATSAPP_ERROR_CODES.WHATSAPP_RECIPIENT_NOT_REACHABLE]:
    'No detectamos WhatsApp en este número. ¿Querés que te llamemos?',
};

/**
 * Permanent codes — HTTP 400 BadRequest semantics. The user must change
 * something (the phone number) before a retry can possibly succeed.
 */
export const PERMANENT_WHATSAPP_ERROR_CODES: ReadonlySet<WhatsAppErrorCode> =
  new Set([
    WHATSAPP_ERROR_CODES.WHATSAPP_RECIPIENT_INVALID,
    WHATSAPP_ERROR_CODES.WHATSAPP_RECIPIENT_NOT_REACHABLE,
  ]);
