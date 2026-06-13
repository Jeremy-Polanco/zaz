/**
 * Error thrown by WhatsAppService when Meta's Graph API rejects (or fails to
 * receive) an OTP send.
 *
 * It carries the two fields the classifier dispatches on:
 *   - `status` — the HTTP status of the Graph API response (e.g. 400, 429, 500)
 *   - `code`   — Meta's numeric `error.code` from the JSON body (e.g. 131026)
 *
 * Keeping the SAME `{ status, code }` shape the old Twilio RestException
 * exposed means `classifyWhatsAppError` can stay a thin pattern-match and the
 * auth.service failure-handling block does not change its structure.
 */
export class WhatsAppApiError extends Error {
  /** HTTP status of the Graph API response, when there was one. */
  readonly status?: number;
  /** Meta numeric error code (`error.code`), when present in the body. */
  readonly code?: number;
  /** Meta error subcode (`error.error_subcode`), for diagnostics only. */
  readonly subcode?: number;

  constructor(opts: {
    status?: number;
    code?: number;
    subcode?: number;
    message?: string;
    cause?: unknown;
  }) {
    super(opts.message ?? 'WhatsApp Cloud API error');
    this.name = 'WhatsAppApiError';
    this.status = opts.status;
    this.code = opts.code;
    this.subcode = opts.subcode;
    if (opts.cause !== undefined) {
      (this as { cause?: unknown }).cause = opts.cause;
    }
  }
}
