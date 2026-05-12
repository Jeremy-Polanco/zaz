import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
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
  Subscription,
  SubscriptionPlan,
  User,
  UserAddress,
} from '../entities';

export const buildDatabaseConfig = (
  config: ConfigService,
): TypeOrmModuleOptions => {
  // SSL handling for managed Postgres (DigitalOcean, Render, Neon, Supabase, RDS).
  // - DB_SSL=true → require SSL with rejectUnauthorized=false (most managed providers).
  // - DB_SSL=ca → require SSL and verify with the bundled CA in DB_SSL_CA (PEM).
  // - DB_SSL unset / 'false' → no SSL (local dev with docker compose).
  const sslMode = config.get<string>('DB_SSL', 'false');
  const ssl =
    sslMode === 'ca'
      ? {
          ca: config.getOrThrow<string>('DB_SSL_CA'),
          rejectUnauthorized: true,
        }
      : sslMode === 'true'
        ? { rejectUnauthorized: false }
        : false;

  return {
  type: 'postgres',
  host: config.getOrThrow<string>('DB_HOST'),
  port: parseInt(config.getOrThrow<string>('DB_PORT'), 10),
  username: config.getOrThrow<string>('DB_USER'),
  password: config.getOrThrow<string>('DB_PASSWORD'),
  database: config.getOrThrow<string>('DB_NAME'),
  ssl,
  entities: [
    User,
    Category,
    Product,
    Order,
    OrderItem,
    OtpCode,
    PointsLedgerEntry,
    Invoice,
    Counter,
    Payout,
    PromoterCommissionEntry,
    CreditAccount,
    CreditMovement,
    Subscription,
    SubscriptionPlan,
    UserAddress,
  ],
  // Belt-and-suspenders: hard-disable synchronize in production regardless of env var.
  // The env schema also enforces DB_SYNCHRONIZE='false' in production.
  synchronize:
    config.get<string>('NODE_ENV') !== 'production' &&
    config.get<string>('DB_SYNCHRONIZE', 'false') === 'true',
  migrationsRun: true,
  migrations: ['dist/database/migrations/*.js'],
  logging:
    config.get<string>('NODE_ENV') === 'development'
      ? ['error', 'warn']
      : ['error'],
  extra: {
    applicationName: 'zaz-api',
    max: Number(config.get('DB_POOL_MAX') ?? 20),
    connectionTimeoutMillis: 10_000,
  },
  };
};
