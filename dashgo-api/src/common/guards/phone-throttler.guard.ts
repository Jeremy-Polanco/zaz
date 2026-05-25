import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Per-phone rate limiter for SMS-cost-bearing endpoints (OTP send/verify).
 *
 * The default ThrottlerGuard tracks by IP, which is not enough for
 * SMS-cost endpoints: an attacker can rotate IPs to bombard a single
 * phone number with OTP texts, each one charged to our Twilio balance.
 *
 * This guard tracks by the `phone` field in the request body so each
 * phone number gets its own bucket independent of source IP. Falls back
 * to IP when no phone is in the body so we never silently disable
 * throttling.
 */
@Injectable()
export class PhoneThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: Record<string, any>): Promise<string> {
    const phoneRaw = req?.body?.phone;
    const phone = typeof phoneRaw === 'string' ? phoneRaw.trim() : '';
    if (phone) return Promise.resolve(`phone:${phone}`);
    const ip = typeof req?.ip === 'string' ? req.ip : 'unknown';
    return Promise.resolve(`ip:${ip}`);
  }
}
