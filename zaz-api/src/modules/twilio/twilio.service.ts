import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import twilio, { Twilio } from 'twilio';

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
}
