/**
 * FIX HIGH-G7 — Distinct error codes per WhatsApp failure type.
 *
 * Mirror of dashgo-api/src/modules/auth/whatsapp-error-codes.ts. Do NOT
 * diverge — both files must agree on the exact string literals, otherwise
 * the mobile UI will silently fall through to the generic catch-all. The
 * literals are provider-agnostic: the backend now sends WhatsApp OTP via
 * Meta's WhatsApp Cloud API (was Twilio), but these codes did not change.
 *
 * Why a copy instead of a shared package: the repo isn't a yarn-workspace
 * monorepo, so we have no published shared module. Three string literals
 * + a per-code message map is small enough that duplication is cheaper
 * than introducing a publish pipeline.
 */

export const WHATSAPP_ERROR_CODES = {
  /** Catch-all transient failure — generic 5xx, network, token/template config, unknown. Retry OK. */
  WHATSAPP_SEND_FAILED: 'WHATSAPP_SEND_FAILED',
  /** Meta rate/throughput limit (HTTP 429 or 130429/131048/133016…). Retry with longer backoff. */
  WHATSAPP_RATE_LIMITED: 'WHATSAPP_RATE_LIMITED',
  /** Meta 131009 — recipient number is malformed/not valid. User must fix. */
  WHATSAPP_RECIPIENT_INVALID: 'WHATSAPP_RECIPIENT_INVALID',
  /** Meta 131026/131030 — recipient cannot receive (no WhatsApp / not reachable). No retry. */
  WHATSAPP_RECIPIENT_NOT_REACHABLE: 'WHATSAPP_RECIPIENT_NOT_REACHABLE',
} as const

export type WhatsAppErrorCode =
  (typeof WHATSAPP_ERROR_CODES)[keyof typeof WHATSAPP_ERROR_CODES]

/**
 * Extract the structured `code` field from a thrown HTTP error response.
 * Returns null if no recognized WhatsApp code is present.
 */
export function extractWhatsAppErrorCode(err: unknown): WhatsAppErrorCode | null {
  const e = err as
    | {
        response?: {
          status?: number
          data?: { code?: string; message?: string }
        }
      }
    | undefined
  if (!e) return null
  const code = e.response?.data?.code
  if (typeof code === 'string') {
    if (code === WHATSAPP_ERROR_CODES.WHATSAPP_SEND_FAILED) return code
    if (code === WHATSAPP_ERROR_CODES.WHATSAPP_RATE_LIMITED) return code
    if (code === WHATSAPP_ERROR_CODES.WHATSAPP_RECIPIENT_INVALID) return code
    if (code === WHATSAPP_ERROR_CODES.WHATSAPP_RECIPIENT_NOT_REACHABLE) return code
  }
  // Fallback: a 503 from /auth/otp/send is almost always WhatsApp-related
  // because the only outbound dependency of that endpoint is the Meta
  // WhatsApp Cloud API. Map it to the catch-all so the user still sees the
  // graceful failure UX.
  if (e.response?.status === 503) {
    return WHATSAPP_ERROR_CODES.WHATSAPP_SEND_FAILED
  }
  return null
}

/** Phone number for the "Llamar a soporte" CTA on not-reachable failures. */
export const SUPPORT_PHONE = '+18005551234'
