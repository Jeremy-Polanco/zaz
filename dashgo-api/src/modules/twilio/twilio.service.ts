import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import twilio, { Twilio } from 'twilio';
import type { Order } from '../../entities/order.entity';

const SEEDED_DEV_PHONE_REGEX = /^\+1555555\d{4}$/;

@Injectable()
export class TwilioService {
  private readonly logger = new Logger(TwilioService.name);
  private readonly client: Twilio | null;
  private readonly fromNumber: string | null;
  /** WhatsApp sender, format `whatsapp:+1<number>`. Sandbox: `whatsapp:+14155238886`. */
  private readonly whatsappFrom: string | null;
  /** Content Template SID (HX…) of the approved Spanish OTP template. */
  private readonly whatsappOtpTemplateSid: string | null;

  constructor(private readonly config: ConfigService) {
    const accountSid = config.get<string>('TWILIO_ACCOUNT_SID');
    const apiKeySid = config.get<string>('TWILIO_API_KEY_SID');
    const apiKeySecret = config.get<string>('TWILIO_API_KEY_SECRET');
    this.fromNumber = config.get<string>('TWILIO_FROM_NUMBER') ?? null;
    this.whatsappFrom = config.get<string>('TWILIO_WHATSAPP_FROM') ?? null;
    this.whatsappOtpTemplateSid =
      config.get<string>('TWILIO_WHATSAPP_OTP_TEMPLATE_SID') ?? null;

    if (accountSid && apiKeySid && apiKeySecret && this.fromNumber) {
      this.client = twilio(apiKeySid, apiKeySecret, { accountSid });
      const waState = this.whatsappFrom
        ? this.whatsappOtpTemplateSid
          ? `WA template ${this.whatsappOtpTemplateSid.slice(0, 8)}…`
          : 'WA sandbox (free-form, no template)'
        : 'WA disabled';
      this.logger.log(
        `Twilio initialized (API Key auth, SMS from ${this.fromNumber}, ${waState})`,
      );
    } else {
      this.client = null;
      const missing = [
        !accountSid && 'TWILIO_ACCOUNT_SID',
        !apiKeySid && 'TWILIO_API_KEY_SID',
        !apiKeySecret && 'TWILIO_API_KEY_SECRET',
        !this.fromNumber && 'TWILIO_FROM_NUMBER',
      ].filter(Boolean);
      this.logger.warn(
        `Twilio disabled — missing: ${missing.join(', ')}. OTPs will be logged to console.`,
      );
    }
  }

  /**
   * Send a 6-digit OTP code via WhatsApp.
   *
   * Production path (TWILIO_WHATSAPP_OTP_TEMPLATE_SID set): uses Twilio's
   * Content API with the pre-approved authentication template + variable
   * substitution. Meta enforces template usage for any business-initiated
   * WhatsApp message — free-form text would be rejected.
   *
   * Sandbox path (no template SID): sends the OTP as free-form text. Only
   * works against Twilio's WhatsApp Sandbox where each tester has opted in
   * with `join <code>`. Suitable for dev/staging only.
   *
   * Dev seed bypass: phones matching `+1555555XXXX` are logged to console
   * (same convention as `sendSms`) so seeded e2e users never hit Twilio.
   */
  async sendWhatsAppOtp(to: string, code: string): Promise<void> {
    if (SEEDED_DEV_PHONE_REGEX.test(to)) {
      this.logger.log(
        `[DEV SEED OTP] → whatsapp:${to}: Tu código DashGo es ${code}. Vence en 5 min.`,
      );
      return;
    }

    if (!this.client || !this.whatsappFrom) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error(
          'Twilio WhatsApp is not configured — cannot send OTP in production',
        );
      }
      this.logger.log(
        `[DEV OTP] → whatsapp:${to}: Tu código DashGo es ${code}. Vence en 5 min.`,
      );
      return;
    }

    const waTo = `whatsapp:${to}`;
    if (this.whatsappOtpTemplateSid) {
      // Production: WhatsApp Content Template. Body is rendered by Meta
      // from the approved template — we only supply the variable.
      await this.client.messages.create({
        to: waTo,
        from: this.whatsappFrom,
        contentSid: this.whatsappOtpTemplateSid,
        contentVariables: JSON.stringify({ '1': code }),
      });
    } else {
      // Sandbox: free-form text. Only works for testers who joined the
      // Twilio WhatsApp Sandbox by texting `join <code>` to the sandbox
      // number. Outside the sandbox, Meta rejects free-form business-
      // initiated messages.
      await this.client.messages.create({
        to: waTo,
        from: this.whatsappFrom,
        body: `Tu código DashGo es ${code}. Vence en 5 min.`,
      });
    }
  }

  async sendSms(to: string, body: string): Promise<void> {
    if (SEEDED_DEV_PHONE_REGEX.test(to)) {
      this.logger.log(`[DEV SEED OTP] → ${to}: ${body}`);
      return;
    }

    if (!this.client || !this.fromNumber) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error(
          'Twilio is not configured — cannot send OTP in production',
        );
      }
      this.logger.log(`[DEV OTP] → ${to}: ${body}`);
      return;
    }

    await this.client.messages.create({
      to,
      from: this.fromNumber,
      body,
    });
  }

  async sendOrderNotificationSms(order: Order): Promise<void> {
    const numbers =
      this.config.get<string[]>('ORDER_SMS_NOTIFY_NUMBERS') ?? [];

    if (numbers.length === 0) {
      this.logger.debug(
        `ORDER_SMS_NOTIFY_NUMBERS empty — skipping notification for order ${order.id}`,
      );
      return;
    }

    const shortId = order.id.replace(/-/g, '').slice(-8);
    const customerName = order.customer?.fullName ?? 'Cliente';
    // totalAmount is a numeric string like "35.50" (not cents). Format as "$35.50".
    const totalFormatted = `$${order.totalAmount}`;
    const addressText = order.deliveryAddress?.text ?? '';
    const truncatedAddress =
      addressText.length > 40 ? addressText.slice(0, 37) + '...' : addressText;

    const body = `DashGo: Pedido #${shortId} — ${customerName} — ${totalFormatted} — ${truncatedAddress}`;

    for (const number of numbers) {
      try {
        await this.sendSms(number, body);
      } catch (err) {
        this.logger.error(
          `Failed to send order SMS to ${number} for order ${order.id}: ${(err as Error).message}`,
        );
        // continue with next number
      }
    }
  }
}
