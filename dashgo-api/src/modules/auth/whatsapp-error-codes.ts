/**
 * FIX HIGH-G7 — Distinct error codes per Twilio failure type.
 *
 * Previously the backend emitted a single `WHATSAPP_SEND_FAILED` for every
 * Twilio failure. That collapsed three very different UX paths into one:
 *
 *   - User has no WhatsApp on this number  → should call support, not retry
 *   - User typed an invalid phone number    → should fix the input
 *   - Twilio is rate-limited / down         → should retry with backoff
 *
 * This module is the SINGLE source of truth for those codes. Both the
 * backend exception body and the mobile pattern-match consume it.
 *
 * KEEP IN SYNC with dashgo/src/lib/whatsapp-error-codes.ts — the mobile app
 * imports the same string literals as a separate copy. If you change a code
 * here, change it there too.
 *
 * Twilio reference (REST API error codes):
 *   - 21211 → "Invalid 'To' Phone Number"
 *   - 21614 → "'To' number is not a valid mobile number"
 *   - 63003 → "Channel could not find To address" (no WhatsApp on number)
 *   - 63016 → "Failed to send freeform message because you are outside the
 *              allowed window" (treated as not-reachable for OTP UX)
 *   - HTTP 429 → rate limit (transient)
 */

export const WHATSAPP_ERROR_CODES = {
  /** Catch-all transient failure — generic 5xx, network, unknown. Retry OK. */
  WHATSAPP_SEND_FAILED: 'WHATSAPP_SEND_FAILED',
  /** Twilio returned HTTP 429. Retry with longer backoff. */
  WHATSAPP_RATE_LIMITED: 'WHATSAPP_RATE_LIMITED',
  /** Twilio 21211/21614 — phone number is malformed/not mobile. User must fix. */
  WHATSAPP_RECIPIENT_INVALID: 'WHATSAPP_RECIPIENT_INVALID',
  /** Twilio 63003/63016 — recipient does not have WhatsApp. No retry. */
  WHATSAPP_RECIPIENT_NOT_REACHABLE: 'WHATSAPP_RECIPIENT_NOT_REACHABLE',
} as const;

export type WhatsAppErrorCode =
  (typeof WHATSAPP_ERROR_CODES)[keyof typeof WHATSAPP_ERROR_CODES];

/**
 * Classify a thrown Twilio error into one of the WhatsAppErrorCode buckets.
 *
 * The Twilio SDK throws `RestException`-shaped objects with `status` (HTTP
 * status) and `code` (Twilio numeric error code) properties. We pattern match
 * on both, falling back to WHATSAPP_SEND_FAILED for anything we don't
 * recognize so the UX always has *some* code to switch on.
 */
export function classifyTwilioError(err: unknown): WhatsAppErrorCode {
  const e = err as
    | { status?: number; code?: number | string; message?: string }
    | null
    | undefined;
  if (!e || typeof e !== 'object') {
    return WHATSAPP_ERROR_CODES.WHATSAPP_SEND_FAILED;
  }

  const status = typeof e.status === 'number' ? e.status : undefined;
  // Twilio SDK historically returns `code` as a number, but some surfaces
  // (e.g. error.message parsing) hand back strings — normalize to number.
  const rawCode = e.code;
  const numericCode =
    typeof rawCode === 'number'
      ? rawCode
      : typeof rawCode === 'string' && /^\d+$/.test(rawCode)
        ? Number.parseInt(rawCode, 10)
        : undefined;

  // Recipient-not-reachable takes priority over status because Twilio still
  // returns a 4xx alongside these codes — the *reason* (no WhatsApp) is the
  // actionable signal for the user, not the HTTP status.
  if (numericCode === 63003 || numericCode === 63016) {
    return WHATSAPP_ERROR_CODES.WHATSAPP_RECIPIENT_NOT_REACHABLE;
  }
  if (numericCode === 21211 || numericCode === 21614) {
    return WHATSAPP_ERROR_CODES.WHATSAPP_RECIPIENT_INVALID;
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
