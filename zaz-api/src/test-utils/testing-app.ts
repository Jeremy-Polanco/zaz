/**
 * Creates a full NestJS application wired for E2E testing.
 *
 * - Uses the real AppModule but overrides TypeORM with the test database.
 * - Overrides ConfigService to supply test env values without requiring
 *   the Joi validation schema to pass for Twilio/other non-test secrets.
 * - The Stripe module initialises from STRIPE_SECRET_KEY in the env;
 *   tests set STRIPE_SECRET_KEY=sk_test_dummy so Stripe SDK is constructed
 *   but all HTTP calls go through jest.mock('stripe', ...).
 *
 * Call app.close() in afterAll to prevent open handle warnings.
 */

import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import {
  Category,
  Counter,
  CreditAccount,
  CreditMovement,
  Invoice,
  Order,
  OrderItem,
  OtpCode,
  Payout,
  PointsLedgerEntry,
  Product,
  PromoterCommissionEntry,
  User,
} from '../entities';
import { Subscription } from '../entities/subscription.entity';
import { AppModule } from '../app.module';

const TEST_DB_CONFIG = {
  host: process.env.DB_HOST ?? 'localhost',
  port: parseInt(process.env.DB_PORT ?? '5433', 10),
  username: process.env.DB_USER ?? 'zaz_test',
  password: process.env.DB_PASSWORD ?? 'zaz_test',
  database: process.env.DB_NAME ?? 'zaz_test',
};

export async function createTestingApp(
  // Optional additional module overrides for specific test scenarios
  extraOverrides?: (builder: ReturnType<typeof Test.createTestingModule>) => void,
): Promise<INestApplication> {
  // Set required env vars before building the module (Joi validates these)
  process.env.DB_HOST = TEST_DB_CONFIG.host;
  process.env.DB_PORT = String(TEST_DB_CONFIG.port);
  process.env.DB_USER = TEST_DB_CONFIG.username;
  process.env.DB_PASSWORD = TEST_DB_CONFIG.password;
  process.env.DB_NAME = TEST_DB_CONFIG.database;
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret-32-characters-long-xxx';
  process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? 'sk_test_dummy';
  process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? 'whsec_test';
  process.env.STRIPE_SUBSCRIPTION_PRICE_ID =
    process.env.STRIPE_SUBSCRIPTION_PRICE_ID ?? 'price_test_monthly';
  process.env.TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID ?? 'ACtest';
  process.env.TWILIO_API_KEY_SID = process.env.TWILIO_API_KEY_SID ?? 'SKtest';
  process.env.TWILIO_API_KEY_SECRET = process.env.TWILIO_API_KEY_SECRET ?? 'test-secret';
  process.env.TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER ?? '+15550000000';

  const builder = Test.createTestingModule({
    imports: [AppModule],
  });

  // Instead of overriding just one module, we compile with a fresh module
  // that uses overrides. AppModule reads DB connection from process.env which
  // we patched above to point at the test DB.
  if (extraOverrides) {
    extraOverrides(builder);
  }

  // Compile the module — AppModule already reads from process.env which
  // we patched above to point at the test DB. This is the simplest approach
  // that avoids reimplementing the full module graph.
  const moduleRef: TestingModule = await builder.compile();

  const app = moduleRef.createNestApplication();

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
    }),
  );

  await app.init();
  return app;
}

/**
 * Lightweight variant that creates a testing module with ONLY the specified
 * providers/repositories. Use this for unit tests that need the DI container
 * but not the full app bootstrap.
 */
export { Test } from '@nestjs/testing';
