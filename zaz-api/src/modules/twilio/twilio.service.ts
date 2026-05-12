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

  constructor(private readonly config: ConfigService) {
    const accountSid = config.get<string>('TWILIO_ACCOUNT_SID');
    const apiKeySid = config.get<string>('TWILIO_API_KEY_SID');
    const apiKeySecret = config.get<string>('TWILIO_API_KEY_SECRET');
    this.fromNumber = config.get<string>('TWILIO_FROM_NUMBER') ?? null;

    if (accountSid && apiKeySid && apiKeySecret && this.fromNumber) {
      this.client = twilio(apiKeySid, apiKeySecret, { accountSid });
      this.logger.log(
        `Twilio initialized (API Key auth, from ${this.fromNumber})`,
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

    const body = `ZAZ: Pedido #${shortId} — ${customerName} — ${totalFormatted} — ${truncatedAddress}`;

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
