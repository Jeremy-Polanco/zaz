import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';

/**
 * Per-phone rate limiter for SMS-cost-bearing endpoints (OTP send/verify).
 *
 * The default ThrottlerGuard tracks by IP, which is not enough for SMS-cost
 * endpoints: an attacker can rotate IPs to bombard a single phone number with
 * OTP texts, each one charged to our Twilio balance.
 *
 * This guard owns its own in-memory bucket keyed by the `phone` field in the
 * request body so per-phone limits don't couple to the global IP-based
 * throttler. Falls back to IP when no phone is in the body so we never
 * silently disable throttling.
 *
 * Single-replica deployments only. When scaling out, swap this for a
 * Redis-backed implementation so buckets are shared.
 */
@Injectable()
export class PhoneThrottlerGuard implements CanActivate {
  private readonly limit = 3;
  private readonly windowMs = 60_000;
  private readonly hits = new Map<string, number[]>();

  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<{ body?: { phone?: unknown }; ip?: string }>();

    const phoneRaw = req?.body?.phone;
    const phone = typeof phoneRaw === 'string' ? phoneRaw.trim() : '';
    const key = phone ? `phone:${phone}` : `ip:${req?.ip ?? 'unknown'}`;

    const now = Date.now();
    const recent = (this.hits.get(key) ?? []).filter(
      (t) => now - t < this.windowMs,
    );

    if (recent.length >= this.limit) {
      throw new HttpException(
        { statusCode: HttpStatus.TOO_MANY_REQUESTS, message: 'Too Many Requests' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }
}
