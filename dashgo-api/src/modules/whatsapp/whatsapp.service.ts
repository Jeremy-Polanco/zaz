import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WhatsAppApiError } from './whatsapp-api.error';

const SEEDED_DEV_PHONE_REGEX = /^\+1555555\d{4}$/;
const DEFAULT_API_VERSION = 'v22.0';
const GRAPH_BASE = 'https://graph.facebook.com';

/**
 * Sends WhatsApp OTP codes through Meta's WhatsApp Cloud API directly
 * (graph.facebook.com), NOT through Twilio. Twilio is retained only for SMS
 * (admin order notifications + the dormant SMS fallback) — see TwilioService.
 *
 * Why direct-to-Meta: we are not a BSP reseller's tenant, so we own the WABA,
 * skip Twilio's per-message markup, and avoid being locked into Twilio's Meta
 * business portfolio. The gating (business verification, template approval,
 * messaging tiers) is Meta's either way.
 *
 * Production path: business-initiated messages MUST use a pre-approved template
 * (Meta policy). We send the approved authentication template by name and pass
 * the OTP code as the single body variable (and, for authentication-category
 * templates, the copy-code/one-tap button variable too).
 *
 * Dev seed bypass: phones matching `+1555555XXXX` are logged to console (same
 * convention as TwilioService) so seeded e2e users never hit Meta.
 */
