import 'reflect-metadata';
import { DataSource } from 'typeorm';
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
  User,
} from '../entities';

// Standalone DataSource for the TypeORM CLI (migration generate / run / revert).
// Mirrors the runtime config in src/config/database.config.ts.
//
// CLI usage from zaz-api/:
//   npm run migration:generate -- src/database/migrations/AddSomething
//   npm run migration:run
//   npm run migration:revert

if (!process.env.DB_PASSWORD) {
  throw new Error('DB_PASSWORD env var is required');
}

const sslMode = process.env.DB_SSL ?? 'false';
const ssl =
  sslMode === 'ca'
    ? { ca: process.env.DB_SSL_CA, rejectUnauthorized: true }
    : sslMode === 'true'
      ? { rejectUnauthorized: false }
      : false;

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: parseInt(process.env.DB_PORT ?? '5432', 10),
  username: process.env.DB_USER ?? 'zaz',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME ?? 'zaz_db',
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
  ],
  synchronize: false,
  migrationsRun: true,
  migrations: ['src/database/migrations/*.ts'],
});
