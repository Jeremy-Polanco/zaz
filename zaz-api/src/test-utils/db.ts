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
  User,
} from '../entities';
import { Subscription } from '../entities/subscription.entity';

const DB_HOST = process.env.DB_HOST ?? 'localhost';
const DB_PORT = parseInt(process.env.DB_PORT ?? '5433', 10);
const DB_NAME = process.env.DB_NAME ?? 'zaz_test';
const DB_USER = process.env.DB_USER ?? 'zaz_test';
const DB_PASSWORD = process.env.DB_PASSWORD ?? 'zaz_test';

let _testDataSource: DataSource | null = null;

/**
 * Returns a shared DataSource configured for the test database.
 * Initializes (connects) on first call, reuses on subsequent calls.
 */
export async function getTestDataSource(): Promise<DataSource> {
  if (_testDataSource && _testDataSource.isInitialized) {
    return _testDataSource;
  }
  _testDataSource = buildTestDataSource();
  await _testDataSource.initialize();
  return _testDataSource;
}

/**
 * Builds (but does NOT initialize) a DataSource for the test database.
 * Use getTestDataSource() for the shared initialized instance.
 */
export function buildTestDataSource(): DataSource {
  return new DataSource({
    type: 'postgres',
    host: DB_HOST,
    port: DB_PORT,
    username: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
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
    migrationsRun: false,
    migrations: ['src/database/migrations/*.ts'],
    logging: false,
  });
}

/**
 * Checks that at least one migration file exists in src/database/migrations/.
 * Throws a descriptive error if the InitialSchema migration is missing.
 * Called by globalSetup before running migrations.
 */
export function migrationCheck(): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('fs') as typeof import('fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('path') as typeof import('path');

  const migrationsDir = path.resolve(
    __dirname,
    '../../src/database/migrations',
  );

  let files: string[] = [];
  try {
    files = fs.readdirSync(migrationsDir);
  } catch {
    throw new Error(
      `Migration directory not found: ${migrationsDir}\n` +
        'Run: npm run migration:generate -- src/database/migrations/InitialSchema',
    );
  }

  const hasMigrations = files.some(
    (f) => f.endsWith('.ts') || f.endsWith('.js'),
  );

  if (!hasMigrations) {
    throw new Error(
      'InitialSchema migration is missing. No migration files found in src/database/migrations/.\n' +
        'Run: npm run migration:generate -- src/database/migrations/InitialSchema\n' +
        'against your dev DB and commit the result before running integration tests.',
    );
  }
}

/**
 * Destroys and nulls the shared test DataSource.
 */
export async function destroyTestDataSource(): Promise<void> {
  if (_testDataSource && _testDataSource.isInitialized) {
    await _testDataSource.destroy();
    _testDataSource = null;
  }
}