@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);
  private readonly phoneNumberId: string | null;
  private readonly accessToken: string | null;
  private readonly templateName: string | null;
  private readonly templateLang: string;
  private readonly apiVersion: string;
  /**
   * Authentication-category templates ship with a copy-code / one-tap button
   * by default; Meta then requires the OTP echoed in a button component on send
   * or the request is rejected (132000 param mismatch). Set
   * WHATSAPP_OTP_TEMPLATE_HAS_BUTTON=false for a body-only template.
   */
  private readonly hasCopyCodeButton: boolean;

  constructor(private readonly config: ConfigService) {
    this.phoneNumberId = config.get<string>('WHATSAPP_PHONE_NUMBER_ID') ?? null;
    this.accessToken = config.get<string>('WHATSAPP_ACCESS_TOKEN') ?? null;
    this.templateName =
      config.get<string>('WHATSAPP_OTP_TEMPLATE_NAME') ?? null;
    this.templateLang =
      config.get<string>('WHATSAPP_OTP_TEMPLATE_LANG') ?? 'es';
    this.apiVersion =
      config.get<string>('WHATSAPP_API_VERSION') ?? DEFAULT_API_VERSION;
    this.hasCopyCodeButton =
      config.get<string>('WHATSAPP_OTP_TEMPLATE_HAS_BUTTON') !== 'false';

    if (this.isConfigured) {
      this.logger.log(
        `WhatsApp Cloud API initialized (phoneNumberId=…${this.phoneNumberId.slice(
          -4,
        )}, template=${this.templateName}/${this.templateLang}, api=${
          this.apiVersion
        }, button=${this.hasCopyCodeButton})`,
      );
    } else {
      const missing = [
        !this.phoneNumberId && 'WHATSAPP_PHONE_NUMBER_ID',
        !this.accessToken && 'WHATSAPP_ACCESS_TOKEN',
        !this.templateName && 'WHATSAPP_OTP_TEMPLATE_NAME',
      ].filter(Boolean);
      this.logger.warn(
        `WhatsApp Cloud API disabled — missing: ${missing.join(
          ', ',
        )}. OTPs will be logged to console (non-production).`,
      );
    }
  }

  private get isConfigured(): boolean {
    return !!(this.phoneNumberId && this.accessToken && this.templateName);
  }

  /**
   * Send a 6-digit OTP code via the Meta WhatsApp Cloud API authentication
   * template. Throws {@link WhatsAppApiError} on any non-2xx response or
   * network failure so auth.service can classify it.
   */
  async sendOtp(to: string, code: string): Promise<void> {
    if (SEEDED_DEV_PHONE_REGEX.test(to)) {
      this.logger.log(
        `[DEV SEED OTP] → whatsapp:${to}: Tu código DashGo es ${code}. Vence en 5 min.`,
      );
      return;
    }

    if (!this.isConfigured) {
      if (process.env.NODE_ENV === 'production') {
        throw new WhatsAppApiError({
          message:
            'WhatsApp Cloud API is not configured — cannot send OTP in production',
        });
      }
      this.logger.log(
        `[DEV OTP] → whatsapp:${to}: Tu código DashGo es ${code}. Vence en 5 min.`,
      );
      return;
    }

    const components: unknown[] = [
      { type: 'body', parameters: [{ type: 'text', text: code }] },
    ];
    if (this.hasCopyCodeButton) {
      components.push({
        type: 'button',
        sub_type: 'url',
        index: '0',
        parameters: [{ type: 'text', text: code }],
      });
    }

    await this.postTemplate(to, this.templateName!, this.templateLang, components);
  }

  /**
   * Send an arbitrary pre-approved template (utility/marketing) with plain
   * text body variables — used for order-status updates and win-back
   * reminders. Unlike sendOtp this NEVER throws when unconfigured: business
   * notifications are best-effort and must not break the calling flow, so we
   * log-and-skip instead. Throws WhatsAppApiError only on a real Meta/network
   * failure (callers catch and log).
   *
   * Returns true when a message was handed to Meta, false when skipped.
   */
  async sendTemplate(
    to: string,
    templateName: string | null | undefined,
    bodyParams: string[],
    lang?: string,
  ): Promise<boolean> {
    const preview = `${templateName}(${bodyParams.join(', ')})`;
    if (SEEDED_DEV_PHONE_REGEX.test(to)) {
      this.logger.log(`[DEV SEED TEMPLATE] → whatsapp:${to}: ${preview}`);
      return false;
    }
    if (!templateName || !this.phoneNumberId || !this.accessToken) {
      this.logger.log(
        `[TEMPLATE SKIPPED — not configured] → whatsapp:${to}: ${preview}`,
      );
      return false;
    }

    const components: unknown[] = [
      {
        type: 'body',
        parameters: bodyParams.map((text) => ({ type: 'text', text })),
      },
    ];
    await this.postTemplate(to, templateName, lang ?? this.templateLang, components);
    return true;
  }

  private async postTemplate(
    to: string,
    templateName: string,
    lang: string,
    components: unknown[],
  ): Promise<void> {
    const url = `${GRAPH_BASE}/${this.apiVersion}/${this.phoneNumberId}/messages`;

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      // Meta wants the recipient in international format without the leading `+`.
      to: to.replace(/^\+/, ''),
      type: 'template',
      template: {
        name: templateName,
        language: { code: lang },
        components,
      },
    };

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      // Transport-level failure (DNS, socket, timeout) — no HTTP status. Surface
      // as a generic WhatsAppApiError so it classifies to WHATSAPP_SEND_FAILED.
      throw new WhatsAppApiError({
        message: `WhatsApp Cloud API network error: ${(err as Error).message}`,
        cause: err,
      });
    }

    if (!res.ok) {
      let metaCode: number | undefined;
      let metaSubcode: number | undefined;
      let metaMessage = `WhatsApp Cloud API HTTP ${res.status}`;
      try {
        const data = (await res.json()) as {
          error?: { code?: number; error_subcode?: number; message?: string };
        };
        if (typeof data.error?.code === 'number') metaCode = data.error.code;
        if (typeof data.error?.error_subcode === 'number') {
          metaSubcode = data.error.error_subcode;
        }
        if (data.error?.message) metaMessage = data.error.message;
      } catch {
        // Body was not JSON — keep the HTTP-status fallback message.
      }
      throw new WhatsAppApiError({
        status: res.status,
        code: metaCode,
        subcode: metaSubcode,
        message: metaMessage,
      });
    }
    // 2xx — Meta accepted the message for delivery. Final delivery status would
    // arrive via webhook; for OTP UX, acceptance is sufficient.
  }
}
