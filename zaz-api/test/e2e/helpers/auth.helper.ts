/**
 * E2E test authentication helper.
 *
 * Since the auth flow requires OTP (Twilio), we bypass it in E2E tests
 * by directly signing a JWT with the test secret. This simulates a logged-in
 * user without needing a working Twilio account.
 */

import { JwtService } from '@nestjs/jwt';
import { INestApplication } from '@nestjs/common';

export interface TestAuthTokens {
  accessToken: string;
  userId: string;
}

/**
 * Issues a JWT access token directly via the JwtService (no Twilio).
 * Uses the test JWT_SECRET from .env.test.
 */
export async function issueTestToken(
  app: INestApplication,
  userId: string,
  role: string,
): Promise<string> {
  const jwt = app.get(JwtService);
  return jwt.signAsync(
    { sub: userId, role },
    {
      secret: process.env.JWT_SECRET ?? 'test-secret-32-characters-long-xxx',
      expiresIn: '1h',
    },
  );
}
